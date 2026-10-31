import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DISALLOWED_HOSTS,
  REQUIRED_GATEWAY_HEADERS,
  ROBOTS_BODY,
  STAGING_APP,
  STAGING_OAUTH,
  applyRollback,
  assertBuildContainsCommit,
  assertSessionEnv,
  assertStagingApp,
  assertStagingImageRef,
  assertStagingOrigin,
  collectSkipRoutes,
  evaluateStagingProbes,
  mergeSkipRoutes,
  parseEnvFile,
  patchProxyText,
  planStagingUpdate,
  redactSecrets,
  selectStagingMachine
} from '../../../scripts/staging-machine.mjs';

const sessionFile = resolve(process.cwd(), 'deploy/staging/oauth2-proxy.session.env');
const sha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const oldImage =
  'registry.fly.io/bcdaylight-staging@sha256:1111111111111111111111111111111111111111111111111111111111111111';
const newImage =
  'registry.fly.io/bcdaylight-staging@sha256:2222222222222222222222222222222222222222222222222222222222222222';

const proxyConfig = `provider = "github"
client_secret = "super-secret-value"
cookie_secret = "cookie-secret-value"
cookie_name = "bcdaylight_staging"
cookie_expire = "1h"
cookie_refresh = "0s"
approval_prompt = "force"
github_users = ["aldervale"]
email_domains = ["*"]
skip_auth_routes = [
  "^/robots\\.txt$"
]
`;

const gatewayHeaders = `
server_name bc-daylight.staging.adamstuckert.com;
add_header Strict-Transport-Security "max-age=86400" always;
add_header X-Robots-Tag "noindex, nofollow, noarchive" always;
add_header Cache-Control "no-store" always;
whitelist_domains = ["bc-daylight.staging.adamstuckert.com"]
`;

function machineConfig() {
  return {
    image: oldImage,
    env: {
      PORT: '3000',
      OAUTH2_PROXY_CLIENT_SECRET: 'super-secret-value',
      OAUTH2_PROXY_COOKIE_EXPIRE: '1h',
      OAUTH2_PROXY_APPROVAL_PROMPT: 'force'
    },
    services: [
      {
        protocol: 'tcp',
        internal_port: 4180,
        ports: [
          {
            port: 443,
            handlers: ['tls', 'http'],
            http_options: {
              response: {
                headers: [
                  { name: 'Strict-Transport-Security', value: 'max-age=86400' },
                  { name: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
                  { name: 'Cache-Control', value: 'no-store' }
                ]
              }
            }
          }
        ]
      }
    ],
    checks: [{ type: 'http', path: '/ping', port: 4180 }],
    mounts: [{ path: '/data' }],
    init: {
      cmd: [
        'oauth2-proxy --config=/etc/oauth2-proxy.cfg --cookie-expire=1h --approval-prompt=force --github-user=aldervale'
      ]
    },
    containers: [
      {
        name: 'app',
        image: oldImage,
        env: { OAUTH2_PROXY_CLIENT_SECRET: 'super-secret-value' }
      },
      {
        name: 'logger',
        image: 'registry.fly.io/other-logger:1',
        env: { LOG_LEVEL: 'info' }
      }
    ]
  };
}

function observedHeaders(extra = {}) {
  return { ...REQUIRED_GATEWAY_HEADERS, ...extra };
}

function authorizeUrl(prompt) {
  const url = new URL(STAGING_OAUTH.authorize);
  url.searchParams.set('approval_prompt', prompt);
  url.searchParams.set('client_id', STAGING_OAUTH.clientId);
  url.searchParams.set('redirect_uri', STAGING_OAUTH.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', STAGING_OAUTH.scope);
  return url.toString();
}

function liveAfter() {
  const redirectHeaders = observedHeaders({
    expires: 'Thu, 01 Jan 1970 00:00:00 UTC',
    'set-cookie': '__Host-bcdaylight_staging_csrf=abc; Path=/; Max-Age=900; HttpOnly; Secure; SameSite=Lax'
  });
  return {
    '/': {
      status: 302,
      location: authorizeUrl('auto'),
      headers: redirectHeaders,
      body: ''
    },
    '/version': {
      status: 200,
      contentType: 'application/json; charset=utf-8',
      headers: observedHeaders(),
      body: JSON.stringify({ commit: sha })
    },
    '/ping': { status: 200, headers: observedHeaders(), body: 'OK' },
    '/ready': { status: 200, headers: observedHeaders(), body: 'OK' },
    '/robots.txt': { status: 200, headers: observedHeaders(), body: ROBOTS_BODY },
    '/og.png': { status: 302, body: '' },
    '/favicon.ico': { status: 302, body: '' }
  };
}

function disallowed() {
  return Object.fromEntries(DISALLOWED_HOSTS.map((host) => [host, 421]));
}

describe('staging guardrails', () => {
  it('deploys only the staging app and origin', () => {
    expect(() => assertStagingApp(STAGING_APP)).not.toThrow();
    expect(() => assertStagingApp('vancouver-pdt')).toThrow(/never production/);
    expect(() => assertStagingOrigin('https://bc-daylight.staging.adamstuckert.com/version')).not.toThrow();
    expect(() => assertStagingOrigin('https://bcdaylight.ca/version')).toThrow(/bc-daylight.staging/);
    expect(() => assertStagingImageRef('registry.fly.io/vancouver-pdt:latest')).toThrow(/Refusing image/);
  });

  it('keeps the committed session at 8 hours without forced consent', () => {
    const env = assertSessionEnv(parseEnvFile(readFileSync(sessionFile, 'utf8')));
    expect(env).toEqual({
      OAUTH2_PROXY_COOKIE_EXPIRE: '8h',
      OAUTH2_PROXY_COOKIE_REFRESH: '0s',
      OAUTH2_PROXY_APPROVAL_PROMPT: 'auto'
    });
    for (const value of Object.values(env)) {
      expect(value).not.toMatch(/secret|token|password/i);
    }
  });

  it('keeps the workflow and overlay pointed at staging', () => {
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/deploy-staging.yml'), 'utf8');
    const deploy = readFileSync(resolve(process.cwd(), 'scripts/deploy-staging.mjs'), 'utf8');
    const overlay = readFileSync(resolve(process.cwd(), 'deploy/staging/Dockerfile.overlay'), 'utf8');
    expect(workflow).toContain('needs.test.outputs.sha');
    expect(workflow).toContain('scripts/check-staging.mjs');
    expect(workflow).toContain('FLY_API_TOKEN_STAGING');
    expect(workflow).toContain('bcdaylight-staging');
    expect(workflow).not.toContain('fly deploy');
    expect(workflow).not.toContain('flyctl');
    expect(workflow).not.toContain('fly.toml');
    expect(workflow).not.toContain('vancouver-pdt');
    expect(workflow).not.toMatch(/secrets\.FLY_API_TOKEN(?!_STAGING)/);
    expect(deploy).not.toContain('fly deploy');
    expect(deploy).not.toContain('flyctl');
    expect(deploy).toContain('bcdaylight-staging');
    expect(overlay).toContain('FROM ${BASE_IMAGE}');
    expect(overlay).toContain('COPY app-build/ /app/build/');
    expect(overlay).not.toMatch(/oauth2-proxy|vancouver-pdt|fly\.toml/);
    expect(assertBuildContainsCommit([`export const commit = "${sha}";`], sha)).toBe(true);
    expect(() => assertBuildContainsCommit(['export const commit = "dev";'], sha)).toThrow(/tested commit/);
  });
});

describe('oauth2-proxy config patch', () => {
  it('extends the session and keeps the allow-list, secrets, and headers', () => {
    const patched = patchProxyText(`${gatewayHeaders}\n${proxyConfig}`);
    expect(patched.changed).toBe(true);
    expect(patched.text).toContain('cookie_expire = "8h"');
    expect(patched.text).toContain('cookie_refresh = "0s"');
    expect(patched.text).toContain('approval_prompt = "auto"');
    expect(patched.text).toContain('github_users = ["aldervale"]');
    expect(patched.text).toContain('client_secret = "super-secret-value"');
    expect(patched.text).toContain('cookie_secret = "cookie-secret-value"');
    expect(patched.text).toContain('Strict-Transport-Security "max-age=86400"');
    expect(patched.text).toContain('X-Robots-Tag "noindex, nofollow, noarchive"');
    expect(patched.text).toContain('Cache-Control "no-store"');
    expect(patched.text).toContain('server_name bc-daylight.staging.adamstuckert.com;');
    expect(patched.text).toContain('whitelist_domains = ["bc-daylight.staging.adamstuckert.com"]');
    expect(patched.text).toContain('^/version$');
    expect(collectSkipRoutes(patched.text)).toContain('^/robots\\.txt$');
    expect(collectSkipRoutes(patched.text)).toContain('^/version$');
  });

  it('leaves a header-only gateway file unchanged', () => {
    const patched = patchProxyText(gatewayHeaders);
    expect(patched.changed).toBe(false);
    expect(patched.text).toBe(gatewayHeaders);
  });

  it('rewrites explicit command flags without dropping the GitHub user', () => {
    const patched = patchProxyText(
      'oauth2-proxy --cookie-expire=1h --approval-prompt=force --cookie-refresh=1h --github-user=aldervale --skip-auth-route=^/robots.txt$'
    );
    expect(patched.text).toContain('--cookie-expire=8h');
    expect(patched.text).toContain('--approval-prompt=auto');
    expect(patched.text).toContain('--cookie-refresh=0s');
    expect(patched.text).toContain('--github-user=aldervale');
    expect(patched.text).toContain('--skip-auth-route=^/version$');
    expect(patched.text).not.toContain('approval-prompt=force');
  });

  it('does not turn a process command into a config file', () => {
    const patched = patchProxyText('oauth2-proxy --config=/etc/oauth2-proxy.cfg');
    expect(patched.text).not.toContain('skip_auth_routes');
    expect(patched.text).toContain('--cookie-expire=8h');
    expect(patched.text).toContain('--approval-prompt=auto');
  });
});

describe('machine update plan', () => {
  it('replaces only the staging image and preserves headers, hosts, and other env', () => {
    const current = machineConfig();
    const sessionEnv = assertSessionEnv(parseEnvFile(readFileSync(sessionFile, 'utf8')));
    const { config, rollback } = planStagingUpdate(current, {
      image: newImage,
      sessionEnv,
      skipRoutes: '^/robots\\.txt$',
      commitSha: sha
    });

    expect(config.image).toBe(newImage);
    expect(config.containers[0].image).toBe(newImage);
    expect(config.containers[1].image).toBe('registry.fly.io/other-logger:1');
    expect(config.services).toEqual(current.services);
    expect(config.checks).toEqual(current.checks);
    expect(config.mounts).toEqual(current.mounts);
    expect(config.env.OAUTH2_PROXY_CLIENT_SECRET).toBe('super-secret-value');
    expect(config.env.PORT).toBe('3000');
    expect(config.env.OAUTH2_PROXY_COOKIE_EXPIRE).toBe('8h');
    expect(config.env.OAUTH2_PROXY_COOKIE_REFRESH).toBe('0s');
    expect(config.env.OAUTH2_PROXY_APPROVAL_PROMPT).toBe('auto');
    expect(config.env.OAUTH2_PROXY_SKIP_AUTH_ROUTES).toBe('^/robots\\.txt$,^/version$');
    expect(config.env.COMMIT_SHA).toBe(sha);
    expect(config.init.cmd[0]).toContain('--approval-prompt=auto');
    expect(config.init.cmd[0]).toContain('--github-user=aldervale');
    expect(config.init.cmd[0]).not.toContain('approval-prompt=force');
    expect(JSON.stringify(rollback)).not.toContain('super-secret-value');
    expect(rollback.env.OAUTH2_PROXY_COOKIE_EXPIRE).toBe('1h');
    expect(rollback.env.OAUTH2_PROXY_CLIENT_SECRET).toBeUndefined();

    const restored = applyRollback(config, rollback);
    expect(restored.image).toBe(oldImage);
    expect(restored.services).toEqual(current.services);
    expect(restored.containers[1].image).toBe('registry.fly.io/other-logger:1');
    expect(restored.env.OAUTH2_PROXY_CLIENT_SECRET).toBe('super-secret-value');
    expect(restored.env.OAUTH2_PROXY_COOKIE_EXPIRE).toBe('1h');
    expect(restored.env.COMMIT_SHA).toBeUndefined();
  });

  it('refuses a production image', () => {
    const current = machineConfig();
    current.image = 'registry.fly.io/vancouver-pdt:latest';
    expect(() =>
      planStagingUpdate(current, {
        image: newImage,
        sessionEnv: assertSessionEnv(parseEnvFile(readFileSync(sessionFile, 'utf8'))),
        skipRoutes: '',
        commitSha: sha
      })
    ).toThrow(/Refusing to replace image/);
  });
});

describe('staging probes', () => {
  const before = {
    '/': { status: 302, body: '' },
    '/ping': { status: 200, body: 'OK' },
    '/ready': { status: 200, body: 'OK' },
    '/robots.txt': { status: 200, body: ROBOTS_BODY },
    '/version': { status: 302, body: '' },
    '/og.png': { status: 302, body: '' },
    '/favicon.ico': { status: 302, body: '' }
  };

  it('accepts the observed gateway with a public commit', () => {
    expect(
      evaluateStagingProbes({
        before,
        after: liveAfter(),
        expectedSha: sha,
        disallowedHosts: disallowed()
      })
    ).toEqual([]);
  });

  it('rejects a forced consent screen, a public asset, a bad host, and extra version fields', () => {
    const forced = liveAfter();
    forced['/'].location = authorizeUrl('force');
    expect(
      evaluateStagingProbes({ before, after: forced, expectedSha: sha, disallowedHosts: disallowed() }).some((error) =>
        error.includes('approval_prompt')
      )
    ).toBe(true);

    const widened = liveAfter();
    widened['/og.png'] = { status: 200, body: 'png' };
    expect(
      evaluateStagingProbes({
        before,
        after: widened,
        expectedSha: sha,
        disallowedHosts: disallowed()
      }).some((error) => error.includes('/og.png'))
    ).toBe(true);

    const extra = liveAfter();
    extra['/version'] = {
      ...extra['/version'],
      body: JSON.stringify({ commit: sha, builtAt: '2026-10-31T00:00:00Z', html: '<main>Vancouver' })
    };
    const extraErrors = evaluateStagingProbes({
      before,
      after: extra,
      expectedSha: sha,
      disallowedHosts: disallowed()
    });
    expect(extraErrors.some((error) => error.includes('unexpected keys') || error.includes('markup'))).toBe(true);

    const hosts = disallowed();
    hosts['not-allowed.example'] = 200;
    expect(
      evaluateStagingProbes({ before, after: liveAfter(), expectedSha: sha, disallowedHosts: hosts }).some((error) =>
        error.includes('not-allowed.example')
      )
    ).toBe(true);

    const repeated = liveAfter();
    repeated['/version'].headers = { ...repeated['/version'].headers, 'cache-control': 'no-store, no-store' };
    expect(
      evaluateStagingProbes({
        before,
        after: repeated,
        expectedSha: sha,
        disallowedHosts: disallowed()
      })
    ).toEqual([]);

    const uncached = liveAfter();
    delete uncached['/'].headers['cache-control'];
    expect(
      evaluateStagingProbes({
        before,
        after: uncached,
        expectedSha: sha,
        disallowedHosts: disallowed()
      }).some((error) => error.includes('cache-control'))
    ).toBe(true);
  });
});

describe('machine selection and redaction', () => {
  it('requires the single live staging machine', () => {
    expect(selectStagingMachine([{ id: 'abc', state: 'started' }]).id).toBe('abc');
    expect(() =>
      selectStagingMachine([
        { id: 'abc', state: 'started' },
        { id: 'def', state: 'stopped' }
      ])
    ).toThrow(/exactly one/);
    expect(
      selectStagingMachine([
        { id: 'abc', state: 'started' },
        { id: 'old', state: 'destroyed' }
      ]).id
    ).toBe('abc');
  });

  it('redacts credential-like text', () => {
    const redacted = redactSecrets(
      'client_secret=super-secret-value --client-secret=abc Bearer fo1_abcdefghijklmnopqrstuvwxyz'
    );
    expect(redacted).not.toContain('super-secret-value');
    expect(redacted).not.toContain('fo1_abcdefghijklmnopqrstuvwxyz');
    expect(redacted).toContain('[REDACTED]');
  });

  it('merges the version route without duplicating it', () => {
    expect(mergeSkipRoutes(['^/robots\\.txt$', '^/version$'])).toBe('^/robots\\.txt$,^/version$');
  });
});
