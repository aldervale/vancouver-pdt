#!/usr/bin/env node
/**
 * Deploy the tested build to Fly app bcdaylight-staging only.
 * Overlays /app/build onto the running image so the gateway stays.
 * Does not release a new app config and does not target production.
 */

import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkStaging, collectObservations } from './check-staging.mjs';
import {
  ALLOWED_MACHINE_ENV_KEYS,
  STAGING_APP,
  STAGING_IMAGE_PREFIX,
  STAGING_ORIGIN,
  VERSION_SKIP_ROUTE,
  applyRollback,
  assertBuildContainsCommit,
  assertSessionEnv,
  assertStagingApp,
  assertStagingImageRef,
  assertStagingOrigin,
  collectSkipRoutes,
  configPathsFromProcessList,
  isSafeConfigPath,
  mergeSkipRoutes,
  parseEnvFile,
  planStagingUpdate,
  proceedToDeploy,
  redactSecrets,
  selectStagingMachine
} from './staging-machine.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rollbackPath = resolve(root, 'deploy/staging/.rollback.json');
const apiBase = 'https://api.machines.dev/v1';

function log(message) {
  console.log(redactSecrets(message));
}

function fail(message) {
  console.error(redactSecrets(message));
  process.exitCode = 1;
}

function token() {
  const value = process.env.FLY_API_TOKEN_STAGING;
  if (!value) {
    throw new Error(
      'Missing GitHub Actions secret FLY_API_TOKEN_STAGING. Add a Fly deploy token scoped to bcdaylight-staging. This workflow does not deploy production.'
    );
  }
  return value;
}

function childEnv() {
  const env = { ...process.env };
  delete env.FLY_API_TOKEN;
  delete env.FLY_API_TOKEN_STAGING;
  return env;
}

async function fly(path, { method = 'GET', body, lease } = {}) {
  const headers = {
    Authorization: `Bearer ${token()}`,
    'Content-Type': 'application/json'
  };
  if (lease) headers['fly-machine-lease-nonce'] = lease;
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Fly API ${method} ${path} failed (${response.status}): ${redactSecrets(text).slice(0, 400)}`);
  }
  if (!text) return {};
  return JSON.parse(text);
}

function run(command, args, { input, cwd, capture = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: [input === undefined ? 'ignore' : 'pipe', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'],
      env: childEnv()
    });
    let stdout = '';
    let stderr = '';
    if (capture) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
    }
    if (input !== undefined) child.stdin.end(input);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${command} ${args[0] || ''} failed (${code}): ${redactSecrets(stderr).slice(0, 400)}`));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}

async function execMachine(machineId, command) {
  const result = await fly(`/apps/${STAGING_APP}/machines/${machineId}/exec`, {
    method: 'POST',
    body: { command, timeout: 30 }
  });
  if (result.exit_code) {
    throw new Error(`remote command failed (${result.exit_code}): ${redactSecrets(result.stderr || '').slice(0, 200)}`);
  }
  return result.stdout || '';
}

async function withLease(machineId, fn) {
  const lease = await fly(`/apps/${STAGING_APP}/machines/${machineId}/lease`, {
    method: 'POST',
    body: { ttl: 300 }
  });
  const nonce = lease?.data?.nonce || lease?.nonce;
  if (!nonce) throw new Error('Fly lease response did not include a nonce');
  try {
    return await fn(nonce);
  } finally {
    await fly(`/apps/${STAGING_APP}/machines/${machineId}/lease`, {
      method: 'DELETE',
      lease: nonce
    }).catch(() => {});
  }
}

async function updateMachine(machine, config) {
  await withLease(machine.id, (nonce) =>
    fly(`/apps/${STAGING_APP}/machines/${machine.id}`, {
      method: 'POST',
      lease: nonce,
      body: {
        config,
        region: machine.region,
        skip_launch: false
      }
    })
  );
}

async function readRollback() {
  try {
    return JSON.parse(await readFile(rollbackPath, 'utf8'));
  } catch {
    return null;
  }
}

async function writeRollback(descriptor) {
  await mkdir(dirname(rollbackPath), { recursive: true });
  await writeFile(rollbackPath, JSON.stringify(descriptor), { mode: 0o600 });
}

function assertRollbackIsSafe(descriptor) {
  const blob = JSON.stringify(descriptor);
  for (const key of ['client_secret', 'cookie_secret', 'FLY_API_TOKEN', 'password']) {
    if (blob.toLowerCase().includes(key)) {
      throw new Error('Refusing to write a rollback file that contains secret material');
    }
  }
  const envGroups = [descriptor.env || {}, ...(descriptor.containers || []).map((item) => item.env || {})];
  for (const env of envGroups) {
    for (const key of Object.keys(env)) {
      if (!ALLOWED_MACHINE_ENV_KEYS.includes(key)) throw new Error(`Unexpected rollback env key ${key}`);
    }
  }
}

async function rollbackFromFile() {
  assertStagingApp(STAGING_APP);
  const saved = await readRollback();
  if (!saved?.applied) {
    log('No applied staging update to roll back.');
    return;
  }
  assertRollbackIsSafe(saved);
  const machine = await fly(`/apps/${STAGING_APP}/machines/${saved.machineId}`);
  const restored = applyRollback(machine.config, saved);
  log(`Rolling back ${STAGING_APP} machine ${saved.machineId} to ${saved.image}`);
  await updateMachine({ id: saved.machineId, region: machine.region }, restored);
  saved.applied = false;
  await writeRollback(saved);
  log('Rollback requested. Staging is returning to the previous image, command, and session env.');
}

async function readGatewayConfigFiles(machineId) {
  let listing = '';
  try {
    listing = await execMachine(machineId, [
      'sh',
      '-c',
      'ps -eo args=; echo; find /etc /opt /app /usr/local/etc /srv -type f \\( -iname "*oauth2*" -o -name supervisord.conf -o -name oauth2-proxy.cfg \\) -size -256k 2>/dev/null'
    ]);
  } catch (error) {
    return [
      {
        path: '(staging gateway)',
        unreadable: true,
        error: error instanceof Error ? error.message : 'exec failed'
      }
    ];
  }

  const paths = new Set();
  for (const configPath of configPathsFromProcessList(listing)) paths.add(configPath);
  for (const line of listing.split('\n')) {
    const candidate = line.trim();
    if (isSafeConfigPath(candidate) && /oauth|supervisord/i.test(candidate)) paths.add(candidate);
  }
  if (paths.size === 0) return [];

  const files = [];
  for (const configPath of paths) {
    if (!isSafeConfigPath(configPath)) {
      files.push({ path: configPath, unreadable: true, error: 'unsafe path' });
      continue;
    }
    let encoded = '';
    try {
      encoded = await execMachine(machineId, ['sh', '-c', `base64 < ${JSON.stringify(configPath)}`]);
    } catch (error) {
      files.push({
        path: configPath,
        unreadable: true,
        error: error instanceof Error ? error.message : 'exec failed'
      });
      continue;
    }
    const raw = Buffer.from(String(encoded).replace(/\s+/g, ''), 'base64');
    if (raw.length === 0 || raw.includes(0) || raw.length > 256 * 1024) {
      files.push({ path: configPath, unreadable: true, error: 'unreadable contents' });
      continue;
    }
    files.push({ path: configPath, text: raw.toString('utf8') });
  }
  return files;
}

async function writePatchedProxyRoot(work, files) {
  const rootDir = resolve(work, 'proxy-root');
  let changed = 0;
  for (const file of files) {
    if (!file.changed) continue;
    if (!isSafeConfigPath(file.path)) {
      throw new Error(
        `Refusing to deploy: gateway config ${file.path} cannot be written into the overlay. The running machine was not updated.`
      );
    }
    const relative = file.path.replace(/^\/+/, '');
    const destination = resolve(rootDir, relative);
    if (destination !== rootDir && !destination.startsWith(`${rootDir}/`)) {
      throw new Error(
        `Refusing to deploy: patched gateway path ${file.path} escapes the overlay. The running machine was not updated.`
      );
    }
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.text, { mode: 0o644 });
    changed += 1;
    log(`Patched staging session settings in ${file.path}`);
  }
  return changed;
}

async function writeDockerfile(work, includeProxyRoot) {
  let text = await readFile(resolve(root, 'deploy/staging/Dockerfile.overlay'), 'utf8');
  if (!text.includes('COPY app-build/ /app/build/')) {
    throw new Error('Overlay Dockerfile must copy the build onto /app/build');
  }
  if (/vancouver-pdt|oauth2-proxy|fly\.toml/i.test(text)) {
    throw new Error('Overlay Dockerfile must not replace the gateway');
  }
  if (includeProxyRoot) text = `${text.replace(/\s*$/, '')}\nCOPY proxy-root/ /\n`;
  await writeFile(resolve(work, 'Dockerfile'), text);
}

async function buildOverlay(baseImage, work, includeProxyRoot) {
  assertStagingImageRef(baseImage);
  await writeDockerfile(work, includeProxyRoot);
  const tag = `${STAGING_IMAGE_PREFIX}:deploy-${process.env.COMMIT_SHA}`;
  log('Signing in to the Fly registry for bcdaylight-staging');
  await run('docker', ['login', 'registry.fly.io', '-u', 'x', '--password-stdin'], {
    input: `${token()}\n`,
    capture: true
  });
  log('Pulling the current staging image');
  await run('docker', ['pull', '--platform', 'linux/amd64', baseImage]);
  log('Building the /app/build overlay');
  await run('docker', ['build', '--platform', 'linux/amd64', '--build-arg', `BASE_IMAGE=${baseImage}`, '-t', tag, '.'], {
    cwd: work
  });
  log('Pushing the staging image');
  const pushed = await run('docker', ['push', tag], { capture: true });
  const inspected = await run(
    'docker',
    ['image', 'inspect', '--format', '{{range .RepoDigests}}{{println .}}{{end}}', tag],
    { capture: true }
  );
  const fromPush = `${pushed.stdout}\n${pushed.stderr}`.match(/digest:\s*(sha256:[0-9a-f]{64})/i);
  const fromInspect = inspected.stdout.match(/@(sha256:[0-9a-f]{64})/);
  const digest = fromPush?.[1] || fromInspect?.[1];
  if (!digest) throw new Error('docker push did not report an image digest');
  const image = `${STAGING_IMAGE_PREFIX}@${digest}`;
  assertStagingImageRef(image);
  return image;
}

async function buildTexts(dir) {
  const texts = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) texts.push(...(await buildTexts(full)));
    else if (/\.(js|mjs|cjs)$/.test(entry.name)) texts.push(await readFile(full, 'utf8'));
  }
  return texts;
}

async function deploy() {
  assertStagingApp(STAGING_APP);
  assertStagingOrigin(STAGING_ORIGIN);
  const commitSha = process.env.COMMIT_SHA || '';
  if (!/^[0-9a-f]{40}$/.test(commitSha)) {
    throw new Error('COMMIT_SHA must be the full git commit that was tested');
  }
  const head = (await run('git', ['rev-parse', 'HEAD'], { capture: true, cwd: root })).stdout.trim();
  if (head !== commitSha) {
    throw new Error(`Refusing to deploy ${head}; the tested commit is ${commitSha}`);
  }
  assertBuildContainsCommit(await buildTexts(resolve(root, 'build')), commitSha);

  const sessionEnv = assertSessionEnv(
    parseEnvFile(await readFile(resolve(root, 'deploy/staging/oauth2-proxy.session.env'), 'utf8'))
  );

  const listed = await fly(`/apps/${STAGING_APP}/machines`);
  const machines = Array.isArray(listed) ? listed : listed.machines || [];
  const selected = selectStagingMachine(machines);
  const machine = await fly(`/apps/${STAGING_APP}/machines/${selected.id}`);
  const baseImage = machine.config?.image || machine.config?.containers?.find((item) => item.image)?.image;
  assertStagingImageRef(baseImage);
  log(`Staging machine ${machine.id} image ${baseImage}`);

  try {
    await fly(`/apps/${STAGING_APP}/machines/${machine.id}/start`, { method: 'POST', body: {} });
  } catch (error) {
    log(`Machine start skipped (${error instanceof Error ? error.message : 'not started'})`);
  }

  let before;
  try {
    before = (await collectObservations()).probes;
    log('Recorded public responses before the deploy');
  } catch (error) {
    log(`Before-probe skipped (${error instanceof Error ? error.message : 'request failed'})`);
  }

  const gatewayFiles = await readGatewayConfigFiles(machine.id);
  const work = resolve(root, 'deploy/staging/.overlay');
  try {
    await proceedToDeploy(gatewayFiles, async (prepared) => {
      const skipRoutes = mergeSkipRoutes(prepared.files.flatMap((file) => collectSkipRoutes(file.original)));
      if (!skipRoutes.split(',').includes(VERSION_SKIP_ROUTE)) {
        throw new Error(
          'Refusing to deploy without a /version auth exception. The running machine was not updated.'
        );
      }
      log(`oauth2-proxy skip routes for this deploy: ${skipRoutes}`);

      await rm(work, { recursive: true, force: true });
      await mkdir(resolve(work, 'app-build'), { recursive: true });
      await run('cp', ['-a', `${resolve(root, 'build')}/.`, resolve(work, 'app-build')]);
      const pending = prepared.files.filter((file) => file.changed).length;
      const changed = await writePatchedProxyRoot(work, prepared.files);
      if (changed !== pending) {
        throw new Error(
          'Refusing to deploy: the patched gateway config was not written. The running machine was not updated.'
        );
      }
      const image = await buildOverlay(baseImage, work, changed > 0);
      const planned = planStagingUpdate(machine.config, {
        image,
        sessionEnv,
        skipRoutes,
        commitSha
      });
      planned.rollback.machineId = machine.id;
      planned.rollback.applied = false;
      assertRollbackIsSafe(planned.rollback);
      await writeRollback(planned.rollback);

      log(`Updating ${STAGING_APP} machine ${machine.id}`);
      await updateMachine({ id: machine.id, region: machine.region }, planned.config);
      planned.rollback.applied = true;
      await writeRollback(planned.rollback);

      try {
        await checkStaging({ expectedSha: commitSha, before });
        log('Staging deploy ok');
        log(`app: ${STAGING_APP}`);
        log(`machine: ${machine.id}`);
        log(`image: ${image}`);
        log(`commit: ${commitSha}`);
        log(`version: ${STAGING_ORIGIN}/version`);
        log(
          `session: ${sessionEnv.OAUTH2_PROXY_COOKIE_EXPIRE}, refresh ${sessionEnv.OAUTH2_PROXY_COOKIE_REFRESH}, approval ${sessionEnv.OAUTH2_PROXY_APPROVAL_PROMPT}`
        );
      } catch (error) {
        log(error instanceof Error ? error.message : 'Staging checks failed');
        await rollbackFromFile();
        throw error;
      }
    });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

const rollbackOnly = process.argv.includes('--rollback');
const action = rollbackOnly ? rollbackFromFile() : deploy();
action.catch((error) => {
  fail(error instanceof Error ? error.message : 'Staging deploy failed');
  process.exit(1);
});
