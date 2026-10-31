/**
 * Pure helpers for the bcdaylight-staging deploy.
 * Production (vancouver-pdt / bcdaylight.ca) is refused here.
 * Nothing in this module reads or prints credentials.
 *
 * Header and host values below were read from the running gateway on
 * 2026-10-31. They are checked after deploy; they are not a new gateway config.
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

export const SKIP_AUTH_ENV = 'OAUTH2_PROXY_SKIP_AUTH_ROUTES';
export const VERSION_SKIP_ROUTE = '^/version$';
export const COMMIT_ENV = 'COMMIT_SHA';

export const ALLOWED_MACHINE_ENV_KEYS = [...SESSION_ENV_KEYS, SKIP_AUTH_ENV, COMMIT_ENV];

/** Response headers on the live gateway (GET /, /ping, /ready, /robots.txt). */
export const REQUIRED_GATEWAY_HEADERS = {
  'strict-transport-security': 'max-age=86400',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  'cache-control': 'no-store'
};

/** oauth2-proxy sets this Expires value on the GitHub redirect. */
export const REDIRECT_EXPIRES = 'Thu, 01 Jan 1970 00:00:00 UTC';

/** Authorize URL observed on an unauthenticated request to staging. */
export const STAGING_OAUTH = {
  authorize: 'https://github.com/login/oauth/authorize',
  clientId: 'Ov23liBwlGSka4oQIqj0',
  redirectUri: 'https://bc-daylight.staging.adamstuckert.com/oauth2/callback',
  scope: 'user:email read:org'
};

export const CSRF_COOKIE_PREFIX = '__Host-bcdaylight_staging_csrf=';
export const ROBOTS_BODY = 'User-agent: *\nDisallow: /\n';

/**
 * Hosts the live edge rejects with 421. not-allowed.example is sent as the
 * Host header on the staging TLS connection. The fly.dev name is the app's
 * shared hostname, which the certificate does not allow.
 */
export const DISALLOWED_HOSTS = ['not-allowed.example', 'bcdaylight-staging.fly.dev'];

const GATEWAY_POLICY_MARKERS = [
  'max-age=86400',
  'noindex, nofollow, noarchive',
  'no-store',
  'Strict-Transport-Security',
  'X-Robots-Tag',
  'Cache-Control',
  'server_name',
  'whitelist',
  'github_user',
  'github-user',
  'aldervale'
];

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

export function assertBuildContainsCommit(contents, sha) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('commit must be a 40 character sha');
  const hit = contents.some((text) => String(text).includes(`"${sha}"`) || String(text).includes(`'${sha}'`));
  if (!hit) throw new Error('built files do not contain the tested commit sha');
  return true;
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
  const re = new RegExp(`(^|\\n)([ \\t]*${key}[ \\t]*[:=][ \\t]*)(?:"[^"]*"|'[^']*'|[^\\s#]+)`, 'g');
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
  const looksLikeConfig = /(?:^|\n)\s*(provider|cookie_expire|approval_prompt|client_id|upstreams)\s*[:=]/i.test(
    text
  );
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

export function assertPatchPreservesGatewayPolicy(before, after) {
  for (const marker of GATEWAY_POLICY_MARKERS) {
    if (before.includes(marker) && !after.includes(marker)) {
      throw new Error(`Patch would remove gateway setting ${marker}`);
    }
  }
}

/**
 * Update oauth2-proxy session settings in a config file or command line.
 * Other lines, including secrets, headers, host rules, and the GitHub user
 * allow-list, stay as they are.
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
  assertPatchPreservesGatewayPolicy(normalized, next);
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
  for (const [key, value] of Object.entries(snap || {})) {
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

export function planStagingUpdate(config, { image, sessionEnv, skipRoutes, commitSha }) {
  assertStagingImageRef(image);
  assertSessionEnv(sessionEnv);
  if (!/^[0-9a-f]{40}$/.test(commitSha)) throw new Error('commitSha must be the tested 40 character commit');

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
    [COMMIT_ENV]: commitSha
  };
  if (skipRoutes !== null && skipRoutes !== undefined) {
    updates[SKIP_AUTH_ENV] = mergeSkipRoutes(String(skipRoutes).split(','));
  }

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
  const live = (machines || []).filter((machine) => !['destroyed', 'destroying', 'replaced'].includes(machine.state));
  if (live.length !== 1) {
    const ids = live.map((machine) => machine.id).join(', ') || 'none';
    throw new Error(`Expected exactly one machine on ${STAGING_APP}, found ${live.length}: ${ids}`);
  }
  return live[0];
}

function normalizedHeaders(headers) {
  const out = {};
  if (!headers) return out;
  for (const [key, value] of Object.entries(headers)) {
    out[String(key).toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return out;
}

function cacheIsNoStore(value) {
  if (!value) return false;
  const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((part) => part === 'no-store');
}

export function gatewayHeaderErrors(path, headers, { requireExpires = false, allowRepeatedNoStore = false } = {}) {
  const errors = [];
  const normalized = normalizedHeaders(headers);
  for (const [key, expected] of Object.entries(REQUIRED_GATEWAY_HEADERS)) {
    if (key === 'cache-control' && allowRepeatedNoStore && cacheIsNoStore(normalized[key])) continue;
    if (normalized[key] !== expected) {
      const actual = normalized[key] === undefined ? 'missing' : JSON.stringify(normalized[key]);
      errors.push(`${path} ${key} is ${actual}, expected ${JSON.stringify(expected)}`);
    }
  }
  if (requireExpires && normalized.expires !== REDIRECT_EXPIRES) {
    const actual = normalized.expires === undefined ? 'missing' : JSON.stringify(normalized.expires);
    errors.push(`${path} expires is ${actual}, expected ${JSON.stringify(REDIRECT_EXPIRES)}`);
  }
  return errors;
}

export function githubGateErrors(location, setCookie) {
  const errors = [];
  let url;
  try {
    url = new URL(location || '');
  } catch {
    return ['GET / did not redirect to GitHub sign-in'];
  }
  if (`${url.origin}${url.pathname}` !== STAGING_OAUTH.authorize) {
    errors.push(`GET / redirected to ${url.origin}${url.pathname}`);
  }
  const prompt = url.searchParams.get('approval_prompt');
  if (prompt !== 'auto') {
    errors.push(`approval_prompt is ${prompt === null ? 'missing' : prompt}, expected auto`);
  }
  if (url.searchParams.get('client_id') !== STAGING_OAUTH.clientId) {
    errors.push('GitHub authorize URL is not the existing staging OAuth client');
  }
  if (url.searchParams.get('redirect_uri') !== STAGING_OAUTH.redirectUri) {
    errors.push('GitHub redirect_uri is not the existing staging callback');
  }
  if (url.searchParams.get('scope') !== STAGING_OAUTH.scope) {
    errors.push(`GitHub scope is ${url.searchParams.get('scope') || 'missing'}, expected ${STAGING_OAUTH.scope}`);
  }
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie || ''];
  if (!cookies.some((value) => String(value).startsWith(CSRF_COOKIE_PREFIX))) {
    errors.push('GET / did not set __Host-bcdaylight_staging_csrf');
  }
  return errors;
}

export function disallowedHostErrors(results) {
  const errors = [];
  for (const host of DISALLOWED_HOSTS) {
    const status = results?.[host];
    if (status !== 421) {
      errors.push(`Host ${host} returned HTTP ${status ?? 'no response'}, expected 421`);
    }
  }
  return errors;
}

function versionErrors(probe, expectedSha) {
  const errors = [];
  if (!probe || probe.status !== 200) {
    errors.push(`/version returned ${probe?.status ?? 'no response'}; it must be public`);
    return errors;
  }
  const contentType = probe.contentType || normalizedHeaders(probe.headers)['content-type'] || '';
  if (!String(contentType).includes('application/json')) {
    errors.push(`/version content-type is ${contentType || 'missing'}`);
  }
  let data;
  try {
    data = JSON.parse(probe.body || '');
  } catch {
    errors.push('/version did not return JSON');
    return errors;
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    errors.push('/version did not return a JSON object');
    return errors;
  }
  const keys = Object.keys(data).sort();
  if (keys.length !== 1 || keys[0] !== 'commit') {
    errors.push(`/version returned unexpected keys: ${keys.join(', ') || '(none)'}`);
  }
  if (data.commit !== expectedSha) {
    errors.push(`/version commit was ${JSON.stringify(data.commit)}, expected ${expectedSha}`);
  }
  if (JSON.stringify(data).includes('<')) errors.push('/version included markup');
  errors.push(...gatewayHeaderErrors('/version', probe.headers, { allowRepeatedNoStore: true }));
  return errors;
}

export function evaluateStagingProbes({ before, after, expectedSha, disallowedHosts }) {
  const errors = [];
  if (!/^[0-9a-f]{40}$/.test(expectedSha || '')) {
    errors.push('expected commit must be a 40 character sha');
  }

  const home = after['/'] || {};
  if (home.status !== 302) {
    errors.push(`GET / returned HTTP ${home.status ?? 'no response'}, expected 302 to GitHub`);
  }
  errors.push(...githubGateErrors(home.location, home.setCookie ?? home.headers?.['set-cookie']));
  errors.push(...gatewayHeaderErrors('/', home.headers, { requireExpires: true }));
  errors.push(...versionErrors(after['/version'], expectedSha));

  for (const path of ['/ping', '/ready']) {
    const probe = after[path] || {};
    if (probe.status !== 200 || probe.body !== 'OK') {
      errors.push(`${path} returned HTTP ${probe.status ?? 'no response'}, expected 200 OK`);
    }
    errors.push(...gatewayHeaderErrors(path, probe.headers));
  }

  const robots = after['/robots.txt'] || {};
  if (robots.status !== 200 || robots.body !== ROBOTS_BODY) {
    errors.push('/robots.txt is no longer the gateway disallow response');
  }
  errors.push(...gatewayHeaderErrors('/robots.txt', robots.headers));

  for (const path of ['/og.png', '/favicon.ico']) {
    const probe = after[path] || {};
    if (probe.status !== 302) {
      errors.push(`${path} returned HTTP ${probe.status ?? 'no response'}, expected the GitHub gate`);
    }
  }

  errors.push(...disallowedHostErrors(disallowedHosts));

  if (before) {
    for (const path of Object.keys(before)) {
      if (path === '/version') continue;
      const previous = before[path]?.status;
      const current = after[path]?.status;
      if (previous === 302 && current === 200) errors.push(`${path} became public`);
      if (previous === 200 && current !== 200) errors.push(`${path} stopped returning HTTP 200`);
    }
    if (before['/robots.txt']?.body === ROBOTS_BODY && after['/robots.txt']?.body !== ROBOTS_BODY) {
      errors.push('robots.txt changed; the staging gateway response must stay in place');
    }
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
