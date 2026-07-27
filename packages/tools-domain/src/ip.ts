import { isIP } from "node:net";
import { CheckError } from "./errors.js";

function ipv4Number(value: string): number | null {
  const parts = value.split(".");
  if (
    parts.length !== 4 ||
    parts.some(
      (part) => !/^\d{1,3}$/.test(part) || Number(part) > 255
    )
  ) {
    return null;
  }
  return parts.reduce(
    (total, part) => (total * 256 + Number(part)) >>> 0,
    0
  );
}

function inV4Range(value: number, base: string, bits: number): boolean {
  const start = ipv4Number(base);
  if (start === null) {
    return false;
  }
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (start & mask);
}

const BLOCKED_V4: ReadonlyArray<readonly [string, number]> = [
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
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
];

function blockedEmbeddedV4(high: number, low: number): boolean {
  const value = ((high << 16) | low) >>> 0;
  return BLOCKED_V4.some(([base, bits]) => inV4Range(value, base, bits));
}

function expandedIpv6(value: string): number[] | null {
  let input = value.toLowerCase().split("%")[0];
  const embedded = input.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (embedded) {
    const numeric = ipv4Number(embedded);
    if (numeric === null) {
      return null;
    }
    input =
      input.slice(0, -embedded.length) +
      `${(numeric >>> 16).toString(16)}:${(numeric & 0xffff).toString(16)}`;
  }
  const sides = input.split("::");
  if (sides.length > 2) {
    return null;
  }
  const left = sides[0] ? sides[0].split(":") : [];
  const right = sides[1] ? sides[1].split(":") : [];
  const fill = sides.length === 2 ? 8 - left.length - right.length : 0;
  const groups = [
    ...left,
    ...Array.from({ length: fill }, () => "0"),
    ...right
  ];
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))
  ) {
    return null;
  }
  return groups.map((group) => Number.parseInt(group, 16));
}

export function isBlockedAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const numeric = ipv4Number(address);
    return (
      numeric === null ||
      BLOCKED_V4.some(([base, bits]) => inV4Range(numeric, base, bits))
    );
  }
  if (isIP(address) !== 6) {
    return true;
  }

  const groups = expandedIpv6(address);
  if (!groups) {
    return true;
  }
  if (
    groups.every((group) => group === 0) ||
    groups.every((group, index) => (index === 7 ? group === 1 : group === 0))
  ) {
    return true;
  }

  const first = groups[0];
  if (
    groups.slice(0, 6).every((group) => group === 0) ||
    (first === 0x0100 && groups.slice(1, 4).every((group) => group === 0)) ||
    (first === 0x0064 && groups[1] === 0xff9b && groups[2] === 1)
  ) {
    return true;
  }
  if (
    first === 0x0064 &&
    groups[1] === 0xff9b &&
    groups.slice(2, 6).every((group) => group === 0) &&
    blockedEmbeddedV4(groups[6], groups[7])
  ) {
    return true;
  }
  if (first === 0x2002 && blockedEmbeddedV4(groups[1], groups[2])) {
    return true;
  }
  if (
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00 ||
    (first & 0xffc0) === 0xfec0
  ) {
    return true;
  }
  if (
    (first === 0x2001 && (groups[1] & 0xfe00) === 0) ||
    (first === 0x2001 && groups[1] === 0x0db8) ||
    (first === 0x3fff && (groups[1] & 0xf000) === 0) ||
    first === 0x5f00
  ) {
    return true;
  }
  if (
    groups.slice(0, 5).every((group) => group === 0) &&
    groups[5] === 0xffff
  ) {
    const mapped = ((groups[6] << 16) | groups[7]) >>> 0;
    return BLOCKED_V4.some(([base, bits]) =>
      inV4Range(mapped, base, bits)
    );
  }
  return false;
}

export function validateLiteralTarget(hostname: string): void {
  const address =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  if (isIP(address) && isBlockedAddress(address)) {
    throw new CheckError("blocked_address", "Target address is not public");
  }
}
