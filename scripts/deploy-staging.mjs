#!/usr/bin/env node
/**
 * Deploy the current build to Fly app bcdaylight-staging only.
 * Overlays /app/build onto the running image so the oauth2-proxy gateway stays.
 * Never calls `fly deploy` and never targets vancouver-pdt.
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	ALLOWED_MACHINE_ENV_KEYS,
	BUILD_ENV_KEYS,
	SESSION_ENV_KEYS,
	SKIP_AUTH_ENV,
	STAGING_APP,
	STAGING_IMAGE_PREFIX,
	STAGING_ORIGIN,
	VERSION_SKIP_ROUTE,
	applyRollback,
	assertSessionEnv,
	assertStagingApp,
	assertStagingImageRef,
	assertStagingOrigin,
	collectSkipRoutes,
	configPathsFromProcessList,
	evaluateStagingProbes,
	isSafeConfigPath,
	mergeSkipRoutes,
	parseEnvFile,
	patchProxyText,
	planStagingUpdate,
	probePaths,
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
			'Missing GitHub Actions secret FLY_API_TOKEN_STAGING. Add a Fly API token scoped to the bcdaylight-staging app. This workflow does not deploy production (vancouver-pdt).'
		);
	}
	return value;
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
			env: { ...process.env, FLY_API_TOKEN: token() }
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
		if (input !== undefined) {
			child.stdin.end(input);
		}
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

async function probe() {
	assertStagingOrigin(STAGING_ORIGIN);
	const out = {};
	for (const path of probePaths()) {
		const response = await fetch(`${STAGING_ORIGIN}${path}`, { redirect: 'manual' });
		out[path] = {
			status: response.status,
			location: response.headers.get('location') || '',
			contentType: response.headers.get('content-type') || '',
			body: await response.text()
		};
	}
	return out;
}

async function waitForVersion(expectedSha) {
	const deadline = Date.now() + 3 * 60 * 1000;
	let last = 'no response';
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`${STAGING_ORIGIN}/version`, { redirect: 'manual' });
			const body = await response.text();
			last = `${response.status} ${body.slice(0, 120)}`;
			if (response.status === 200 && body.includes(expectedSha)) return;
		} catch (error) {
			last = error instanceof Error ? error.message : 'request failed';
		}
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 5000));
	}
	throw new Error(`Timed out waiting for /version to serve ${expectedSha}. Last response: ${redactSecrets(last)}`);
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
	log('Rollback requested. Staging is returning to the previous image and session env.');
}

async function discoverProxyFiles(machineId) {
	const paths = new Set();
	try {
		const listing = await execMachine(machineId, [
			'sh',
			'-c',
			'ps -eo args=; echo; find /etc /opt /app /usr/local/etc /srv -type f \\( -iname "*oauth2*" -o -name supervisord.conf -o -name oauth2-proxy.cfg \\) -size -256k 2>/dev/null'
		]);
		for (const path of configPathsFromProcessList(listing)) paths.add(path);
		for (const line of listing.split('\n')) {
			const candidate = line.trim();
			if (isSafeConfigPath(candidate) && /oauth|supervisord/i.test(candidate)) paths.add(candidate);
		}
	} catch (error) {
		log(`Could not list oauth2-proxy files (${error instanceof Error ? error.message : 'exec failed'}). Session env will still be applied.`);
	}
	return [...paths];
}

async function patchedProxyRoot(machineId, work, paths) {
	const rootDir = resolve(work, 'proxy-root');
	const originals = [];
	let changed = 0;
	for (const configPath of paths) {
		if (!isSafeConfigPath(configPath)) continue;
		let encoded = '';
		try {
			encoded = await execMachine(machineId, ['sh', '-c', `base64 < ${JSON.stringify(configPath)}`]);
		} catch (error) {
			log(`Skipping unreadable config ${configPath}`);
			continue;
		}
		const raw = Buffer.from(encoded.replace(/\s+/g, ''), 'base64');
		if (raw.includes(0) || raw.length > 256 * 1024) continue;
		const text = raw.toString('utf8');
		originals.push(text);
		const patched = patchProxyText(text);
		if (!patched.changed) continue;
		const relative = configPath.replace(/^\/+/, '');
		const destination = resolve(rootDir, relative);
		if (!destination.startsWith(rootDir)) continue;
		await mkdir(dirname(destination), { recursive: true });
		await writeFile(destination, patched.text, { mode: 0o600 });
		changed += 1;
		log(`Patched staging proxy config ${configPath}`);
	}
	return { changed, originals };
}

async function buildOverlay(baseImage, work, includeProxyRoot) {
	assertStagingImageRef(baseImage);
	const dockerfile = [
		'ARG BASE_IMAGE',
		'FROM ${BASE_IMAGE}',
		'COPY app-build/ /app/build/'
	];
	if (includeProxyRoot) dockerfile.push('COPY proxy-root/ /');
	await writeFile(resolve(work, 'Dockerfile'), `${dockerfile.join('\n')}\n`);
	const tag = `${STAGING_IMAGE_PREFIX}:deploy-${process.env.COMMIT_SHA}`;
	log('Signing in to the Fly registry');
	await run('docker', ['login', 'registry.fly.io', '-u', 'x', '--password-stdin'], {
		input: token(),
		capture: true
	});
	log('Pulling current staging image');
	await run('docker', ['pull', '--platform', 'linux/amd64', baseImage]);
	log('Building /app/build overlay');
	await run(
		'docker',
		['build', '--platform', 'linux/amd64', '--build-arg', `BASE_IMAGE=${baseImage}`, '-t', tag, '.'],
		{ cwd: work }
	);
	log('Pushing staging image');
	const pushed = await run('docker', ['push', tag], { capture: true });
	const digest = `${pushed.stdout}\n${pushed.stderr}`.match(/digest:\s*(sha256:[0-9a-f]{64})/i)?.[1];
	if (!digest) throw new Error('docker push did not report an image digest');
	const image = `${STAGING_IMAGE_PREFIX}@${digest}`;
	assertStagingImageRef(image);
	return image;
}

async function deploy() {
	assertStagingApp(STAGING_APP);
	assertStagingOrigin(STAGING_ORIGIN);
	const commitSha = process.env.COMMIT_SHA || '';
	const buildTime = process.env.BUILD_TIME || '';
	if (!/^[0-9a-f]{40}$/.test(commitSha)) {
		throw new Error('COMMIT_SHA must be the full git commit being deployed');
	}
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(buildTime)) {
		throw new Error('BUILD_TIME must be a UTC timestamp like 2026-10-31T00:00:00Z');
	}
	await readFile(resolve(root, 'build/index.js'));

	const sessionEnv = assertSessionEnv(
		parseEnvFile(await readFile(resolve(root, 'deploy/staging/oauth2-proxy.session.env'), 'utf8'))
	);
	for (const key of SESSION_ENV_KEYS) {
		if (!sessionEnv[key]) throw new Error(`Missing ${key}`);
	}

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

	log('Recording public responses before the deploy');
	const before = await probe();
	const paths = await discoverProxyFiles(machine.id);
	const work = resolve(root, 'deploy/staging/.overlay');
	await rm(work, { recursive: true, force: true });
	await mkdir(resolve(work, 'app-build'), { recursive: true });
	await run('cp', ['-a', resolve(root, 'build') + '/.', resolve(work, 'app-build')]);
	const patched = await patchedProxyRoot(machine.id, work, paths);
	const discoveredRoutes = patched.originals.flatMap((text) => collectSkipRoutes(text));
	const skipRoutes = mergeSkipRoutes(discoveredRoutes);
	if (!skipRoutes.split(',').includes(VERSION_SKIP_ROUTE)) {
		throw new Error('Refusing to deploy without a /version auth exception');
	}
	log(`oauth2-proxy skip routes for this deploy: ${skipRoutes}`);

	const image = await buildOverlay(baseImage, work, patched.changed > 0);
	const planned = planStagingUpdate(machine.config, {
		image,
		sessionEnv,
		skipRoutes,
		commitSha,
		buildTime
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
		log('Waiting for /version');
		await waitForVersion(commitSha);
		const after = await probe();
		const errors = evaluateStagingProbes({ before, after, expectedSha: commitSha, expectedBuiltAt: buildTime });
		if (errors.length) {
			throw new Error(`Staging checks failed:\n- ${errors.join('\n- ')}`);
		}
		const home = after['/'].location;
		if (!home.includes('approval_prompt=auto') && home.includes('approval_prompt=')) {
			throw new Error('GitHub authorize URL is still forcing an approval prompt');
		}
		log(`Staging deploy ok`);
		log(`app: ${STAGING_APP}`);
		log(`machine: ${machine.id}`);
		log(`image: ${image}`);
		log(`commit: ${commitSha}`);
		log(`version: ${STAGING_ORIGIN}/version`);
		log(`session: ${sessionEnv.OAUTH2_PROXY_COOKIE_EXPIRE}, refresh ${sessionEnv.OAUTH2_PROXY_COOKIE_REFRESH}, approval ${sessionEnv.OAUTH2_PROXY_APPROVAL_PROMPT}`);
		log(`build env keys set: ${BUILD_ENV_KEYS.join(', ')}`);
		log(`skip env: ${SKIP_AUTH_ENV}`);
	} catch (error) {
		log(error instanceof Error ? error.message : 'Staging checks failed');
		await rollbackFromFile();
		throw error;
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
