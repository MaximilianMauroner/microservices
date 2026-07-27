import { describe, expect, it } from "vitest";
import {
  CheckError,
  isBlockedAddress,
  normalizeMonitorUrl,
  validatedMonitorUrl,
  validatedRedirectUrl
} from "../src/index.js";

describe("monitor URL validation", () => {
  it("normalizes HTTP URLs and strips fragments", () => {
    expect(normalizeMonitorUrl(" HTTPS://Example.COM/path#secret ")).toBe(
      "https://example.com/path"
    );
  });

  it("rejects invalid schemes and embedded credentials", () => {
    expect(() => normalizeMonitorUrl("file:///etc/passwd")).toThrow(CheckError);
    expect(() =>
      normalizeMonitorUrl("https://owner:secret@example.com")
    ).toThrow(/credentials/);
  });

  it.each([
    "0.0.0.1",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "172.16.0.1",
    "192.0.0.1",
    "192.0.2.1",
    "192.88.99.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "240.0.0.1",
    "::",
    "::1",
    "fc00::1",
    "fe80::1",
    "ff00::1",
    "fec0::1",
    "2001:db8::1",
    "3fff::1",
    "5f00::1",
    "::ffff:10.0.0.1",
    "64:ff9b::10.0.0.1",
    "2002:0a00:0001::1"
  ])("blocks reserved literal %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])(
    "allows public literal %s",
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
      const host = address.includes(":") ? `[${address}]` : address;
      expect(validatedMonitorUrl(`https://${host}/`).hostname).toBeTruthy();
    }
  );

  it("validates both initial and redirected literal targets", () => {
    expect(() => validatedMonitorUrl("http://127.0.0.1")).toThrow(
      /not public/
    );
    expect(() =>
      validatedRedirectUrl(
        "http://[::ffff:192.168.1.1]/",
        new URL("https://example.com/")
      )
    ).toThrow(/not public/);
    expect(
      validatedRedirectUrl("/health", new URL("https://example.com/base"))
        .toString()
    ).toBe("https://example.com/health");
  });
});
