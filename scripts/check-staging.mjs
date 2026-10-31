/**
 * Post-deploy checks for https://bc-daylight.staging.adamstuckert.com.
 * Fails when the GitHub gate, /version, gateway headers, or host restriction move.
 */

import { appendFileSync } from 'node:fs';
import https from 'node:https';
import { pathToFileURL } from 'node:url';
import {
  DISALLOWED_HOSTS,
  STAGING_ORIGIN,
  assertStagingOrigin,
  evaluateStagingProbes
} from './staging-machine.mjs';

const PATHS = ['/', '/version', '/ping', '/ready', '/robots.txt', '/og.png', '/favicon.ico'];
const WINDOW_MS = Number(process.env.STAGING_CHECK_WINDOW_MS || 180000);
const PAUSE_MS = 5000;

function request({ hostname, servername, hostHeader, path }) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        servername: servername || hostname,
        path,
        method: 'GET',
        headers: {
          Host: hostHeader || hostname,
          'user-agent': 'bcdaylight-staging-check',
          accept: '*/*'
        },
        timeout: 15000
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8')
          });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error(`timeout GET ${path}`)));
    req.on('error', reject);
    req.end();
  });
}

function asProbe(res) {
  return {
    status: res.status,
    location: res.headers.location || '',
    contentType: res.headers['content-type'] || '',
    setCookie: res.headers['set-cookie'],
    headers: res.headers,
    body: res.body
  };
}

export async function collectObservations() {
  assertStagingOrigin(STAGING_ORIGIN);
  const hostname = new URL(STAGING_ORIGIN).hostname;
  const probes = {};
  for (const path of PATHS) {
    probes[path] = asProbe(await request({ hostname, path }));
  }
  const disallowedHosts = {};
  for (const host of DISALLOWED_HOSTS) {
    if (host.endsWith('.fly.dev')) {
      const response = await request({ hostname: host, path: '/' });
      disallowedHosts[host] = response.status;
    } else {
      const response = await request({
        hostname,
        servername: hostname,
        hostHeader: host,
        path: '/'
      });
      disallowedHosts[host] = response.status;
    }
  }
  return { probes, disallowedHosts };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function checkStaging({ expectedSha, before } = {}) {
  if (process.env.STAGING_BASE_URL) assertStagingOrigin(process.env.STAGING_BASE_URL);
  assertStagingOrigin(STAGING_ORIGIN);
  const sha = expectedSha || process.env.EXPECTED_SHA || '';
  const deadline = Date.now() + WINDOW_MS;
  let lastErrors = ['no response'];
  while (Date.now() <= deadline) {
    try {
      const observations = await collectObservations();
      const errors = evaluateStagingProbes({
        before,
        after: observations.probes,
        expectedSha: sha,
        disallowedHosts: observations.disallowedHosts
      });
      if (errors.length === 0) return observations;
      lastErrors = errors;
    } catch (error) {
      lastErrors = [error instanceof Error ? error.message : 'request failed'];
    }
    if (Date.now() + PAUSE_MS > deadline) break;
    await sleep(PAUSE_MS);
  }
  throw new Error(`Staging gateway checks failed:\n- ${lastErrors.join('\n- ')}`);
}

function writeSummary(lines) {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (!summary) return;
  appendFileSync(summary, `${lines.join('\n')}\n`);
}

async function main() {
  const expectedSha = process.env.EXPECTED_SHA || '';
  const lines = [
    '## Staging gateway',
    '',
    `- App: \`bcdaylight-staging\``,
    `- URL: ${STAGING_ORIGIN}`,
    `- Expected commit: \`${expectedSha || '(missing)'}\``
  ];
  try {
    if (!expectedSha) throw new Error('EXPECTED_SHA is not set');
    const observations = await checkStaging({ expectedSha });
    const body = JSON.parse(observations.probes['/version'].body);
    lines.push(`- Deployed commit: \`${body.commit}\``);
    lines.push('- `GET /`: **pass** (redirects to GitHub with `approval_prompt=auto`)');
    lines.push('- `GET /version`: **pass** (public JSON, commit matches, no site content)');
    lines.push('- Security and cache headers: **pass**');
    lines.push('- Disallowed Host: **pass** (421)');
    lines.push('- Result: **pass**');
    writeSummary(lines);
    console.log(lines.join('\n'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lines.push('- Result: **fail**');
    lines.push(`- ${message}`);
    writeSummary(lines);
    console.error(lines.join('\n'));
    process.exit(1);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main();
}
