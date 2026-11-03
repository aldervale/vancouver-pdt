import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { gatewayDiscoveryCommand, configPathsFromProcessList, proceedToDeploy } from '../../../scripts/staging-machine.mjs';

function fixture(run: (root: string, bin: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'gateway-discovery-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'ps'), '#!/bin/sh\nprintf "%s\\n" "oauth2-proxy --config=/infra/oauth2-proxy.cfg"\n', { mode: 0o755 });
  try { run(root, bin); } finally { rmSync(root, { recursive: true, force: true }); }
}

function execute(command: string, bin: string) {
  return spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` } });
}

describe('gateway discovery shell', () => {
  it('keeps process and config discovery when optional roots do not exist', () => fixture((root, bin) => {
    const infra = join(root, 'infra'); mkdirSync(infra);
    const file = join(infra, 'oauth2-proxy.cfg'); writeFileSync(file, 'provider = "github"\n');
    const result = execute(gatewayDiscoveryCommand([infra, join(root, 'missing')]), bin);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(file);
    expect(configPathsFromProcessList(result.stdout)).toContain('/infra/oauth2-proxy.cfg');
    expect(result.stderr).toBe('');
    expect(gatewayDiscoveryCommand()).toContain("'/infra'");
  }));

  it('does not suppress a real find failure or proceed to deployment', () => fixture((root, bin) => {
    writeFileSync(join(bin, 'find'), '#!/bin/sh\necho "fixture discovery failure" >&2\nexit 7\n', { mode: 0o755 });
    const result = execute(gatewayDiscoveryCommand([root]), bin);
    expect(result.status).toBe(7);
    expect(result.stderr).toContain('fixture discovery failure');
    let called = false;
    expect(() => proceedToDeploy([{ path: '(staging gateway)', unreadable: true, error: 'exec failed' }], () => { called = true; })).toThrow(/not a fallback/);
    expect(called).toBe(false);
  }));

  it('fails closed if process enumeration fails', () => fixture((root, bin) => {
    writeFileSync(join(bin, 'ps'), '#!/bin/sh\nexit 9\n', { mode: 0o755 });
    expect(execute(gatewayDiscoveryCommand([root]), bin).status).toBe(9);
  }));

  it('rejects unsafe discovery roots', () => {
    expect(() => gatewayDiscoveryCommand(["/tmp/quote'bad"])).toThrow(/Invalid/);
    expect(() => gatewayDiscoveryCommand([])).toThrow(/Invalid/);
  });
});
