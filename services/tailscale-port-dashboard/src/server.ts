import { execFile } from "node:child_process";
import { createLocalNetworkDashboardApp } from "./local-network.js";

const port = parsePort(process.env.PORT ?? process.env.LOCAL_NETWORK_PORT, 80);
const bindHost = process.env.BIND_HOST ?? (await getDefaultBindHost());
const app = createLocalNetworkDashboardApp({ dashboardPort: port });

app.listen(port, bindHost, () => {
  console.log(`tailscale-port-dashboard listening on ${bindHost}:${port}`);
});

function parsePort(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return parsed;
}

async function getDefaultBindHost() {
  const tailscaleIp = await getFirstTailscaleAddress();
  if (tailscaleIp) {
    return tailscaleIp;
  }

  if (process.env.REQUIRE_TAILSCALE_BIND === "true") {
    throw new Error("No Tailscale address available for binding");
  }

  return "127.0.0.1";
}

async function getFirstTailscaleAddress(): Promise<string | null> {
  return (await getFirstTailscaleIp(["ip", "-4"])) ?? (await getFirstTailscaleIp(["ip", "-6"]));
}

async function getFirstTailscaleIp(args: readonly string[]): Promise<string | null> {
  try {
    const stdout = await execFileText("tailscale", args);
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? null;
  } catch {
    return null;
  }
}

function execFileText(command: string, args: readonly string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        encoding: "utf8",
        maxBuffer: 64 * 1024,
        timeout: 2_500
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(String(stdout));
      }
    );
  });
}
