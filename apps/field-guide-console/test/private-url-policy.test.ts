import { describe, expect, it } from "vitest";
import { containsPrivateUrl, privateHostname } from "../src/private-url-policy.js";

describe("private URL policy", () => {
  it.each([
    "localhost",
    "service",
    "metadata.google.internal",
    "service.corp",
    "router.home.arpa",
    "printer.local",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "127.1",
    "0x7f.0.0.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "2001:db8::1",
  ])("rejects private or special-use hostname %s", (hostname) => {
    expect(privateHostname(hostname)).toBe(true);
  });

  it.each([
    "example.com",
    "8.8.8.8",
    "1.1.1.1",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
  ])("allows public hostname %s", (hostname) => {
    expect(privateHostname(hostname)).toBe(false);
  });

  it("rejects credentials and private hosts found inside text", () => {
    expect(containsPrivateUrl("See https://user:password@example.com/path")).toBe(true);
    expect(containsPrivateUrl("See http://service.corp/internal")).toBe(true);
    expect(containsPrivateUrl("See https://example.com/reference")).toBe(false);
  });

  it.each([
    "See http://127.0.0.1).",
    "See http://10.0.0.1, then continue",
    "See https://[::1].",
    "See https://[::1]).",
    "See http://service.corp];",
  ])("ignores ordinary prose terminators around private URL %s", (value) => {
    expect(containsPrivateUrl(value)).toBe(true);
  });

  it.each([
    "See https://example.com/docs_(v2).",
    "See https://example.com/path?next=(ok)",
    "See https://example.com/items;version=2",
  ])("retains valid public URL punctuation in %s", (value) => {
    expect(containsPrivateUrl(value)).toBe(false);
  });

  it.each([
    "See https://example.com/?next=http://127.0.0.1/admin",
    "See https://example.com/http://service.corp/internal",
    "See https://example.com/?next=https://user:password@internal.corp/",
  ])("scans every nested URL scheme in %s", (value) => {
    expect(containsPrivateUrl(value)).toBe(true);
  });
});
