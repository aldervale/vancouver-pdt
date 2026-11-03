/**
 * Shared by the adapter-node handler and Vite preview. No proxy/environment
 * headers are trusted: only the actual Host can select production behavior.
 * The staging gateway still owns its HSTS, cache, auth and indexing policies.
 */

/** @type {NonNullable<NonNullable<import('@sveltejs/kit').Config['kit']>['csp']>['directives']} */
export const cspDirectives = {
  'default-src': ['self'],
  'script-src': ['self'],
  'script-src-attr': ['none'],
  // Svelte SSR attributes, clock-map positioning and driver.js use inline
  // styles. This exception is for styles only, never inline scripts or eval.
  'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
  'font-src': ['self', 'https://fonts.gstatic.com'],
  'img-src': ['self', 'data:'],
  'connect-src': ['self'],
  'object-src': ['none'],
  'base-uri': ['none'],
  'frame-ancestors': ['none'],
  'form-action': ['self']
};

// SvelteKit replaces this with its full nonce/hash policy for rendered pages.
// Do not set a competing script policy here: prerendered pages, if added, carry
// their own hash policy in a meta tag; frame-ancestors must remain an HTTP header.
export const fallbackCsp = "base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'";

export const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  'content-security-policy': fallbackCsp
};

/** @param {string | undefined} host */
export function isProductionHost(host) {
  return /^(?:www\.)?bcdaylight\.ca(?::(?:80|443))?$/i.test(host || '');
}

/**
 * Keep the authority fixed, including for a request-target beginning with //.
 * Preserve the original path/escaping/query rather than reparsing it as a URL.
 * @param {string | undefined} host
 * @param {string | undefined} requestTarget
 */
export function canonicalLocation(host, requestTarget) {
  if (!/^www\.bcdaylight\.ca(?::(?:80|443))?$/i.test(host || '')) return null;
  if (!requestTarget?.startsWith('/') || /[\r\n]/.test(requestTarget)) return null;
  return `https://bcdaylight.ca${requestTarget}`;
}

/**
 * Install before adapter-node's static, prerendered and SSR handlers. Defaults
 * do not replace headers already supplied by a hosting gateway/middleware;
 * SvelteKit may replace the fallback CSP with its response-specific nonce.
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @param {() => void} next
 */
export function securityMiddleware(request, response, next) {
  for (const [name, value] of Object.entries(securityHeaders)) {
    if (!response.hasHeader(name)) response.setHeader(name, value);
  }
  if (isProductionHost(request.headers.host) && !response.hasHeader('strict-transport-security')) {
    // No includeSubDomains/preload: other subdomains have not been audited.
    response.setHeader('strict-transport-security', 'max-age=31536000');
  }
  const location = canonicalLocation(request.headers.host, request.url);
  if (location) {
    response.writeHead(308, { location });
    response.end();
    return;
  }
  return next();
}
