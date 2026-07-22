export interface DiscordPayload { allowed_mentions: { parse: string[] }; embeds: Array<{ title: string; description: string; color: number; timestamp: string; url: string }> }
export function safeMonitorName(value: string): string { return value.replace(/[@`*_~|<>]/g, "").replace(/[\r\n]+/g, " ").trim().slice(0, 80) || "Monitor"; }
export function discordEmbed(input: { kind: "down" | "recovery" | "test"; name: string; hostname: string; at: string; dashboardUrl: string; detail?: string }): DiscordPayload {
  const labels = { down: ["Monitor down", 0xdc2626], recovery: ["Monitor recovered", 0x16a34a], test: ["Uptime test notification", 0x2563eb] } as const;
  const [title,color] = labels[input.kind];
  return { allowed_mentions: { parse: [] }, embeds: [{ title, description: `**${safeMonitorName(input.name)}** · ${input.hostname}${input.detail ? `\n${input.detail.slice(0, 240)}` : ""}`, color, timestamp: input.at, url: input.dashboardUrl }] };
}
