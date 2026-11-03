export const productAccents = ["lime", "violet", "cyan", "rose", "blue"] as const;

export type ProductAccent = (typeof productAccents)[number];
