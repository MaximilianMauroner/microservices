import { isIP } from "node:net";
import { CheckError } from "./errors";

function ipv4Number(value: string): number | null {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((total, part) => (total * 256 + Number(part)) >>> 0, 0);
}

function inV4Range(value: number, base: string, bits: number): boolean {
  const start = ipv4Number(base);
  if (start === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (start & mask);
}

const blockedV4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],
  ["192.0.0.0",24],["192.0.2.0",24],["192.88.99.0",24],["192.168.0.0",16],["198.18.0.0",15],["198.51.100.0",24],
  ["203.0.113.0",24],["224.0.0.0",4],["240.0.0.0",4],
];

function expandedIpv6(value: string): number[] | null {
  let input = value.toLowerCase().split("%")[0];
  const embedded = input.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (embedded) {
    const n = ipv4Number(embedded); if (n === null) return null;
    input = input.slice(0, -embedded.length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const sides = input.split("::"); if (sides.length > 2) return null;
  const left = sides[0] ? sides[0].split(":") : [];
  const right = sides[1] ? sides[1].split(":") : [];
  const fill = sides.length === 2 ? 8 - left.length - right.length : 0;
  const groups = [...left, ...Array.from({ length: fill }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => Number.parseInt(g, 16));
}

export function isBlockedAddress(address: string): boolean {
  if (isIP(address) === 4) { const n = ipv4Number(address); return n === null || blockedV4.some(([base,bits]) => inV4Range(n,base,bits)); }
  if (isIP(address) !== 6) return true;
  const g = expandedIpv6(address); if (!g) return true;
  if (g.every((x) => x === 0) || g.every((x, i) => i === 7 ? x === 1 : x === 0)) return true;
  const first = g[0];
  if (g.slice(0,6).every((x)=>x===0) || (first===0x0100&&g.slice(1,4).every((x)=>x===0)) || (first===0x0064&&g[1]===0xff9b&&g[2]===1)) return true;
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00 || (first & 0xffc0) === 0xfec0) return true;
  if ((first===0x2001&&(g[1]&0xfe00)===0) || (first===0x2001&&g[1]===0x0db8) || (first===0x3fff&&(g[1]&0xf000)===0) || first===0x5f00) return true;
  if (g.slice(0,5).every((x) => x === 0) && g[5] === 0xffff) {
    const mapped = ((g[6] << 16) | g[7]) >>> 0;
    return blockedV4.some(([base,bits]) => inV4Range(mapped,base,bits));
  }
  return false;
}

export function validateLiteralTarget(hostname: string): void {
  const address = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (isIP(address) && isBlockedAddress(address)) throw new CheckError("blocked_address", "Target address is not public");
}
