export const productAccents = ["lime", "emerald", "violet", "cyan", "rose", "blue"] as const;

export type ProductAccent = (typeof productAccents)[number];
