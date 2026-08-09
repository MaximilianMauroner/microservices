import { describe, expect, it } from "vitest";
import {
  collectNetworkSnapshot,
  createLocalNetworkDashboardApp,
  parseSsListeners,
  type CommandRunner,
  type WebsiteProbe
} from "../src/local-network.js";

const TEST_TAILSCALE_IPV4 = "100.64.0.10";
const TEST_TAILSCALE_IPV6 = "fd7a:115c:a1e0::10";
const TEST_TAILSCALE_DNS = "workstation.example.ts.net";

const SS_OUTPUT = [
  "udp UNCONN 0 0 127.0.0.54:53 0.0.0.0:*",
  "udp UNCONN 0 0 [fe80::5054:ff:fe77:21d2%enp1s0]:546 [::]:*",
  "udp UNCONN 0 0 0.0.0.0:41641 0.0.0.0:*",
  "tcp LISTEN 0 4096 0.0.0.0:22 0.0.0.0:*",
  'tcp LISTEN 0 511 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=863,fd=21))',
  `tcp LISTEN 0 4096 ${TEST_TAILSCALE_IPV4}:33706 0.0.0.0:*`,
  "tcp LISTEN 0 4096 [::]:22 [::]:*"
].join("\n");

const WEBSITE_PROBE: WebsiteProbe = async (candidate) => {
  if (candidate.port !== 3000) {
    return null;
  }

  return {
    path: "/orders",
    status: 200,
    title: "Example App"
  };
};

function createFixtureRunner(): CommandRunner {
  const fixtures = new Map<string, string>([
    ["tailscale ip -4", `${TEST_TAILSCALE_IPV4}\n`],
    ["tailscale ip -6", `${TEST_TAILSCALE_IPV6}\n`],
    [
      "tailscale status --json",
      JSON.stringify({
        Self: {
          DNSName: `${TEST_TAILSCALE_DNS}.`,
          HostName: "workstation"
        }
      })
    ],
    ["tailscale serve status --json", "{}"],
    ["ss -H -lntup", SS_OUTPUT],
    ["ps -o pid=,etimes= -p 863", "863 3600\n"]
  ]);

  return async (command, args) => {
    const key = `${command} ${args.join(" ")}`;
    const stdout = fixtures.get(key);
    if (stdout === undefined) {
      throw new Error(`Unexpected command: ${key}`);
    }

    return { stdout, stderr: "" };
  };
}

describe("local network dashboard", () => {
  it("parses ss listeners with processes and interface-scoped addresses", () => {
    const ports = parseSsListeners(SS_OUTPUT);

    expect(ports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          address: "0.0.0.0",
          port: 22,
          protocol: "tcp"
        }),
        expect.objectContaining({
          address: "0.0.0.0",
          port: 3000,
          processes: [{ name: "node", pid: 863 }],
          protocol: "tcp"
        }),
        expect.objectContaining({
          address: TEST_TAILSCALE_IPV4,
          port: 33706,
          protocol: "tcp"
        }),
        expect.objectContaining({
          address: "127.0.0.54",
          port: 53,
          protocol: "udp"
        }),
        expect.objectContaining({
          address: "fe80::5054:ff:fe77:21d2%enp1s0",
          port: 546,
          protocol: "udp"
        })
      ])
    );
  });

  it("collects tailscale addresses and annotates remote targets", async () => {
    const snapshot = await collectNetworkSnapshot({
      currentUser: "remote-user",
      hostname: "workstation",
      now: () => new Date("2026-07-08T12:00:00.000Z"),
      runner: createFixtureRunner(),
      websiteProbe: WEBSITE_PROBE
    });

    expect(snapshot.tailscale).toMatchObject({
      dnsName: TEST_TAILSCALE_DNS,
      hostName: "workstation",
      ipv4: [TEST_TAILSCALE_IPV4],
      online: true
    });
    expect(snapshot.generatedAt).toBe("2026-07-08T12:00:00.000Z");
    expect(snapshot.ports.find((port) => port.port === 22)?.remoteTargets).toContain(
      `ssh remote-user@${TEST_TAILSCALE_IPV4}`
    );
    expect(snapshot.ports.find((port) => port.port === 3000)?.remoteTargets).toContain(
      `http://${TEST_TAILSCALE_IPV4}:3000/`
    );
    expect(snapshot.ports.find((port) => port.port === 53)?.remoteTargets).toEqual([]);
    expect(snapshot.websites).toEqual([
      expect.objectContaining({
        port: 3000,
        onlineSince: "2026-07-08T11:00:00.000Z",
        status: 200,
        title: "Example App",
        url: `http://${TEST_TAILSCALE_IPV4}:3000/orders`
      })
    ]);
  });

  it("serves a dashboard and json snapshot", async () => {
    const app = createLocalNetworkDashboardApp({
      currentUser: "remote-user",
      hostname: "workstation",
      now: () => new Date("2026-07-08T12:00:00.000Z"),
      runner: createFixtureRunner(),
      websiteProbe: WEBSITE_PROBE
    });

    const htmlResponse = await app.request("/");
    const html = await htmlResponse.text();
    expect(htmlResponse.status).toBe(200);
    expect(htmlResponse.headers.get("content-type")).toContain("text/html");
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg">');
    expect(html).toContain(TEST_TAILSCALE_IPV4);
    expect(html).toContain("Websites");
    expect(html).toContain("Example App");
    expect(html).toContain(`href="http://${TEST_TAILSCALE_IPV4}:3000/orders"`);
    expect(html).toContain('target="_blank" rel="noopener"');
    expect(html).toContain('<img class="website-favicon"');
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("website-preview");
    expect(html).toContain("<code>kill 863</code>");
    expect(html).toContain("Online since");
    expect(html).toContain('datetime="2026-07-08T11:00:00.000Z"');
    expect(html).toContain('>1h0m</time>');
    expect(html).toContain("Other listeners");

    const faviconResponse = await app.request("/favicon.svg");
    expect(faviconResponse.status).toBe(200);
    expect(faviconResponse.headers.get("content-type")).toContain("image/svg+xml");
    expect(faviconResponse.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(await faviconResponse.text()).toContain("<svg");

    const jsonResponse = await app.request("/api/ports");
    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toMatchObject({
      hostname: "workstation",
      tailscale: {
        dnsName: TEST_TAILSCALE_DNS
      },
      websites: [
        {
          port: 3000,
          onlineSince: "2026-07-08T11:00:00.000Z",
          title: "Example App"
        }
      ]
    });
  });

  it("discovers HTTPS and path-mounted websites from Tailscale Serve", async () => {
    const baseRunner = createFixtureRunner();
    const runner: CommandRunner = async (command, args) => {
      const key = `${command} ${args.join(" ")}`;
      if (key === "tailscale serve status --json") {
        return {
          stdout: JSON.stringify({
            Web: {
              [`${TEST_TAILSCALE_DNS}:41731`]: {
                Handlers: {
                  "/": { Proxy: "http://127.0.0.1:41731" }
                }
              },
              [`${TEST_TAILSCALE_DNS}:443`]: {
                Handlers: {
                  "/": { Proxy: `http://${TEST_TAILSCALE_IPV4}:80` },
                  "/tokdash": { Proxy: "http://127.0.0.1:55423" }
                }
              },
              [`${TEST_TAILSCALE_DNS}:8443`]: {
                Handlers: {
                  "/": { Proxy: "http://127.0.0.1:3001" }
                }
              }
            }
          }),
          stderr: ""
        };
      }
      if (key === "ss -H -lntup") {
        return {
          stdout: [
            SS_OUTPUT,
            'tcp LISTEN 0 511 127.0.0.1:41731 0.0.0.0:* users:(("node",pid=41731,fd=21))',
            'tcp LISTEN 0 511 127.0.0.1:55423 0.0.0.0:* users:(("python",pid=55423,fd=14))'
          ].join("\n"),
          stderr: ""
        };
      }
      if (key === "ps -o pid=,etimes= -p 41731,55423") {
        return { stdout: "41731 600\n55423 1200\n", stderr: "" };
      }
      return baseRunner(command, args);
    };
    const candidates: Parameters<WebsiteProbe>[0][] = [];
    const websiteProbe: WebsiteProbe = async (candidate) => {
      candidates.push(candidate);
      if (candidate.publicUrl === `https://${TEST_TAILSCALE_DNS}:41731/`) {
        return { path: "/", status: 200, title: "T3 Code" };
      }
      if (candidate.publicUrl === `https://${TEST_TAILSCALE_DNS}/tokdash`) {
        return { path: "/tokdash", status: 200, title: "Tokdash" };
      }
      return null;
    };

    const snapshot = await collectNetworkSnapshot({
      dashboardPort: 80,
      now: () => new Date("2026-07-08T12:00:00.000Z"),
      runner,
      websiteProbe
    });

    expect(candidates.map(({ probeUrl }) => probeUrl)).toContain(
      `https://${TEST_TAILSCALE_DNS}:41731/`
    );
    expect(candidates.map(({ probeUrl }) => probeUrl)).toContain(
      `https://${TEST_TAILSCALE_DNS}/tokdash`
    );
    expect(candidates.map(({ probeUrl }) => probeUrl)).not.toContain(
      `https://${TEST_TAILSCALE_DNS}/`
    );
    expect(snapshot.websites).toEqual([
      expect.objectContaining({
        onlineSince: "2026-07-08T11:40:00.000Z",
        port: 443,
        scopeLabel: "Tailscale Serve",
        title: "Tokdash",
        url: `https://${TEST_TAILSCALE_DNS}/tokdash`
      }),
      expect.objectContaining({
        onlineSince: "2026-07-08T11:50:00.000Z",
        port: 41731,
        scopeLabel: "Tailscale Serve",
        title: "T3 Code",
        url: `https://${TEST_TAILSCALE_DNS}:41731/`
      })
    ]);
  });

  it("warns when tailscale status returns malformed json", async () => {
    const runner: CommandRunner = async (command, args) => {
      const key = `${command} ${args.join(" ")}`;
      if (key === "tailscale ip -4") {
        return { stdout: `${TEST_TAILSCALE_IPV4}\n`, stderr: "" };
      }
      if (key === "tailscale ip -6") {
        return { stdout: "", stderr: "" };
      }
      if (key === "tailscale status --json") {
        return { stdout: "{not-json", stderr: "" };
      }
      if (key === "tailscale serve status --json") {
        return { stdout: "{}", stderr: "" };
      }
      if (key === "ss -H -lntup") {
        return { stdout: "", stderr: "" };
      }

      throw new Error(`Unexpected command: ${key}`);
    };

    const snapshot = await collectNetworkSnapshot({ runner, websiteProbe: WEBSITE_PROBE });

    expect(snapshot.tailscale.warnings).toContain("tailscale status returned malformed JSON");
  });
});
