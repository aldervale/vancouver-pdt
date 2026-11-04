import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkRuntimeDependencies } from '../../../scripts/check-runtime-deps.mjs';
import { assertIndependentGatewayRuntime } from '../../../scripts/staging-runtime.mjs';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function dependencyFixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'bc-runtime-'));
  directories.push(root);
  await mkdir(resolve(root, 'node_modules/suncalc'), { recursive: true });
  await writeFile(resolve(root, 'package.json'), JSON.stringify({ dependencies: { suncalc: '^1.9.0' } }));
  await writeFile(resolve(root, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': {},
      'node_modules/suncalc': { version: '1.9.0' },
      'node_modules/vite': { version: '6.0.0', dev: true }
    }
  }));
  await writeFile(resolve(root, 'node_modules/suncalc/package.json'), JSON.stringify({ version: '1.9.0' }));
  return root;
}

describe('production runtime package checks', () => {
  it('accepts only lockfile-matching production packages', async () => {
    const root = await dependencyFixture();
    expect((await checkRuntimeDependencies(root)).packages).toEqual(['node_modules/suncalc']);
  });
  it('rejects leftover development packages', async () => {
    const root = await dependencyFixture();
    await mkdir(resolve(root, 'node_modules/vite'));
    await writeFile(resolve(root, 'node_modules/vite/package.json'), JSON.stringify({ version: '6.0.0' }));
    await expect(checkRuntimeDependencies(root)).rejects.toThrow('Development or unlocked');
  });
  it('rejects missing, mismatched and untracked packages', async () => {
    const root = await dependencyFixture();
    await writeFile(resolve(root, 'node_modules/suncalc/package.json'), JSON.stringify({ version: '0.0.0' }));
    await expect(checkRuntimeDependencies(root)).rejects.toThrow('differs from lockfile');
    await rm(resolve(root, 'node_modules/suncalc'), { recursive: true });
    await expect(checkRuntimeDependencies(root)).rejects.toThrow('Missing production');
    await mkdir(resolve(root, 'node_modules/leftover'));
    await expect(checkRuntimeDependencies(root)).rejects.toThrow('Development or unlocked');
  });
});

const runtime = (source = "const { spawn } = require('node:child_process'); spawn('node', ['/app/build']);") => ({
  node: 'v22.0.0', executable: '/usr/local/bin/node', processes: [
    { executable: '/usr/local/bin/node', entrypoint: '/app/build' },
    { executable: '/usr/local/bin/node', entrypoint: '/infra/supervisor.js', source }
  ]
});

describe('staging gateway runtime guard', () => {
  it('accepts an independent builtin-only supervisor without changing its runtime', () => {
    expect(assertIndependentGatewayRuntime(runtime())).toBe('v22.0.0');
    expect(assertIndependentGatewayRuntime(runtime("import { spawn } from 'node:child_process'; spawn('node', ['/app/build']);"))).toBe('v22.0.0');
  });
  for (const source of [
    "require('/app/node_modules/some-gateway')", "require('some-gateway')", "require('./local-wrapper')",
    'require(process.env.DEPENDENCY)', "import('node:module')", "const load = require; load('gateway');",
    "import { createRequire } from 'node:module';", "eval(process.env.CODE)"
  ]) {
    it(`refuses an unknown wrapper dependency: ${source}`, () => {
      expect(() => assertIndependentGatewayRuntime(runtime(source))).toThrow();
    });
  }
  it('fails closed on unreadable, missing or different-runtime processes', () => {
    expect(() => assertIndependentGatewayRuntime({ ...runtime(), processes: [] })).toThrow();
    expect(() => assertIndependentGatewayRuntime({ ...runtime(), processes: [{ error: true }] })).toThrow();
    const loaders = { ...runtime(), processes: [{ ...runtime().processes[0], moduleEnvironment: true }] };
    expect(() => assertIndependentGatewayRuntime(loaders)).toThrow('NODE_OPTIONS or NODE_PATH');
    const different = runtime();
    different.processes[0].executable = '/other/node';
    expect(() => assertIndependentGatewayRuntime(different)).toThrow('multiple Node');
  });
});

describe('container workflow wiring', () => {
  it('builds a separate production dependency tree and preserves commit provenance', async () => {
    const file = await readFile('Dockerfile', 'utf8');
    expect(file).toContain('ENV ORIGIN=https://bcdaylight.ca');
    expect(file).toContain('ARG COMMIT_SHA=dev');
    expect(file).toContain('ENV COMMIT_SHA=$COMMIT_SHA');
    expect(file).toContain('npm ci --omit=dev');
    expect(file).toContain('COPY --from=production-dependencies /app/node_modules');
    expect(file).not.toContain('COPY --from=builder /app/node_modules');
    expect(await readFile('.dockerignore', 'utf8')).toContain('node_modules');
  });
  it('clears old staging assets/dependencies while preserving the gateway image', async () => {
    const overlay = await readFile('deploy/staging/Dockerfile.overlay', 'utf8');
    expect(overlay).toContain('FROM ${BASE_IMAGE}');
    expect(overlay).toContain('npm ci --omit=dev');
    expect(overlay).toContain('RUN rm -rf /app/build /app/node_modules');
    expect(overlay).toContain('/app/node_modules/');
    expect(overlay).toContain('ENV ORIGIN=https://bc-daylight.staging.adamstuckert.com');
    expect(overlay).not.toMatch(/^(?:CMD|ENTRYPOINT|EXPOSE)\b/m);
    const deploy = await readFile('scripts/deploy-staging.mjs', 'utf8');
    expect(deploy.indexOf('assertIndependentGatewayRuntime(runtime)')).toBeLessThan(deploy.indexOf('const image = await buildOverlay'));
    expect(deploy.indexOf('await smokeContainer(tag')).toBeLessThan(deploy.indexOf("log('Pushing the staging image')"));
  });
  it('gates QA and staging on actual final-image smoke tests', async () => {
    for (const path of ['.github/workflows/qa.yml', '.github/workflows/deploy-staging.yml']) {
      const workflow = await readFile(path, 'utf8');
      expect(workflow).toContain('docker build --pull --build-arg COMMIT_SHA=');
      expect(workflow).toContain('node scripts/smoke-container.mjs');
    }
  });
});
