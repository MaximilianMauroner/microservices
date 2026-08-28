/** Builds the document policy while allowing Vite to inject styles in development. */
export function documentContentSecurityPolicy(
  nonce: string,
  development: boolean,
  connectOrigins: readonly string[] = []
): string {
  const styleSources = development
    ? "'self' 'unsafe-inline'"
    : `'self' 'nonce-${nonce}'`;

  const connectSources = ["'self'", ...connectOrigins].join(" ");
  return `default-src 'none'; style-src ${styleSources}; style-src-attr 'unsafe-inline'; script-src 'self' 'nonce-${nonce}'; connect-src ${connectSources}; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
}
