/**
 * Pure helpers for the bcdaylight-staging deploy.
 * Production (vancouver-pdt / bcdaylight.ca) is refused here.
 * Nothing in this module reads or prints credentials.
 */

export const STAGING_APP = 'bcdaylight-staging';
export const STAGING_ORIGIN = 'https://bc-daylight.staging.adamstuckert.com';
export const STAGING_IMAGE_PREFIX = 'registry.fly.io/bcdaylight-staging';
export const PRODUCTION_APPS = ['vancouver-pdt', 'bcdaylight'];

export const SESSION_ENV_KEYS = [
	'OAUTH2_PROXY_COOKIE_EXPIRE',
	'OAUTH2_PROXY_COOKIE_REFRESH',
	'OAUTH2_PROXY_APPROVAL_PROMPT'
];

export const BUILD_ENV_KEYS = ['COMMIT_SHA', 'BUILD_TIME'];
export const SKIP_AUTH_ENV = 'OAUTH2_PROXY_SKIP_AUTH_ROUTES';
export const VERSION_SKIP_ROUTE = '^/version$';

export const ALLOWED_MACHINE_ENV_KEYS = [...SESSION_ENV_KEYS, SKIP_AUTH_ENV, ...BUILD_ENV_KEYS];

const PUBLIC_PROBE_PATHS = ['/', '/ping', '/ready', '/robots.txt', '/version', '/og.png', '/favicon.png'];

export function probePaths() {
	return [...PUBLIC_PROBE_PATHS];
}

export function assertStagingApp(app) {
	if (PRODUCTION_APPS.includes(app) || app !== STAGING_APP) {
		throw new Error(
			`Refusing to deploy app "${app}". This workflow only deploys ${STAGING_APP} and never production.`
		);
	}
}

export function assertStagingOrigin(url) {
	const origin = new URL(url).origin;
	if (origin !== STAGING_ORIGIN) {
		throw new Error(`Refusing to call ${origin}. Checks only run against ${STAGING_ORIGIN}.`);
	}
}

export function assertStagingImageRef(image) {
	const stagingRef =
		typeof image === 'string' &&
		(image.startsWith(`${STAGING_IMAGE_PREFIX}@`) || image.startsWith(`${STAGING_IMAGE_PREFIX}:`));
	if (!stagingRef) {
		throw new Error(`Refusing image "${image}". Staging images must stay on ${STAGING_IMAGE_PREFIX}.`);
	}
	if (image.includes('vancouver-pdt')) {
		throw new Error('Refusing an image reference that mentions the production app.');
	}
	return image;
}

export function parseEnvFile(text) {
	const out = {};
	for (const line of String(text).split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
		if (!match) throw new Error(`Invalid session env line: ${trimmed}`);
		out[match[1]] = match[2];
	}
	return out;
}

export function assertSessionEnv(env) {
	const keys = Object.keys(env);
	for (const key of keys) {
		if (!SESSION_ENV_KEYS.includes(key)) {
			throw new Error(`Unexpected key in staging session file: ${key}`);
		}
	}
	if (env.OAUTH2_PROXY_COOKIE_EXPIRE !== '8h') {
		throw new Error('Staging session file must set OAUTH2_PROXY_COOKIE_EXPIRE=8h');
	}
	if (env.OAUTH2_PROXY_COOKIE_REFRESH !== '0s') {
		throw new Error('Staging session file must set OAUTH2_PROXY_COOKIE_REFRESH=0s');
	}
	if (env.OAUTH2_PROXY_APPROVAL_PROMPT !== 'auto') {
		throw new Error(
			'Staging session file must set OAUTH2_PROXY_APPROVAL_PROMPT=auto (an empty value still forces consent)'
		);
	}
	return env;
}

export function redactSecrets(text) {
	let out = String(text);
	out = out.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
	out = out.replace(
		/(authorization|client[_-]?secret|cookie[_-]?secret|access[_-]?token|refresh[_-]?token|password|api[_-]?token|fly_api_token(?:_staging)?)(\s*[:=]\s*|\s+)([^\s"',}]+)/gi,
		'$1$2[REDACTED]'
	);
	out = out.replace(/--(client-secret|cookie-secret|github-token)(=|\s+)\S+/gi, '--$1$2[REDACTED]');
	out = out.replace(/\bFlyV1\s+\S+/g, 'FlyV1 [REDACTED]');
	out = out.replace(/\b(fo1_|fm2_|ghp_|github_pat_)[A-Za-z0-9_\-]+/g, '[REDACTED]');
	return out;
}

export function collectSkipRoutes(text) {
	const found = [];
	const add = (value) => {
		const cleaned = String(value)
			.trim()
			.replace(/^['"]|['"]$/g, '')
			.replace(/,$/, '');
		if (!cleaned || cleaned === '[' || cleaned === ']') return;
		if (!found.includes(cleaned)) found.push(cleaned);
	};
	const listRe = /skip_auth_routes?\s*[:=]\s*\[([^\]]*)\]/gi;
	let match;
	while ((match = listRe.exec(text))) {
		for (const part of match[1].split(',')) add(part);
	}
	const scalarRe = /(?:^|\n)\s*skip_auth_routes?\s*[:=]\s*([^\n#]+)/gi;
	while ((match = scalarRe.exec(text))) {
		const raw = match[1].trim();
		if (raw.startsWith('[')) continue;
		for (const part of raw.split(',')) add(part);
	}
	const flagRe = /--skip-auth-route(?:=|\s+)(\S+)/gi;
	while ((match = flagRe.exec(text))) add(match[1]);
	return found;
}

export function mergeSkipRoutes(routes) {
	const merged = [];
	for (const route of routes) {
		const cleaned = String(route || '').trim();
		if (!cleaned || merged.includes(cleaned)) continue;
		merged.push(cleaned);
	}
	if (!merged.includes(VERSION_SKIP_ROUTE)) merged.push(VERSION_SKIP_ROUTE);
	return merged.join(',');
}

function replaceAssigned(text, key, value) {
	const re = new RegExp(
		`(^|\\n)([ \\t]*${key}[ \\t]*[:=][ \\t]*)(?:"[^"]*"|'[^']*'|[^\\s#]+)`,
		'g'
	);
	return text.replace(re, `$1$2"${value}"`);
}

function replaceFlag(text, flag, value) {
	return text
		.replace(new RegExp(`--${flag}=\\S+`, 'g'), `--${flag}=${value}`)
		.replace(new RegExp(`--${flag}\\s+\\S+`, 'g'), `--${flag}=${value}`);
}

function insertVersionSkip(text) {
	if (text.includes(VERSION_SKIP_ROUTE)) return text;
	if (/skip_auth_routes?\s*[:=]\s*\[/.test(text)) {
		return text.replace(/skip_auth_routes(\s*[:=]\s*\[)/, `skip_auth_routes$1\n  "${VERSION_SKIP_ROUTE}",`);
	}
	if (/^\s*skip_auth_routes?\s*[:=]\s*[^\[]/m.test(text)) {
		return `${text.replace(/\s*$/, '')}\nskip_auth_route = "${VERSION_SKIP_ROUTE}"\n`;
	}
	const looksLikeConfig =
		/(?:^|\n)\s*(provider|cookie_expire|approval_prompt|client_id|upstreams)\s*[:=]/i.test(text);
	if (looksLikeConfig) {
		return `${text.replace(/\s*$/, '')}\nskip_auth_routes = [\n  "${VERSION_SKIP_ROUTE}"\n]\n`;
	}
	return text;
}

function ensureCommandFlags(line) {
	if (!line.includes('oauth2-proxy')) return line;
	const trimmed = line.trimStart();
	if (trimmed.startsWith('#') || trimmed.startsWith(';')) return line;
	let next = line;
	next = replaceFlag(next, 'approval-prompt', 'auto');
	next = replaceFlag(next, 'cookie-expire', '8h');
	next = replaceFlag(next, 'cookie-refresh', '0s');
	if (!/--approval-prompt(?:=|\s)/.test(next)) next += ' --approval-prompt=auto';
	if (!/--cookie-expire(?:=|\s)/.test(next)) next += ' --cookie-expire=8h';
	if (!/--cookie-refresh(?:=|\s)/.test(next)) next += ' --cookie-refresh=0s';
	if (!next.includes(VERSION_SKIP_ROUTE) && /--skip-auth-route(?:=|\s)/.test(next)) {
		next += ` --skip-auth-route=${VERSION_SKIP_ROUTE}`;
	}
	return next;
}

/**
 * Update oauth2-proxy session settings in a config file or command line.
 * Other lines, including secrets and the GitHub user allow-list, stay as they are.
 */
export function patchProxyText(text) {
	const normalized = String(text).replace(/\r\n/g, '\n');
	let next = normalized;
	next = replaceAssigned(next, 'cookie_expire', '8h');
	next = replaceAssigned(next, 'cookie_refresh', '0s');
	next = replaceAssigned(next, 'approval_prompt', 'auto');
	next = next
		.split('\n')
		.map((line) => ensureCommandFlags(line))
		.join('\n');
	next = insertVersionSkip(next);
	return { text: next, changed: next !== normalized };
}

function isStagingImage(image) {
	return typeof image === 'string' && image.includes(STAGING_APP) && !image.includes('vancouver-pdt');
}

function envMap(env) {
	if (!env || typeof env !== 'object' || Array.isArray(env)) return {};
	return env;
}

export function mergeAllowedEnv(env, updates) {
	const next = { ...envMap(env) };
	for (const [key, value] of Object.entries(updates)) {
		if (!ALLOWED_MACHINE_ENV_KEYS.includes(key)) {
			throw new Error(`Refusing to set unexpected machine env key ${key}`);
		}
		next[key] = value;
	}
	return next;
}

function snapshotEnv(env) {
	const source = envMap(env);
	const snap = {};
	for (const key of ALLOWED_MACHINE_ENV_KEYS) {
		snap[key] = Object.prototype.hasOwnProperty.call(source, key) ? source[key] : null;
	}
	return snap;
}

export function captureRollback(config, machineId) {
	const containers = Array.isArray(config.containers) ? config.containers : [];
	return {
		machineId,
		image: typeof config.image === 'string' ? config.image : null,
		env: snapshotEnv(config.env),
		containers: containers.map((container) => ({
			name: container.name || null,
			image: typeof container.image === 'string' ? container.image : null,
			env: snapshotEnv(container.env)
		}))
	};
}

function restoreEnv(target, snap) {
	const base = { ...envMap(target) };
	for (const [key, value] of Object.entries(snap)) {
		if (!ALLOWED_MACHINE_ENV_KEYS.includes(key)) continue;
		if (value === null) delete base[key];
		else base[key] = value;
	}
	return base;
}

function patchCommandValue(value) {
	if (typeof value !== 'string' || !value.includes('oauth2-proxy')) return value;
	return patchProxyText(value).text;
}

function patchCommandTree(value) {
	if (typeof value === 'string') return patchCommandValue(value);
	if (Array.isArray(value)) return value.map((entry) => patchCommandTree(entry));
	if (value && typeof value === 'object') {
		const out = {};
		for (const [key, entry] of Object.entries(value)) {
			if (key === 'env') {
				out[key] = entry;
				continue;
			}
			out[key] = patchCommandTree(entry);
		}
		return out;
	}
	return value;
}

export function planStagingUpdate(config, { image, sessionEnv, skipRoutes, commitSha, buildTime }) {
	assertStagingImageRef(image);
	assertSessionEnv(sessionEnv);
	if (!/^[0-9a-f]{40}$/.test(commitSha)) throw new Error('commitSha must be a full git sha');
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(buildTime)) {
		throw new Error('buildTime must be a UTC timestamp');
	}

	const rollback = captureRollback(config, null);
	const next = structuredClone(config);
	let imagesUpdated = 0;

	if (typeof next.image === 'string') {
		if (!isStagingImage(next.image)) {
			throw new Error(`Refusing to replace image ${next.image}`);
		}
		next.image = image;
		imagesUpdated += 1;
	}

	if (Array.isArray(next.containers)) {
		for (const container of next.containers) {
			if (isStagingImage(container.image)) {
				container.image = image;
				imagesUpdated += 1;
			}
		}
	}

	if (imagesUpdated === 0) {
		throw new Error(`Machine config has no ${STAGING_APP} image to replace`);
	}

	const updates = {
		...sessionEnv,
		[SKIP_AUTH_ENV]: mergeSkipRoutes(String(skipRoutes || '').split(',')),
		COMMIT_SHA: commitSha,
		BUILD_TIME: buildTime
	};

	const touchEnv = (env) => mergeAllowedEnv(env, updates);
	if (next.env && typeof next.env === 'object' && !Array.isArray(next.env)) {
		next.env = touchEnv(next.env);
	}
	let containerEnv = false;
	if (Array.isArray(next.containers)) {
		for (const container of next.containers) {
			if (isStagingImage(container.image) || container.image === image) {
				container.env = touchEnv(container.env);
				containerEnv = true;
			}
		}
	}
	if (!next.env && !containerEnv) next.env = touchEnv({});

	if (next.init) next.init = patchCommandTree(next.init);
	if (Array.isArray(next.processes)) next.processes = patchCommandTree(next.processes);
	if (Array.isArray(next.containers)) {
		for (const container of next.containers) {
			for (const key of ['command', 'cmd', 'entrypoint', 'exec']) {
				if (container[key]) container[key] = patchCommandTree(container[key]);
			}
		}
	}

	return { config: next, rollback };
}

export function applyRollback(config, rollback) {
	if (rollback.image) assertStagingImageRef(rollback.image);
	const next = structuredClone(config);
	if (rollback.image && typeof next.image === 'string') {
		if (!isStagingImage(next.image) && next.image !== rollback.image) {
			throw new Error(`Refusing to roll back from image ${next.image}`);
		}
		next.image = rollback.image;
	}
	if (next.env) next.env = restoreEnv(next.env, rollback.env || {});
	if (Array.isArray(next.containers) && Array.isArray(rollback.containers)) {
		for (const saved of rollback.containers) {
			const container = next.containers.find((item) => (item.name || null) === saved.name);
			if (!container) continue;
			if (saved.image) {
				if (String(saved.image).includes('vancouver-pdt')) {
					throw new Error('Refusing to restore a production image');
				}
				container.image = saved.image;
			}
			container.env = restoreEnv(container.env, saved.env || {});
		}
	}
	return next;
}

export function selectStagingMachine(machines) {
	const live = (machines || []).filter(
		(machine) => !['destroyed', 'destroying', 'replaced'].includes(machine.state)
	);
	if (live.length !== 1) {
		const ids = live.map((machine) => machine.id).join(', ') || 'none';
		throw new Error(`Expected exactly one machine on ${STAGING_APP}, found ${live.length}: ${ids}`);
	}
	return live[0];
}

function versionBody(probe) {
	if (!probe || probe.status !== 200) return null;
	try {
		return JSON.parse(probe.body);
	} catch {
		return null;
	}
}

export function evaluateStagingProbes({ before, after, expectedSha, expectedBuiltAt }) {
	const errors = [];
	const version = versionBody(after['/version']);
	if (!after['/version'] || after['/version'].status !== 200) {
		errors.push(`/version returned ${after['/version']?.status ?? 'no response'}; oauth2-proxy is still gating it`);
	} else if (!version || typeof version !== 'object' || Array.isArray(version)) {
		errors.push('/version did not return a JSON object');
	} else {
		const keys = Object.keys(version).sort();
		if (keys.join(',') !== 'builtAt,sha') {
			errors.push(`/version returned unexpected keys: ${keys.join(', ') || '(none)'}`);
		}
		if (version.sha !== expectedSha) errors.push(`/version sha was ${version.sha}, expected ${expectedSha}`);
		if (version.builtAt !== expectedBuiltAt) {
			errors.push(`/version builtAt was ${version.builtAt}, expected ${expectedBuiltAt}`);
		}
		const contentType = after['/version'].contentType || '';
		if (!contentType.includes('application/json')) {
			errors.push(`/version content-type was ${contentType || 'missing'}`);
		}
		if (String(after['/version'].body).includes('<')) {
			errors.push('/version included markup');
		}
	}

	const home = after['/'] || {};
	const location = home.location || '';
	if (home.status !== 302 && home.status !== 303 && home.status !== 307) {
		errors.push(`staging home returned ${home.status ?? 'no response'}; the GitHub gate should stay in place`);
	}
	if (!location.includes('github.com/login/oauth/authorize')) {
		errors.push('staging home did not redirect to GitHub OAuth');
	}
	if (location.includes('approval_prompt=force') || location.includes('approval_prompt%3Dforce')) {
		errors.push('GitHub authorize URL still sends approval_prompt=force');
	}

	for (const path of Object.keys(before)) {
		if (path === '/version') continue;
		const previous = before[path]?.status;
		const current = after[path]?.status;
		if (previous === undefined) continue;
		if (previous !== current) {
			errors.push(`${path} changed from HTTP ${previous} to HTTP ${current ?? 'no response'}`);
		}
		if (previous === 302 && current === 200) {
			errors.push(`${path} became public`);
		}
	}

	if ((before['/robots.txt']?.status === 200) && before['/robots.txt'].body !== after['/robots.txt']?.body) {
		errors.push('robots.txt changed; the staging gateway response must stay in place');
	}

	return errors;
}

export function configPathsFromProcessList(text) {
	const paths = [];
	const re = /--config(?:=|\s+)(\S+)/g;
	let match;
	while ((match = re.exec(text))) {
		const configPath = match[1].replace(/^["']|["']$/g, '');
		if (configPath.startsWith('/') && !paths.includes(configPath)) paths.push(configPath);
	}
	return paths;
}

export function isSafeConfigPath(filePath) {
	return (
		typeof filePath === 'string' &&
		filePath.startsWith('/') &&
		!filePath.includes('\0') &&
		!filePath.includes('..') &&
		/^\/[\w./@+-]+$/.test(filePath)
	);
}
