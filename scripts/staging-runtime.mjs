/** Conservative guard before replacing the app's shared node_modules tree. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { builtinModules } from 'node:module';
import { parse } from 'acorn';

const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const loaderModules = new Set(['module', 'node:module', 'vm', 'node:vm']);

/** Only the gateway's existing numeric heap limit may pass through NODE_OPTIONS. */
export function hasUnsafeModuleEnvironment(environment) {
  const values = Object.fromEntries(String(environment).split('\0').map((value) => {
    const at = value.indexOf('=');
    return [value.slice(0, at), value.slice(at + 1)];
  }));
  return Boolean(values.NODE_PATH) || Boolean(values.NODE_OPTIONS?.trim()
    && !/^--max-old-space-size=[1-9]\d{0,5}$/.test(values.NODE_OPTIONS.trim()));
}

/** Parse without executing. Diagnostics contain classifications, never source text. */
export function inspectGatewayWrapper(source) {
  const imports = [];
  const loaders = new Set();
  const digest = createHash('sha256').update(source).digest('hex');
  let ast;
  try { ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }); }
  catch { return { sha256: digest, imports, remainingLoaderKinds: ['parse-error'] }; }
  const allowedRequire = new Set();
  function dependency(kind, specifier) {
    // Only known builtin names are logged verbatim. Arbitrary import strings may
    // be paths/URLs with credentials, so classify other specifiers instead.
    imports.push({ kind, specifier: builtins.has(specifier) ? specifier : '[non-builtin]' });
    if (!builtins.has(specifier)) loaders.add('non-builtin-import');
    if (loaderModules.has(specifier)) loaders.add('module-loader-import');
  }
  function visit(node, parent) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ImportDeclaration') dependency('import', node.source.value);
    if (node.type === 'ImportExpression') loaders.add('dynamic-import');
    if (node.type === 'ExportAllDeclaration' || (node.type === 'ExportNamedDeclaration' && node.source)) {
      loaders.add('export-from');
      dependency('export-from', node.source.value);
    } else if (node.type?.startsWith('Export')
      && !(node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'FunctionDeclaration')) {
      loaders.add('unsupported-export');
    }
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require') {
      allowedRequire.add(node.callee);
      if (!node.optional && node.arguments.length === 1 && node.arguments[0].type === 'Literal'
        && typeof node.arguments[0].value === 'string') dependency('require', node.arguments[0].value);
      else loaders.add('dynamic-require');
    }
    if (node.type === 'Identifier') {
      if (node.name === 'require' && !allowedRequire.has(node)) loaders.add('require-reference');
      if (['createRequire', 'eval', 'Function', 'module', 'NODE_PATH'].includes(node.name)) loaders.add('module-loader-reference');
    }
    if (node.type === 'MemberExpression') {
      const property = node.computed ? node.property.value : node.property.name;
      if (['dlopen', 'binding', 'mainModule', '_load', '_compile', 'getBuiltinModule', 'createRequire', 'require', 'eval', 'Function'].includes(property)) loaders.add('module-loader-member');
      // import.meta.url is provenance, not a dependency. Other uses are unknown.
      if (node.object.type === 'MetaProperty' && property !== 'url') loaders.add('import-meta-loader');
    }
    if (node.type === 'MetaProperty' && !(parent?.type === 'MemberExpression'
      && parent.object === node && (parent.computed ? parent.property.value : parent.property.name) === 'url')) {
      loaders.add('unsupported-meta');
    }
    if (node.type === 'Literal' && typeof node.value === 'string' && /node_modules/.test(node.value)) {
      loaders.add('app-dependency-path');
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'start' || key === 'end') continue;
      if (Array.isArray(value)) value.forEach((item) => visit(item, node));
      else if (value && typeof value === 'object') visit(value, node);
    }
  }
  visit(ast);
  return { sha256: digest, imports: imports.slice(0, 16), remainingLoaderKinds: [...loaders].sort() };
}

export function assertIndependentGatewayRuntime(report, diagnostic = () => {}) {
  assert(report && /^v\d+\./.test(report.node), 'Cannot determine the staging Node runtime');
  assert(Array.isArray(report.processes) && report.processes.length > 0, 'Cannot inspect staging Node processes');
  let appFound = false;
  for (const entry of report.processes) {
    assert(!entry.error, 'Cannot inspect a staging Node entrypoint; the machine was not updated');
    assert(!entry.moduleEnvironment, 'Gateway uses unsupported NODE_OPTIONS or NODE_PATH; inspect before replacing app dependencies');
    assert(entry.executable === report.executable, 'Staging uses multiple Node runtimes; inspect before replacing app dependencies');
    if (['/app/build', '/app/build/index.js'].includes(entry.entrypoint)) {
      appFound = true;
      continue;
    }
    assert(typeof entry.source === 'string' && entry.source.length > 0,
      'Cannot inspect the gateway Node wrapper; the machine was not updated');
    const result = inspectGatewayWrapper(entry.source);
    const entrypoint = /^\/[\w./@+-]{1,180}$/.test(entry.entrypoint) ? entry.entrypoint : '[unknown]';
    diagnostic({ entrypoint, ...result });
    assert(result.remainingLoaderKinds.length === 0,
      `Gateway wrapper dependency check failed: ${JSON.stringify({ entrypoint, ...result })}; the machine was not updated`);
  }
  assert(appFound, 'The running /app/build Node process was not found; the machine was not updated');
  return report.node;
}

// Runs on the staging machine using only Node builtins. Never returns process
// env values or prints argv/source; the caller uses that data only for the guard above.
export const inspectStagingRuntimeSource = `const hasUnsafeModuleEnvironment = ${hasUnsafeModuleEnvironment.toString()};\n` + String.raw`
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
    const moduleEnvironment = hasUnsafeModuleEnvironment(await readFile('/proc/' + pid + '/environ', 'utf8'));
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
