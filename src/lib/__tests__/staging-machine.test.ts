import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	STAGING_APP,
	applyRollback,
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
const builtAt = '2026-10-31T00:00:00Z';
const oldImage = 'registry.fly.io/bcdaylight-staging@sha256:1111111111111111111111111111111111111111111111111111111111111111';
const newImage = 'registry.fly.io/bcdaylight-staging@sha256:2222222222222222222222222222222222222222222222222222222222222222';

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

function machineConfig() {
	return {
		image: oldImage,
		env: {
			PORT: '3000',
			OAUTH2_PROXY_CLIENT_SECRET: 'super-secret-value',
			OAUTH2_PROXY_COOKIE_EXPIRE: '1h',
			OAUTH2_PROXY_APPROVAL_PROMPT: 'force'
		},
		init: {
			cmd: ['oauth2-proxy --config=/etc/oauth2-proxy.cfg --cookie-expire=1h --approval-prompt=force --github-user=aldervale']
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
});

describe('oauth2-proxy config patch', () => {
	it('extends the session and keeps the allow-list and secrets', () => {
		const patched = patchProxyText(proxyConfig);
		expect(patched.changed).toBe(true);
		expect(patched.text).toContain('cookie_expire = "8h"');
		expect(patched.text).toContain('cookie_refresh = "0s"');
		expect(patched.text).toContain('approval_prompt = "auto"');
		expect(patched.text).toContain('github_users = ["aldervale"]');
		expect(patched.text).toContain('client_secret = "super-secret-value"');
		expect(patched.text).toContain('cookie_secret = "cookie-secret-value"');
		expect(patched.text).toContain('^/version$');
		expect(collectSkipRoutes(patched.text)).toContain('^/robots\\.txt$');
		expect(collectSkipRoutes(patched.text)).toContain('^/version$');
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
	it('replaces only the staging image and preserves other env', () => {
		const sessionEnv = assertSessionEnv(parseEnvFile(readFileSync(sessionFile, 'utf8')));
		const { config, rollback } = planStagingUpdate(machineConfig(), {
			image: newImage,
			sessionEnv,
			skipRoutes: '^/robots\\.txt$',
			commitSha: sha,
			buildTime: builtAt
		});

		expect(config.image).toBe(newImage);
		expect(config.containers[0].image).toBe(newImage);
		expect(config.containers[1].image).toBe('registry.fly.io/other-logger:1');
		expect(config.env.OAUTH2_PROXY_CLIENT_SECRET).toBe('super-secret-value');
		expect(config.env.PORT).toBe('3000');
		expect(config.env.OAUTH2_PROXY_COOKIE_EXPIRE).toBe('8h');
		expect(config.env.OAUTH2_PROXY_COOKIE_REFRESH).toBe('0s');
		expect(config.env.OAUTH2_PROXY_APPROVAL_PROMPT).toBe('auto');
		expect(config.env.OAUTH2_PROXY_SKIP_AUTH_ROUTES).toBe(`^/robots\\.txt$,${'^/version$'}`);
		expect(config.env.COMMIT_SHA).toBe(sha);
		expect(config.init.cmd[0]).toContain('--approval-prompt=auto');
		expect(config.init.cmd[0]).toContain('--github-user=aldervale');
		expect(config.init.cmd[0]).not.toContain('approval-prompt=force');
		expect(JSON.stringify(rollback)).not.toContain('super-secret-value');
		expect(rollback.env.OAUTH2_PROXY_COOKIE_EXPIRE).toBe('1h');
		expect(rollback.env.OAUTH2_PROXY_CLIENT_SECRET).toBeUndefined();

		const restored = applyRollback(config, rollback);
		expect(restored.image).toBe(oldImage);
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
				commitSha: sha,
				buildTime: builtAt
			})
		).toThrow(/Refusing to replace image/);
	});
});

describe('staging probes', () => {
	const before = {
		'/': { status: 302, location: 'https://github.com/login/oauth/authorize?approval_prompt=force', body: '' },
		'/ping': { status: 200, body: 'OK' },
		'/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /\n' },
		'/version': { status: 302, body: '' },
		'/og.png': { status: 302, body: '' }
	};

	it('accepts a public version payload and a still-gated site', () => {
		const after = {
			...before,
			'/': { status: 302, location: 'https://github.com/login/oauth/authorize?approval_prompt=auto&client_id=example', body: '' },
			'/version': {
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ sha, builtAt })
			}
		};
		expect(evaluateStagingProbes({ before, after, expectedSha: sha, expectedBuiltAt: builtAt })).toEqual([]);
	});

	it('rejects a forced consent screen, a widened path, and extra version fields', () => {
		const forced = evaluateStagingProbes({
			before,
			after: { ...before, '/': before['/'] },
			expectedSha: sha,
			expectedBuiltAt: builtAt
		});
		expect(forced.some((error) => error.includes('approval_prompt=force'))).toBe(true);

		const widened = evaluateStagingProbes({
			before,
			after: {
				...before,
				'/': { status: 302, location: 'https://github.com/login/oauth/authorize?approval_prompt=auto', body: '' },
				'/og.png': { status: 200, body: 'png' },
				'/version': { status: 200, contentType: 'application/json', body: JSON.stringify({ sha, builtAt }) }
			},
			expectedSha: sha,
			expectedBuiltAt: builtAt
		});
		expect(widened.some((error) => error.includes('/og.png'))).toBe(true);

		const extra = evaluateStagingProbes({
			before,
			after: {
				...before,
				'/': { status: 302, location: 'https://github.com/login/oauth/authorize?approval_prompt=auto', body: '' },
				'/version': {
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ sha, builtAt, html: '<main>' })
				}
			},
			expectedSha: sha,
			expectedBuiltAt: builtAt
		});
		expect(extra.some((error) => error.includes('unexpected keys') || error.includes('markup'))).toBe(true);
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
		expect(selectStagingMachine([{ id: 'abc', state: 'started' }, { id: 'old', state: 'destroyed' }]).id).toBe(
			'abc'
		);
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
