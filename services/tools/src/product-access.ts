import type { PlatformPrincipal } from "@tools-platform/security";

/** A product is listed here only once its data belongs to each person, so a grant never shows the admin's data. */
export const GRANTABLE_PRODUCTS = {
  kitchen: { label: "Kitchen", paths: ["/kitchen", "/api/kitchen"] }
} as const satisfies Record<string, Readonly<{ label: string; paths: readonly [string, ...string[]] }>>;

export type GrantableProductId = keyof typeof GRANTABLE_PRODUCTS;

export function isGrantableProduct(id: string): id is GrantableProductId {
  return Object.hasOwn(GRANTABLE_PRODUCTS, id);
}

export function grantedProducts(principal: PlatformPrincipal): readonly GrantableProductId[] {
  return principal.role === "admin" ? [] : principal.products.filter(isGrantableProduct);
}

export function principalMayOpen(principal: PlatformPrincipal, pathname: string): boolean {
  if (principal.role === "admin" || pathname === "/settings") return true;
  return grantedProducts(principal).some((id) => GRANTABLE_PRODUCTS[id].paths.some((path) =>
    pathname === path || pathname.startsWith(`${path}/`)));
}

export function homePath(principal: PlatformPrincipal): string {
  if (principal.role === "admin") return "/";
  const [first] = grantedProducts(principal);
  return first ? GRANTABLE_PRODUCTS[first].paths[0] : "/settings";
}

/** Navigation shows a member only their granted products. The gateway is the security check. */
export function principalSeesProduct(principal: PlatformPrincipal | undefined, productId: string): boolean {
  if (!principal) return false;
  return principal.role === "admin" || (isGrantableProduct(productId) && grantedProducts(principal).includes(productId));
}
