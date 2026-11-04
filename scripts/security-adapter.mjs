import adapter from '@sveltejs/adapter-node';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Recent adapter-node 5 releases import the handler from a shared chunk, so
 * replacing handler.js alone no longer covers the stock `node build` server.
 * Change only the middleware passed to Polka; retain the stock lifecycle.
 * Fail the build if the generated entrypoint changes instead of silently
 * shipping a server that bypasses security headers.
 * @param {string} source
 */
export function secureNodeEntrypoint(source) {
  const original = 'const server = polka({ server: httpServer }).use(handler);';
  if (source.split(original).length !== 2 || /\b__bcSecurityHandler\b/.test(source)) {
    throw new Error('Unsupported adapter-node entrypoint: expected exactly one stock handler registration');
  }
  return [
    "import { handler as __bcSecurityHandler } from './handler.js';",
    source.replace(original, 'const server = polka({ server: httpServer }).use(__bcSecurityHandler);')
  ].join('\n');
}

/**
 * Keep adapter-node's stock entrypoint, lifecycle and all static/cache behavior.
 * Wrapping its public handler covers assets that never reach SvelteKit hooks.
 * Everything is inside build/, including for the existing staging overlay.
 * @returns {import('@sveltejs/kit').Adapter}
 */
export default function securityAdapter() {
  const node = adapter();
  return {
    ...node,
    name: 'adapter-node-with-security-headers',
    async adapt(builder) {
      await node.adapt(builder);
      const entrypoint = secureNodeEntrypoint(readFileSync('build/index.js', 'utf8'));
      renameSync('build/handler.js', 'build/sveltekit-handler.js');
      builder.copy(fileURLToPath(new URL('./security-headers.mjs', import.meta.url)), 'build/security-headers.mjs');
      writeFileSync('build/handler.js', [
        "import { handler as sveltekitHandler } from './sveltekit-handler.js';",
        "import { securityMiddleware } from './security-headers.mjs';",
        'export function handler(req, res, next) {',
        '  return securityMiddleware(req, res, () => sveltekitHandler(req, res, next));',
        '}',
        ''
      ].join('\n'));
      writeFileSync('build/index.js', entrypoint);
    }
  };
}
