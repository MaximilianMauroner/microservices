/** Builds the document policy while allowing Vite to inject styles in development. */
export function documentContentSecurityPolicy(
  nonce: string,
  development: boolean
): string {
  const styleSources = development
    ? "'self' 'unsafe-inline'"
    : `'self' 'nonce-${nonce}'`;

  return `default-src 'none'; style-src ${styleSources}; style-src-attr 'unsafe-inline'; script-src 'self' 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
}
