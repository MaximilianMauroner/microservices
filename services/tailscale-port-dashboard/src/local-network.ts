import { execFile } from "node:child_process";
import os from "node:os";
import express, { type NextFunction, type Request, type Response } from "express";

export type CommandResult = {
  stdout: string;
  stderr: string;
};

export type CommandRunner = (
  command: string,
  args: readonly string[]
) => Promise<CommandResult>;

export type TailscaleStatus = {
  dnsName?: string;
  hostName?: string;
  ipv4: string[];
  ipv6: string[];
  online: boolean;
  warnings: string[];
};

export type PortProtocol = "tcp" | "udp";

export type ProcessRef = {
  name: string;
  pid: number;
};

export type ParsedPortListener = {
  address: string;
  port: number;
  processes: ProcessRef[];
  protocol: PortProtocol;
  raw: string;
  state: string;
};

export type PortScope =
  | "all-interfaces"
  | "host-address"
  | "lan-or-private"
  | "loopback-only"
  | "tailscale-only";

export type PortListener = ParsedPortListener & {
  remoteTargets: string[];
  scope: PortScope;
  scopeLabel: string;
  usage: string;
};

export type NetworkSnapshot = {
  generatedAt: string;
  hostname: string;
  ports: PortListener[];
  tailscale: TailscaleStatus;
};

export type LocalNetworkDashboardOptions = {
  currentUser?: string;
  hostname?: string;
  now?: () => Date;
  runner?: CommandRunner;
};

const COMMAND_TIMEOUT_MS = 2_500;
const COMMAND_MAX_BUFFER_BYTES = 1_000_000;
const SS_ARGS = ["-H", "-lntup"] as const;
const HTTP_PORTS = new Set([80, 3000, 3001, 4173, 5000, 5173, 8000, 8080, 8787]);
const TAILSCALE_IPV6_PREFIX = "fd7a:115c:a1e0:";
const PORT_USAGE = new Map<string, string>([
  ["tcp:22", "SSH remote shell"],
  ["tcp:80", "HTTP web service; this dashboard defaults here"],
  ["tcp:443", "HTTPS web service"],
  ["tcp:3000", "Common local Node.js or web app service"],
  ["tcp:3001", "Common secondary local web app service"],
  ["tcp:4173", "Common Vite preview service"],
  ["tcp:5000", "Common local web API service"],
  ["tcp:5173", "Common Vite development service"],
  ["tcp:8000", "Common local HTTP service"],
  ["tcp:8080", "Common alternate HTTP service"],
  ["tcp:8787", "Common Workers or local web service"],
  ["tcp:5432", "PostgreSQL database"],
  ["tcp:6379", "Redis database"],
  ["udp:53", "DNS resolver"],
  ["tcp:53", "DNS resolver"],
  ["udp:68", "DHCP client"],
  ["udp:123", "NTP time sync"],
  ["udp:546", "DHCPv6 client"],
  ["udp:41641", "Tailscale WireGuard traffic"],
  ["tcp:41641", "Tailscale traffic"]
]);

const SCOPE_LABELS: Record<PortScope, string> = {
  "all-interfaces": "All interfaces",
  "host-address": "Host address",
  "lan-or-private": "LAN/private",
  "loopback-only": "Local only",
  "tailscale-only": "Tailscale"
};

export function createLocalNetworkDashboardApp(options: LocalNetworkDashboardOptions = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.get("/api/ports", async (_req, res, next) => {
    try {
      res.status(200).json(await collectNetworkSnapshot(options));
    } catch (error) {
      next(error);
    }
  });

  app.get("/", async (_req, res, next) => {
    try {
      const snapshot = await collectNetworkSnapshot(options);
      res.type("html").send(renderDashboard(snapshot));
    } catch (error) {
      next(error);
    }
  });

  app.use(localNetworkErrorHandler);

  return app;
}

export async function collectNetworkSnapshot(
  options: LocalNetworkDashboardOptions = {}
): Promise<NetworkSnapshot> {
  const runner = options.runner ?? runCommand;
  const now = options.now ?? (() => new Date());
  const [tailscale, parsedPorts] = await Promise.all([
    collectTailscaleStatus(runner),
    collectParsedPortListeners(runner)
  ]);
  const currentUser = options.currentUser ?? os.userInfo().username;

  return {
    generatedAt: now().toISOString(),
    hostname: options.hostname ?? os.hostname(),
    tailscale,
    ports: parsedPorts.map((listener) => enrichPortListener(listener, tailscale, currentUser))
  };
}

export function parseSsListeners(output: string): ParsedPortListener[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseSsLine)
    .filter((listener): listener is ParsedPortListener => listener !== null)
    .sort(compareParsedPortListeners);
}

async function runCommand(command: string, args: readonly string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        encoding: "utf8",
        maxBuffer: COMMAND_MAX_BUFFER_BYTES,
        timeout: COMMAND_TIMEOUT_MS
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }

        resolve({
          stdout: String(stdout),
          stderr: String(stderr)
        });
      }
    );
  });
}

async function collectTailscaleStatus(runner: CommandRunner): Promise<TailscaleStatus> {
  const [ipv4Result, ipv6Result, statusResult] = await Promise.all([
    safeRun(runner, "tailscale", ["ip", "-4"]),
    safeRun(runner, "tailscale", ["ip", "-6"]),
    safeRun(runner, "tailscale", ["status", "--json"])
  ]);
  const warnings: string[] = [];

  if (ipv4Result.error) {
    warnings.push(`tailscale ip -4 failed: ${ipv4Result.error}`);
  }

  if (ipv6Result.error) {
    warnings.push(`tailscale ip -6 failed: ${ipv6Result.error}`);
  }

  const parsedStatus = statusResult.result
    ? parseTailscaleStatusJson(statusResult.result.stdout)
    : { metadata: {} };
  if (statusResult.error) {
    warnings.push(`tailscale status failed: ${statusResult.error}`);
  }
  if (parsedStatus.warning) {
    warnings.push(parsedStatus.warning);
  }

  const ipv4 = ipv4Result.result ? parseAddressLines(ipv4Result.result.stdout) : [];
  const ipv6 = ipv6Result.result ? parseAddressLines(ipv6Result.result.stdout) : [];

  return {
    ...parsedStatus.metadata,
    ipv4,
    ipv6,
    online: ipv4.length > 0 || ipv6.length > 0,
    warnings
  };
}

async function collectParsedPortListeners(runner: CommandRunner): Promise<ParsedPortListener[]> {
  const result = await safeRun(runner, "ss", SS_ARGS);
  if (!result.result) {
    return [];
  }

  return parseSsListeners(result.result.stdout);
}

type SafeRunResult =
  | {
      error: string;
      result?: never;
    }
  | {
      error?: never;
      result: CommandResult;
    };

async function safeRun(
  runner: CommandRunner,
  command: string,
  args: readonly string[]
): Promise<SafeRunResult> {
  try {
    return { result: await runner(command, args) };
  } catch (error) {
    return { error: getErrorMessage(error) };
  }
}

type ParsedTailscaleStatus = {
  metadata: Pick<TailscaleStatus, "dnsName" | "hostName">;
  warning?: string;
};

function parseTailscaleStatusJson(stdout: string): ParsedTailscaleStatus {
  if (!stdout.trim()) {
    return { metadata: {} };
  }

  try {
    const parsed: unknown = JSON.parse(stdout);
    const self = getRecordProperty(parsed, "Self");
    return {
      metadata: {
        dnsName: trimTrailingDot(getStringProperty(self, "DNSName")),
        hostName: getStringProperty(self, "HostName")
      }
    };
  } catch {
    return {
      metadata: {},
      warning: "tailscale status returned malformed JSON"
    };
  }
}

function parseAddressLines(stdout: string) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseSsLine(line: string): ParsedPortListener | null {
  const parts = line.split(/\s+/);
  if (parts.length < 5) {
    return null;
  }

  const protocol = parseProtocol(parts[0]);
  if (!protocol) {
    return null;
  }

  const endpoint = parseEndpoint(parts[4]);
  if (!endpoint) {
    return null;
  }

  return {
    ...endpoint,
    processes: parseProcesses(parts.slice(6).join(" ")),
    protocol,
    raw: line,
    state: parts[1]
  };
}

function parseProtocol(value: string): PortProtocol | null {
  const normalized = value.toLowerCase();
  if (normalized === "tcp" || normalized === "udp") {
    return normalized;
  }

  return null;
}

function parseEndpoint(endpoint: string): Pick<ParsedPortListener, "address" | "port"> | null {
  const bracketMatch = endpoint.match(/^\[(.*)\]:(\d+)$/);
  if (bracketMatch) {
    return {
      address: bracketMatch[1],
      port: Number.parseInt(bracketMatch[2], 10)
    };
  }

  const separatorIndex = endpoint.lastIndexOf(":");
  if (separatorIndex === -1) {
    return null;
  }

  const portText = endpoint.slice(separatorIndex + 1);
  const port = Number.parseInt(portText, 10);
  if (!Number.isSafeInteger(port) || port <= 0) {
    return null;
  }

  return {
    address: endpoint.slice(0, separatorIndex) || "*",
    port
  };
}

function parseProcesses(text: string): ProcessRef[] {
  const processes: ProcessRef[] = [];
  const pattern = /"([^"]+)",pid=(\d+)/g;
  let match = pattern.exec(text);

  while (match) {
    processes.push({
      name: match[1],
      pid: Number.parseInt(match[2], 10)
    });
    match = pattern.exec(text);
  }

  return processes;
}

function enrichPortListener(
  listener: ParsedPortListener,
  tailscale: TailscaleStatus,
  currentUser: string
): PortListener {
  const scope = classifyScope(listener.address, tailscale);
  return {
    ...listener,
    remoteTargets: buildRemoteTargets(listener, scope, tailscale, currentUser),
    scope,
    scopeLabel: SCOPE_LABELS[scope],
    usage: describeUsage(listener)
  };
}

function classifyScope(address: string, tailscale: TailscaleStatus): PortScope {
  const normalized = normalizeAddress(address);
  const tailscaleAddresses = new Set([...tailscale.ipv4, ...tailscale.ipv6].map(normalizeAddress));

  if (isAnyInterface(normalized)) {
    return "all-interfaces";
  }

  if (isLoopbackAddress(normalized)) {
    return "loopback-only";
  }

  if (tailscaleAddresses.has(normalized) || isLikelyTailscaleAddress(normalized)) {
    return "tailscale-only";
  }

  if (isPrivateLanAddress(normalized)) {
    return "lan-or-private";
  }

  return "host-address";
}

function buildRemoteTargets(
  listener: ParsedPortListener,
  scope: PortScope,
  tailscale: TailscaleStatus,
  currentUser: string
) {
  if (listener.protocol !== "tcp" || scope === "loopback-only" || scope === "lan-or-private") {
    return [];
  }

  const host = tailscale.dnsName ?? tailscale.ipv4[0] ?? tailscale.ipv6[0];
  if (!host) {
    return [];
  }

  if (listener.port === 22) {
    return [`ssh ${currentUser}@${host}`];
  }

  const formattedHost = formatUrlHost(host);
  if (HTTP_PORTS.has(listener.port)) {
    return [`http://${formattedHost}${listener.port === 80 ? "" : `:${listener.port}`}/`];
  }

  return [`${formattedHost}:${listener.port}`];
}

function describeUsage(listener: ParsedPortListener) {
  const usage = PORT_USAGE.get(`${listener.protocol}:${listener.port}`);
  const processNames = unique(listener.processes.map((processRef) => processRef.name));

  if (usage && processNames.length > 0) {
    return `${usage}. Detected process: ${processNames.join(", ")}.`;
  }

  if (usage) {
    return `${usage}.`;
  }

  if (processNames.length > 0) {
    return `Application listener owned by ${processNames.join(", ")}.`;
  }

  return "Unknown listener; process details were not available.";
}

function compareParsedPortListeners(left: ParsedPortListener, right: ParsedPortListener) {
  if (left.port !== right.port) {
    return left.port - right.port;
  }

  const protocolComparison = left.protocol.localeCompare(right.protocol);
  if (protocolComparison !== 0) {
    return protocolComparison;
  }

  return left.address.localeCompare(right.address);
}

function normalizeAddress(address: string) {
  const withoutZone = address.replace(/%.+$/, "");
  if (withoutZone === "[::]") {
    return "::";
  }

  return withoutZone;
}

function isAnyInterface(address: string) {
  return address === "*" || address === "0.0.0.0" || address === "::";
}

function isLoopbackAddress(address: string) {
  return address === "localhost" || address === "::1" || address.startsWith("127.");
}

function isLikelyTailscaleAddress(address: string) {
  if (address.toLowerCase().startsWith(TAILSCALE_IPV6_PREFIX)) {
    return true;
  }

  const octets = parseIpv4Octets(address);
  return Boolean(octets && octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127);
}

function isPrivateLanAddress(address: string) {
  const octets = parseIpv4Octets(address);
  if (!octets) {
    return address.startsWith("fe80:") || address.startsWith("fc") || address.startsWith("fd");
  }

  const [first, second] = octets;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

function parseIpv4Octets(address: string): [number, number, number, number] | null {
  const octets = address.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }

  return [octets[0], octets[1], octets[2], octets[3]];
}

function formatUrlHost(host: string) {
  if (host.includes(":") && !host.startsWith("[")) {
    return `[${host}]`;
  }

  return host;
}

function renderDashboard(snapshot: NetworkSnapshot) {
  const tailscaleAddress = snapshot.tailscale.ipv4[0] ?? snapshot.tailscale.ipv6[0] ?? "Unavailable";
  const dashboardUrl = snapshot.tailscale.ipv4[0]
    ? `http://${snapshot.tailscale.ipv4[0]}/`
    : snapshot.tailscale.dnsName
      ? `http://${snapshot.tailscale.dnsName}/`
      : "Unavailable";
  const warnings = snapshot.tailscale.warnings;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="refresh" content="20">
    <title>${escapeHtml(snapshot.hostname)} ports</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f6f8fa;
        color: #1f2328;
      }

      body {
        margin: 0;
      }

      main {
        max-width: 1180px;
        margin: 0 auto;
        padding: 28px 20px 40px;
      }

      header {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 18px;
        margin-bottom: 24px;
      }

      h1 {
        margin: 0 0 8px;
        font-size: clamp(26px, 4vw, 38px);
        line-height: 1.08;
        letter-spacing: 0;
      }

      .meta {
        color: #59636e;
        display: flex;
        flex-wrap: wrap;
        gap: 8px 14px;
        font-size: 14px;
      }

      .summary {
        display: grid;
        gap: 12px;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      }

      .summary-item {
        background: #ffffff;
        border: 1px solid #d0d7de;
        border-radius: 8px;
        padding: 14px;
      }

      .summary-label {
        color: #59636e;
        font-size: 12px;
        font-weight: 650;
        letter-spacing: 0;
        margin-bottom: 8px;
        text-transform: uppercase;
      }

      code {
        background: #eef2f6;
        border-radius: 4px;
        font-family: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
        font-size: 0.92em;
        padding: 2px 5px;
        word-break: break-word;
      }

      a {
        color: #0969da;
        text-decoration: none;
      }

      a:hover {
        text-decoration: underline;
      }

      .table-wrap {
        background: #ffffff;
        border: 1px solid #d0d7de;
        border-radius: 8px;
        overflow-x: auto;
      }

      table {
        border-collapse: collapse;
        min-width: 920px;
        width: 100%;
      }

      th,
      td {
        border-bottom: 1px solid #d8dee4;
        padding: 11px 12px;
        text-align: left;
        vertical-align: top;
      }

      th {
        background: #f6f8fa;
        color: #59636e;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      tbody tr:last-child td {
        border-bottom: 0;
      }

      .muted {
        color: #6e7781;
      }

      .warnings {
        border: 1px solid #d4a72c;
        border-radius: 8px;
        color: #5d4411;
        margin-bottom: 18px;
        padding: 12px 14px;
      }

      @media (prefers-color-scheme: dark) {
        :root {
          background: #0d1117;
          color: #e6edf3;
        }

        .meta,
        .muted,
        th,
        .summary-label {
          color: #8b949e;
        }

        .summary-item,
        .table-wrap {
          background: #161b22;
          border-color: #30363d;
        }

        th {
          background: #21262d;
        }

        th,
        td {
          border-bottom-color: #30363d;
        }

        code {
          background: #21262d;
        }

        a {
          color: #58a6ff;
        }

        .warnings {
          background: #2d2305;
          border-color: #9e6a03;
          color: #e3b341;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <h1>${escapeHtml(snapshot.hostname)}</h1>
          <div class="meta">
            <span>${escapeHtml(snapshot.generatedAt)}</span>
            <span>${snapshot.ports.length} listener${snapshot.ports.length === 1 ? "" : "s"}</span>
            <a href="/api/ports">JSON</a>
          </div>
        </div>
        <div class="summary">
          ${renderSummaryItem("Tailscale address", tailscaleAddress)}
          ${renderSummaryItem("Tailscale DNS", snapshot.tailscale.dnsName ?? "Unavailable")}
          ${renderSummaryItem("Dashboard", dashboardUrl, dashboardUrl.startsWith("http") ? dashboardUrl : undefined)}
        </div>
      </header>
      ${warnings.length > 0 ? renderWarnings(warnings) : ""}
      <section class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Port</th>
              <th>Protocol</th>
              <th>Address</th>
              <th>Exposure</th>
              <th>Usage</th>
              <th>Process</th>
              <th>Remote target</th>
            </tr>
          </thead>
          <tbody>
            ${
              snapshot.ports.length > 0
                ? snapshot.ports.map(renderPortRow).join("")
                : `<tr><td colspan="7" class="muted">No listening ports found.</td></tr>`
            }
          </tbody>
        </table>
      </section>
    </main>
  </body>
</html>`;
}

function renderSummaryItem(label: string, value: string, href?: string) {
  return `<div class="summary-item">
    <div class="summary-label">${escapeHtml(label)}</div>
    ${href ? `<a href="${escapeAttribute(href)}">${escapeHtml(value)}</a>` : `<code>${escapeHtml(value)}</code>`}
  </div>`;
}

function renderWarnings(warnings: string[]) {
  return `<div class="warnings">${warnings.map((warning) => escapeHtml(warning)).join("<br>")}</div>`;
}

function renderPortRow(listener: PortListener) {
  return `<tr>
    <td><code>${listener.port}</code></td>
    <td>${escapeHtml(listener.protocol.toUpperCase())}</td>
    <td><code>${escapeHtml(listener.address)}</code></td>
    <td>${escapeHtml(listener.scopeLabel)}</td>
    <td>${escapeHtml(listener.usage)}</td>
    <td>${renderProcesses(listener.processes)}</td>
    <td>${renderRemoteTargets(listener.remoteTargets)}</td>
  </tr>`;
}

function renderProcesses(processes: ProcessRef[]) {
  if (processes.length === 0) {
    return `<span class="muted">Unavailable</span>`;
  }

  return processes
    .map((processRef) => `<code>${escapeHtml(processRef.name)}:${processRef.pid}</code>`)
    .join("<br>");
}

function renderRemoteTargets(targets: string[]) {
  if (targets.length === 0) {
    return `<span class="muted">Not exposed over Tailscale</span>`;
  }

  return targets
    .map((target) =>
      target.startsWith("http")
        ? `<a href="${escapeAttribute(target)}">${escapeHtml(target)}</a>`
        : `<code>${escapeHtml(target)}</code>`
    )
    .join("<br>");
}

function getRecordProperty(value: unknown, property: string): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const candidate = value[property];
  return isRecord(candidate) ? candidate : undefined;
}

function getStringProperty(value: Record<string, unknown> | undefined, property: string) {
  const candidate = value?.[property];
  return typeof candidate === "string" && candidate ? candidate : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function trimTrailingDot(value: string | undefined) {
  return value?.replace(/\.$/, "");
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPE[character] ?? character);
}

function escapeAttribute(value: string) {
  return escapeHtml(value);
}

function localNetworkErrorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  console.error(error);
  res.status(500).json({ error: "internal_server_error" });
}
