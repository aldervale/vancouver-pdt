import { describe, expect, it, vi } from 'vitest';

// Test the generated-entrypoint transformation without loading Rollup into
// jsdom. The real adapter and output are covered by the Node API E2E tests.
vi.mock('@sveltejs/adapter-node', () => ({ default: vi.fn() }));

import { secureNodeEntrypoint } from '../../../scripts/security-adapter.mjs';

const registration = 'const server = polka({ server: httpServer }).use(handler);';

describe('adapter-node stock entrypoint security wrapper', () => {
  it.each([
    "import { handler } from './handler.js';",
    "import { p as polka, h as handler, f as format_listening_address } from './server/chunks/handler-hash.js';"
  ])('wraps the stock server independently of the generated handler import: %s', (handlerImport) => {
    const lifecycle = "server.listen({ host, port });\nprocess.on('SIGTERM', shutdown);\nexport { server };";
    const result = secureNodeEntrypoint([handlerImport, registration, lifecycle].join('\n'));
    expect(result).toContain("import { handler as __bcSecurityHandler } from './handler.js';");
    expect(result).toContain(handlerImport);
    expect(result).toContain('const server = polka({ server: httpServer }).use(__bcSecurityHandler);');
    expect(result).toContain(lifecycle);
    expect(result).not.toContain(registration);
  });

  it.each([
    'const server = customServer(handler);',
    `${registration}\n${registration}`,
    `const __bcSecurityHandler = something;\n${registration}`
  ])('fails closed when the generated entrypoint is unexpected', (source) => {
    expect(() => secureNodeEntrypoint(source)).toThrow('Unsupported adapter-node entrypoint');
  });
});
