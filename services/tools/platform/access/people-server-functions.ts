import { createServerFn, getGlobalStartContext } from "@tanstack/react-start";
import { requirePlatformSession } from "../auth/middleware.js";
import { GRANTABLE_PRODUCTS, isGrantableProduct, type GrantableProductId } from "./product-access.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function people() {
  const runtime = getGlobalStartContext()?.runtime;
  if (!runtime) throw new Error("People runtime is unavailable.");
  return runtime.people;
}

function personId(input: { personId: unknown }) {
  if (typeof input.personId !== "string" || !UUID.test(input.personId)) throw new Error("Unknown person.");
  return input.personId;
}

export const getPeople = createServerFn({ method: "GET" })
  .middleware([requirePlatformSession])
  .handler(async () => ({
    people: await people().list(),
    products: Object.entries(GRANTABLE_PRODUCTS).map(([id, product]) => ({ id: id as GrantableProductId, label: product.label }))
  }));

export const invitePerson = createServerFn({ method: "POST" })
  .middleware([requirePlatformSession])
  .validator((input: { email: unknown }) => {
    if (typeof input.email !== "string") throw new Error("Enter a valid email address.");
    return { email: input.email };
  })
  .handler(({ data }) => people().invite(data.email));

export const setPersonGrant = createServerFn({ method: "POST" })
  .middleware([requirePlatformSession])
  .validator((input: { personId: unknown; productId: unknown; granted: unknown }) => {
    if (typeof input.productId !== "string" || !isGrantableProduct(input.productId)) throw new Error("This tool cannot be shared yet.");
    if (typeof input.granted !== "boolean") throw new Error("Choose grant or remove.");
    return { personId: personId(input), productId: input.productId, granted: input.granted };
  })
  .handler(({ data }) => people().setGrant(data.personId, data.productId, data.granted));

export const removePerson = createServerFn({ method: "POST" })
  .middleware([requirePlatformSession])
  .validator((input: { personId: unknown }) => ({ personId: personId(input) }))
  .handler(({ data }) => people().remove(data.personId));
