export const productAccents = ["lime", "violet", "amber", "cyan", "rose", "blue"] as const;

export type ProductAccent = (typeof productAccents)[number];
