#!/usr/bin/env node
/** Check the installed app tree, not just npm audit's dependency selection. */
import assert from 'node:assert/strict';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function checkRuntimeDependencies(root = process.cwd()) {
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
  assert(lock.lockfileVersion >= 2 && lock.packages, 'A current package lock is required');
  const installed = new Set();

  async function inspect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const path = resolve(directory, entry.name);
      assert(!entry.isSymbolicLink(), `Unexpected linked runtime package: ${path}`);
      if (entry.name.startsWith('@')) {
        await inspect(path);
        continue;
      }
      assert(entry.isDirectory(), `Unexpected runtime package file: ${path}`);
      const key = relative(root, path).replaceAll('\\', '/');
      const expected = lock.packages[key];
      assert(expected && !expected.dev, `Development or unlocked package installed: ${key}`);
      const actual = JSON.parse(await readFile(resolve(path, 'package.json'), 'utf8'));
      assert.equal(actual.version, expected.version, `Runtime version differs from lockfile: ${key}`);
      installed.add(key);
      const nested = resolve(path, 'node_modules');
      try {
        await lstat(nested);
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      await inspect(nested);
    }
  }

  await inspect(resolve(root, 'node_modules'));
  for (const name of Object.keys(manifest.dependencies || {})) {
    assert(installed.has(`node_modules/${name}`), `Missing production dependency: ${name}`);
  }
  return { node: process.version, packages: [...installed].sort() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await checkRuntimeDependencies(resolve(process.argv[2] || '.'))));
}
