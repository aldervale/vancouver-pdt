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
  proceedToDeploy,
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

  it('adds approval_prompt when the config has no such key', () => {
    const config = `provider = "github"
client_secret = "super-secret-value"
cookie_secret = "cookie-secret-value"
cookie_name = "bcdaylight_staging"
cookie_expire = "168h"
cookie_refresh = "1h"
github_users = ["aldervale"]
email_domains = ["*"]
skip_auth_routes = [
  "^/robots\\.txt$",
  "^/ping$"
]
`;
    expect(config).not.toContain('approval_prompt');
    const patched = patchProxyText(config);
    expect(patched.text.match(/(^|\n)[ \t]*approval_prompt[ \t]*[:=]/g)).toHaveLength(1);
    expect(patched.text).toContain('approval_prompt = "auto"');
    expect(patched.text).toContain('cookie_expire = "8h"');
    expect(patched.text).toContain('cookie_refresh = "0s"');
    expect(patched.text).not.toContain('168h');
    expect(patched.text).not.toContain('cookie_refresh = "1h"');
    expect(patched.text).toContain('github_users = ["aldervale"]');
    expect(patched.text).toContain('client_secret = "super-secret-value"');
    expect(patched.text).toContain('cookie_secret = "cookie-secret-value"');
    expect(collectSkipRoutes(patched.text)).toEqual(
      expect.arrayContaining(['^/robots\\.txt$', '^/ping$', '^/version$'])
    );
    expect(patchProxyText(patched.text).text).toBe(patched.text);
  });

  it('delivers session settings to the supervisord oauth2-proxy program', () => {
    const supervisor = `[supervisord]
nodaemon=true

[program:oauth2-proxy]
command=/entrypoint.sh
environment=OAUTH2_PROXY_CLIENT_ID="Ov23liBwlGSka4oQIqj0",OAUTH2_PROXY_CLIENT_SECRET="super-secret-value",OAUTH2_PROXY_COOKIE_SECRET="cookie-secret-value",OAUTH2_PROXY_COOKIE_EXPIRE="168h",OAUTH2_PROXY_SCOPE="user:email,read:org",OAUTH2_PROXY_GITHUB_USER="aldervale"
directory=/etc/oauth2-proxy
stdout_logfile=/var/log/oauth2-proxy.log
stdout_logfile_maxbytes=0

[program:web]
command=/app/server
environment=PORT="3000"
`;
    const patched = patchProxyText(supervisor);
    const section = programSection(patched.text, 'oauth2-proxy');
    const environment = section.match(/^\s*environment\s*=(.*)$/m)?.[1] ?? '';

    expect(section.split('\n')[0]).toBe('[program:oauth2-proxy]');
    expect(section.split('\n')[0]).not.toContain('--');
    expect(patched.text).toContain('command=/entrypoint.sh\n');
    expect(patched.text).toContain('directory=/etc/oauth2-proxy\n');
    expect(patched.text).toContain('stdout_logfile=/var/log/oauth2-proxy.log\n');
    expect(environment).toContain('OAUTH2_PROXY_COOKIE_EXPIRE="8h"');
    expect(environment).toContain('OAUTH2_PROXY_COOKIE_REFRESH="0s"');
    expect(environment).toContain('OAUTH2_PROXY_APPROVAL_PROMPT="auto"');
    expect(environment.match(/OAUTH2_PROXY_COOKIE_EXPIRE=/g)).toHaveLength(1);
    expect(environment).not.toContain('168h');
    expect(environment).toContain('OAUTH2_PROXY_CLIENT_SECRET="super-secret-value"');
    expect(environment).toContain('OAUTH2_PROXY_COOKIE_SECRET="cookie-secret-value"');
    expect(environment).toContain('OAUTH2_PROXY_SCOPE="user:email,read:org"');
    expect(environment).toContain('OAUTH2_PROXY_GITHUB_USER="aldervale"');
    expect(patched.text).not.toMatch(/(^|\n)\s*approval_prompt\s*[:=]/);
    expect(programSection(patched.text, 'web')).toBe(programSection(supervisor, 'web'));
    expect(patchProxyText(patched.text).text).toBe(patched.text);

    const direct = patchProxyText(`[program:oauth2-proxy]
command=/usr/local/bin/oauth2-proxy --config=/etc/oauth2-proxy.cfg --github-user=aldervale
environment=OAUTH2_PROXY_CLIENT_SECRET="super-secret-value"
`);
    expect(direct.text.split('\n')[0]).toBe('[program:oauth2-proxy]');
    const command = direct.text.match(/^command=(.*)$/m)?.[1] ?? '';
    expect(command.startsWith('/usr/local/bin/oauth2-proxy ')).toBe(true);
    expect(command).toContain('--cookie-expire=8h');
    expect(command).toContain('--cookie-refresh=0s');
    expect(command).toContain('--approval-prompt=auto');
    expect(command).toContain('--github-user=aldervale');
    expect(direct.text).toContain('OAUTH2_PROXY_COOKIE_EXPIRE="8h"');
    expect(direct.text).toContain('OAUTH2_PROXY_COOKIE_REFRESH="0s"');
    expect(direct.text).toContain('OAUTH2_PROXY_APPROVAL_PROMPT="auto"');
    expect(direct.text).toContain('OAUTH2_PROXY_CLIENT_SECRET="super-secret-value"');
    expect(patchProxyText(direct.text).text).toBe(direct.text);
  });
});

function programSection(text, name) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === `[program:${name}]`);
  if (start < 0) throw new Error(`missing [program:${name}]`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].trim().startsWith('[')) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

function changedPaths(before, after, prefix = '') {
  if (Object.is(before, after)) return [];
  const bothObjects =
    before !== null &&
    after !== null &&
    typeof before === 'object' &&
    typeof after === 'object' &&
    !Array.isArray(before) &&
    !Array.isArray(after);
  if (!bothObjects) {
    return JSON.stringify(before) === JSON.stringify(after) ? [] : [prefix || '(root)'];
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const paths = [];
  for (const key of keys) {
    paths.push(...changedPaths(before[key], after[key], prefix ? `${prefix}.${key}` : key));
  }
  return paths;
}

function readPath(value, path) {
  return path.split('.').reduce((current, key) => current?.[key], value);
}

describe('gateway config gate', () => {
  const proxyFile = { path: '/etc/oauth2-proxy.cfg', text: proxyConfig };

  function trackedDeploy() {
    const steps = [];
    return {
      steps,
      deploy(prepared) {
        steps.push('build-image', 'update-machine');
        return prepared;
      }
    };
  }

  it('aborts before any deploy step when the gateway config cannot be read', () => {
    const unreadables = [
      [],
      [{ path: '/etc/oauth2-proxy.cfg', unreadable: true, error: 'permission denied' }],
      [{ path: '(staging gateway)', unreadable: true, error: 'exec failed' }],
      [proxyFile, { path: '/etc/supervisord.conf', unreadable: true, error: 'permission denied' }]
    ];
    for (const files of unreadables) {
      const run = trackedDeploy();
      expect(() => proceedToDeploy(files, run.deploy)).toThrow(/Refusing to deploy/);
      expect(() => proceedToDeploy(files, run.deploy)).toThrow(/not a fallback/);
      expect(() => proceedToDeploy(files, run.deploy)).toThrow(/was not updated/);
      expect(run.steps).toEqual([]);
    }
  });

  it('aborts before any deploy step when the gateway config cannot be patched', () => {
    const headerOnly = { path: '/etc/nginx/oauth2.conf', text: gatewayHeaders };
    const removesPolicy = {
      path: '/etc/oauth2-proxy.cfg',
      text: 'provider = "github"\ncookie_expire = "max-age=86400"\ngithub_users = ["aldervale"]\n'
    };
    for (const files of [[headerOnly], [removesPolicy]]) {
      const run = trackedDeploy();
      expect(() => proceedToDeploy(files, run.deploy)).toThrow(/could not be patched/);
      expect(() => proceedToDeploy(files, run.deploy)).toThrow(/was not updated/);
      expect(() => proceedToDeploy(files, run.deploy)).toThrow(/not a fallback/);
      expect(run.steps).toEqual([]);
    }

    const deploy = readFileSync(resolve(process.cwd(), 'scripts/deploy-staging.mjs'), 'utf8');
    expect(deploy).not.toContain('Session env will still be applied');
    expect(deploy).not.toContain('Gateway config files were not readable');
    expect(deploy).not.toContain('Skipping unreadable config');
    const gate = deploy.indexOf('await proceedToDeploy');
    expect(gate).toBeGreaterThan(-1);
    const afterGate = deploy.slice(gate);
    expect(afterGate.indexOf('await buildOverlay')).toBeGreaterThan(0);
    expect(afterGate.indexOf('await updateMachine')).toBeGreaterThan(0);
    expect(afterGate.indexOf('await buildOverlay')).toBeLessThan(afterGate.indexOf('await updateMachine'));
  });

  it('starts deploy steps only after the gateway config is patched', () => {
    const run = trackedDeploy();
    const prepared = proceedToDeploy([proxyFile, { path: '/etc/nginx.conf', text: gatewayHeaders }], run.deploy);
    expect(run.steps).toEqual(['build-image', 'update-machine']);
    expect(prepared.files[0].text).toContain('cookie_expire = "8h"');
    expect(prepared.files[0].text).toContain('cookie_refresh = "0s"');
    expect(prepared.files[0].text).toContain('approval_prompt = "auto"');
    expect(prepared.files[1].changed).toBe(false);
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

    const restored = applyRollback(config, JSON.parse(JSON.stringify(rollback)));
    expect(restored).toEqual(current);
    expect(restored.init.cmd).toEqual(current.init.cmd);
    expect(restored.init.cmd[0]).toContain('--approval-prompt=force');
    expect(restored.image).toBe(oldImage);
    expect(restored.services).toEqual(current.services);
    expect(restored.containers[1].image).toBe('registry.fly.io/other-logger:1');
    expect(restored.env.OAUTH2_PROXY_CLIENT_SECRET).toBe('super-secret-value');
    expect(restored.env.OAUTH2_PROXY_COOKIE_EXPIRE).toBe('1h');
    expect(restored.env.COMMIT_SHA).toBeUndefined();
  });

  it('restores every command field the deploy changed, including init.cmd', () => {
    const current = machineConfig();
    current.init.entrypoint = '/usr/bin/oauth2-proxy --approval-prompt=force --github-user=aldervale';
    current.init.exec = 'oauth2-proxy --cookie-expire=1h --approval-prompt=force --github-user=aldervale';
    current.command = 'oauth2-proxy --approval-prompt=force --cookie-refresh=1h --github-user=aldervale';
    current.cmd = ['oauth2-proxy --cookie-expire=1h --approval-prompt=force --github-user=aldervale'];
    current.entrypoint = ['/usr/local/bin/oauth2-proxy', '--approval-prompt=force', '--github-user=aldervale'];
    current.exec = 'oauth2-proxy --approval-prompt=force --github-user=aldervale';
    current.processes = [
      {
        command: 'oauth2-proxy --approval-prompt=force --github-user=aldervale',
        cmd: 'oauth2-proxy --cookie-expire=1h --approval-prompt=force --github-user=aldervale',
        entrypoint: '/usr/bin/oauth2-proxy --cookie-refresh=1h --approval-prompt=force --github-user=aldervale',
        exec: 'oauth2-proxy --approval-prompt=force --github-user=aldervale'
      }
    ];
    current.containers[0].command = 'oauth2-proxy --approval-prompt=force --cookie-expire=1h --github-user=aldervale';
    current.containers[0].cmd = ['oauth2-proxy --approval-prompt=force --github-user=aldervale'];
    current.containers[0].entrypoint = '/usr/local/bin/oauth2-proxy --approval-prompt=force --github-user=aldervale';
    current.containers[0].exec = 'oauth2-proxy --cookie-refresh=1h --approval-prompt=force --github-user=aldervale';
    const original = structuredClone(current);
    const sessionEnv = assertSessionEnv(parseEnvFile(readFileSync(sessionFile, 'utf8')));
    const { config, rollback } = planStagingUpdate(current, {
      image: newImage,
      sessionEnv,
      skipRoutes: '^/robots\\.txt$',
      commitSha: sha
    });

    const changed = changedPaths(original, config);
    expect(changed).toEqual(expect.arrayContaining(['init.cmd', 'init.entrypoint', 'init.exec']));
    expect(changed).toEqual(
      expect.arrayContaining(['command', 'cmd', 'entrypoint', 'exec', 'processes', 'image', 'containers'])
    );
    expect(config.init.cmd[0]).toContain('--approval-prompt=auto');
    expect(config.init.cmd[0]).not.toContain('approval-prompt=force');
    expect(config.containers[0].command).not.toEqual(original.containers[0].command);
    expect(config.containers[0].cmd).not.toEqual(original.containers[0].cmd);
    expect(config.containers[0].entrypoint).not.toEqual(original.containers[0].entrypoint);
    expect(config.containers[0].exec).not.toEqual(original.containers[0].exec);
    expect(config.processes).not.toEqual(original.processes);

    const restored = applyRollback(config, JSON.parse(JSON.stringify(rollback)));
    expect(changedPaths(original, restored)).toEqual([]);
    expect(restored).toEqual(original);
    for (const path of changed) {
      expect(readPath(restored, path)).toEqual(readPath(original, path));
    }
    expect(restored.init.cmd).toEqual(original.init.cmd);
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
