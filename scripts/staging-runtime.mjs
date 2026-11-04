/** Conservative guard before replacing the app's shared node_modules tree. */
import assert from 'node:assert/strict';
import { builtinModules } from 'node:module';

const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

export function assertIndependentGatewayRuntime(report) {
  assert(report && /^v\d+\./.test(report.node), 'Cannot determine the staging Node runtime');
  assert(Array.isArray(report.processes) && report.processes.length > 0, 'Cannot inspect staging Node processes');
  let appFound = false;
  for (const entry of report.processes) {
    assert(!entry.error, 'Cannot inspect a staging Node entrypoint; the machine was not updated');
    assert(!entry.moduleEnvironment, 'Gateway uses NODE_OPTIONS or NODE_PATH; inspect before replacing app dependencies');
    assert(entry.executable === report.executable, 'Staging uses multiple Node runtimes; inspect before replacing app dependencies');
    if (['/app/build', '/app/build/index.js'].includes(entry.entrypoint)) {
      appFound = true;
      continue;
    }
    assert(typeof entry.source === 'string' && entry.source.length > 0,
      'Cannot inspect the gateway Node wrapper; the machine was not updated');
    // Only simple builtin-only wrappers are supported. Unknown dynamic loaders,
    // local modules and npm imports need a human review, not a guessed allowlist.
    let source = entry.source;
    assert(!/node_modules|NODE_PATH|createRequire|\beval\b|\bFunction\b|\bmodule\b|process\s*\.\s*(?:dlopen|binding|mainModule)|\bimport\s*\(/.test(source),
      'Gateway wrapper has an unknown module loader or app dependency; the machine was not updated');
    const allow = (_, specifier) => {
      assert(builtins.has(specifier), `Gateway wrapper imports ${specifier}; inspect before replacing app dependencies`);
      return '';
    };
    source = source.replace(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, allow);
    source = source.replace(/\bimport\s+(?:[\w\s{},*$]+\s+from\s+)?['"]([^'"]+)['"]\s*;?/g, allow);
    assert(!/\brequire\b|\bimport\b|\bexport\b/.test(source),
      'Gateway wrapper has unsupported imports; inspect before replacing app dependencies');
  }
  assert(appFound, 'The running /app/build Node process was not found; the machine was not updated');
  return report.node;
}

// Runs on the staging machine using only Node builtins. Never returns process
// env values or prints argv/source; the caller uses that data only for the guard above.
export const inspectStagingRuntimeSource = String.raw`
const { readdir, readFile, readlink, realpath } = await import('node:fs/promises');
const { resolve, basename } = await import('node:path');
const processes = [];
for (const pid of await readdir('/proc')) {
  if (!/^\d+$/.test(pid) || Number(pid) === process.pid) continue;
  let executable;
  try { executable = await readlink('/proc/' + pid + '/exe'); }
  catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') continue;
    throw new Error('Cannot inspect a running process executable');
  }
  if (!/^node(?:js)?$/.test(basename(executable))) continue;
  try {
    const args = (await readFile('/proc/' + pid + '/cmdline', 'utf8')).split('\0').filter(Boolean);
    const cwd = await readlink('/proc/' + pid + '/cwd');
    // Inspect only loader-related flags. Never return or log environment values.
    const moduleEnvironment = (await readFile('/proc/' + pid + '/environ', 'utf8'))
      .split('\0').some((value) => /^(?:NODE_OPTIONS|NODE_PATH)=.+/.test(value));
    const remaining = args.slice(1);
    while (['--enable-source-maps', '--no-warnings', '--trace-warnings'].includes(remaining[0])) remaining.shift();
    if (!remaining[0] || remaining[0].startsWith('-')) throw new Error('Unknown Node invocation');
    const entrypoint = await realpath(resolve(cwd, remaining[0]));
    if (!/^\/[\w./@+-]+$/.test(entrypoint)) throw new Error('Unknown Node entrypoint');
    let source;
    if (!['/app/build', '/app/build/index.js'].includes(entrypoint)) {
      source = await readFile(entrypoint, 'utf8');
      if (source.length > 256 * 1024) throw new Error('Gateway wrapper too large to inspect');
    }
    processes.push({ executable, entrypoint, source, moduleEnvironment });
  } catch { processes.push({ error: true }); }
}
console.log(JSON.stringify({ node: process.version, executable: process.execPath, processes }));
`;
