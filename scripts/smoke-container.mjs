#!/usr/bin/env node
/** Smoke the actual final image, without host node_modules or bind mounts. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { smokeRuntime } from './smoke-runtime.mjs';

export function docker(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdin.end(input);
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`docker ${args[0]} failed: ${stderr.slice(0, 400)}`)));
  });
}

export async function smokeContainer(image, sha, { stagingOverlay = false } = {}) {
  assert(image && !image.startsWith('-'), 'An image reference is required');
  assert(/^[0-9a-f]{40}$/.test(sha), 'A full commit SHA is required');
  const imageEnv = JSON.parse(await docker(['image', 'inspect', '--format', '{{json .Config.Env}}', image]));
  const expectedOrigin = stagingOverlay ? 'https://bc-daylight.staging.adamstuckert.com' : 'https://bcdaylight.ca';
  assert(imageEnv.includes(`ORIGIN=${expectedOrigin}`), 'Image must set its fixed server ORIGIN');
  // Deliberately omit COMMIT_SHA: /version must use the value baked into build/.
  const args = ['run', '--detach', '--publish', '127.0.0.1::3000',
    '--env', 'HOST=0.0.0.0', '--env', 'PORT=3000', '--env', 'NODE_ENV=production'];
  if (stagingOverlay) args.push('--entrypoint', 'node');
  args.push(image);
  if (stagingOverlay) args.push('/app/build');
  const id = await docker(args);
  try {
    const dependencyCheck = await readFile(new URL('./check-runtime-deps.mjs', import.meta.url), 'utf8');
    // Run the same assertion inside the image; no development checker is installed.
    const result = await docker(['exec', '-i', id, 'node', '--input-type=module'],
      `${dependencyCheck}\nconsole.log(JSON.stringify(await checkRuntimeDependencies('/app', { portable: ${stagingOverlay} })));\n`);
    console.log(`Image runtime dependencies: ${result}`);
    const port = await docker(['port', id, '3000/tcp']);
    assert(/^127\.0\.0\.1:\d+$/.test(port), 'Smoke container must bind only to localhost');
    const origin = `http://${port}`;
    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${origin}/version`, { signal: AbortSignal.timeout(1000) });
        ready = response.ok;
        await response.arrayBuffer();
        if (ready) break;
      } catch { /* Wait for the Node listener, bounded by the deadline. */ }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert(ready, 'Container did not start serving /version within 30 seconds');
    const resultSmoke = await smokeRuntime(origin, sha);
    console.log(`Image smoke passed: ${JSON.stringify(resultSmoke)}`);
    return resultSmoke;
  } finally {
    await docker(['rm', '--force', id]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await smokeContainer(process.argv[2], process.argv[3]);
}
