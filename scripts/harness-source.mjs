import { createRequire } from 'node:module';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Resolve built public workspace exports without adding this plugin to the upstream workspace. */
export async function harnessSource(source) {
  if (!source) throw new Error('Set DSH_SOURCE_DIR to a built deepseek-harness checkout.');
  const packages = new Map();
  async function add(dir) {
    try { const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')); packages.set(manifest.name, { dir, manifest }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const group of await readdir(join(resolve(source), 'packages'), { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    for (const pkg of await readdir(join(source, 'packages', group.name), { withFileTypes: true })) {
      if (pkg.isDirectory()) await add(join(source, 'packages', group.name, pkg.name));
    }
  }
  for (const pkg of await readdir(join(source, 'vendor'), { withFileTypes: true })) if (pkg.isDirectory()) await add(join(source, 'vendor', pkg.name));
  const importPackage = async name => {
    const found = packages.get(name); if (!found) throw new Error(`Harness source has no ${name}`);
    const ownRequire = createRequire(join(resolve(found.dir), 'package.json'));
    return import(pathToFileURL(ownRequire.resolve(name)).href);
  };
  return { importPackage, packages };
}
