#!/usr/bin/env node
/** Exercise the real overlay against a non-root/no-npm gateway stand-in. */
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { docker, smokeContainer } from './smoke-container.mjs';
import { assertGatewayImageConfigPreserved, overlayRuntimeUser, runtimeConfigFormat } from './staging-overlay.mjs';

const [productionImage, sha] = process.argv.slice(2);
assert(productionImage && /^[0-9a-f]{40}$/.test(sha), 'Usage: smoke-staging-overlay.mjs TESTED_IMAGE FULL_SHA');
const work = await mkdtemp(resolve(tmpdir(), 'bc-overlay-smoke-'));
const fixture = 'bcdaylight-gateway:fixture';
const overlay = 'bcdaylight-overlay:fixture';
let sourceContainer;
try {
  await docker(['build', '-f', 'deploy/staging/Dockerfile.fixture', '-t', fixture, '.']);
  await docker(['run', '--rm', '--entrypoint', 'sh', fixture, '-c', 'test "$(id -u)" != 0 && ! command -v npm']);
  const before = JSON.parse(await docker(['image', 'inspect', '--format', runtimeConfigFormat, fixture]));
  sourceContainer = await docker(['create', productionImage]);
  await docker(['cp', `${sourceContainer}:/app/build`, resolve(work, 'app-build')]);
  for (const name of ['package.json', 'package-lock.json']) await cp(name, resolve(work, name));
  await cp('scripts/check-runtime-deps.mjs', resolve(work, 'check-runtime-deps.mjs'));
  await writeFile(resolve(work, 'Dockerfile'), await readFile('deploy/staging/Dockerfile.overlay'));
  await docker(['build', '--build-arg', `BASE_IMAGE=${fixture}`, '--build-arg', `RUNTIME_USER=${overlayRuntimeUser(before)}`, '-t', overlay, work]);
  const after = JSON.parse(await docker(['image', 'inspect', '--format', runtimeConfigFormat, overlay]));
  assertGatewayImageConfigPreserved(before, after);
  await docker(['run', '--rm', '--entrypoint', 'sh', overlay, '-c',
    'test "$(id -u)" != 0 && ! command -v npm && test ! -e /app/build/removed-before-overlay.txt && test ! -e /app/node_modules/old-development-package']);
  await smokeContainer(overlay, sha, { stagingOverlay: true });
  console.log('Non-root/no-npm overlay smoke passed; launch configuration and user preserved.');
} finally {
  if (sourceContainer) await docker(['rm', '--force', sourceContainer]);
  await rm(work, { recursive: true, force: true });
}
