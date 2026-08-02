import { BlockList, isIP } from "node:net";

const PRIVATE_DNS_SUFFIXES = [
  ".internal",
  ".lan",
  ".corp",
  ".home.arpa",
  ".local",
  ".localhost",
] as const;

const AMBIGUOUS_IPV4 = /^(?:0x[0-9a-f]+|[0-9]+)(?:\.(?:0x[0-9a-f]+|[0-9]+)){0,3}$/i;

const PRIVATE_IPV4_SUBNETS = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const;

const NON_PUBLIC_IPV6_SUBNETS = [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const;

function blockList(subnets: readonly (readonly [string, number])[], family: "ipv4" | "ipv6") {
  const list = new BlockList();
  for (const [network, prefix] of subnets) list.addSubnet(network, prefix, family);
  return list;
}

const privateIpv4 = blockList(PRIVATE_IPV4_SUBNETS, "ipv4");
const publicIpv6 = blockList([["2000::", 3]], "ipv6");
const nonPublicIpv6 = blockList(NON_PUBLIC_IPV6_SUBNETS, "ipv6");

export function containsPrivateUrl(value: string) {
  const candidates = [...value.matchAll(/(?=https?:\/\/)/gi)]
    .flatMap((match) => value.slice(match.index).match(/^https?:\/\/[^\s"'<>\\]+/i) ?? []);
  return candidates.some((candidate) =>
    [...new Set([candidate, trimProseTerminator(candidate)])].some((variant) => {
      try {
        const url = new URL(variant);
        return Boolean(url.username || url.password || privateHostname(url.hostname));
      } catch {
        return false;
      }
    }),
  );
}

function trimProseTerminator(value: string) {
  let trimmed = value.replace(/[.,;:!?]+$/g, "");
  const pairs = [["(", ")"], ["[", "]"], ["{", "}"]] as const;
  let changed = true;
  while (changed) {
    changed = false;
    for (const [open, close] of pairs) {
      if (trimmed.endsWith(close) && occurrences(trimmed, close) > occurrences(trimmed, open)) {
        trimmed = trimmed.slice(0, -1).replace(/[.,;:!?]+$/g, "");
        changed = true;
      }
    }
  }
  return trimmed;
}

function occurrences(value: string, character: string) {
  return [...value].filter((candidate) => candidate === character).length;
}

export function privateHostname(value: string) {
  const hostname = value.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const version = isIP(hostname);
  if (version === 4) return privateIpv4.check(hostname, "ipv4");
  if (version === 6) {
    return !publicIpv6.check(hostname, "ipv6") || nonPublicIpv6.check(hostname, "ipv6");
  }
  return (
    AMBIGUOUS_IPV4.test(hostname) ||
    !hostname.includes(".") ||
    hostname === "localhost" ||
    PRIVATE_DNS_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  );
}
