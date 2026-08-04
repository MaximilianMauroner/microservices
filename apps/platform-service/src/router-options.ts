export function routerSsrOptions(nonce?: string) {
  return nonce ? { ssr: { nonce } } : {};
}
