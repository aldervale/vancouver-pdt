import adapter from '@sveltejs/adapter-node';
import { renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
    }
  };
}
