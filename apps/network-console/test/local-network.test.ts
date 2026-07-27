import { describe, expect, it } from "vitest";
import request from "supertest";
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

    const html = await request(app).get("/").expect(200);
    expect(html.headers["content-type"]).toContain("text/html");
    expect(html.text).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg">');
    expect(html.text).toContain(TEST_TAILSCALE_IPV4);
    expect(html.text).toContain("Websites");
    expect(html.text).toContain("Example App");
    expect(html.text).toContain(`href="http://${TEST_TAILSCALE_IPV4}:3000/orders"`);
    expect(html.text).toContain('target="_blank" rel="noopener"');
    expect(html.text).toContain('<img class="website-favicon"');
    expect(html.text).not.toContain("<iframe");
    expect(html.text).not.toContain("website-preview");
    expect(html.text).toContain("<code>kill 863</code>");
    expect(html.text).toContain("Online since");
    expect(html.text).toContain('datetime="2026-07-08T11:00:00.000Z"');
    expect(html.text).toContain('>1h0m</time>');
    expect(html.text).toContain("Other listeners");

    const favicon = await request(app).get("/favicon.svg").expect(200);
    expect(favicon.headers["content-type"]).toContain("image/svg+xml");
    expect(favicon.headers["cache-control"]).toBe("public, max-age=86400");
    expect(favicon.body.toString("utf8")).toContain("<svg");

    const json = await request(app).get("/api/ports").expect(200);
    expect(json.body).toMatchObject({
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
      if (key === "ss -H -lntup") {
        return { stdout: "", stderr: "" };
      }

      throw new Error(`Unexpected command: ${key}`);
    };

    const snapshot = await collectNetworkSnapshot({ runner, websiteProbe: WEBSITE_PROBE });

    expect(snapshot.tailscale.warnings).toContain("tailscale status returned malformed JSON");
  });
});
