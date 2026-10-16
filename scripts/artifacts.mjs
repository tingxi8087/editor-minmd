import { cp, mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

export async function findBundles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if ((entry.isDirectory() && entry.name.endsWith('.app')) || (entry.isFile() && /\.(dmg|msi|exe|deb|rpm|AppImage|appimage|tar\.gz|sig)$/.test(entry.name))) result.push(path);
    else if (entry.isDirectory()) result.push(...await findBundles(path));
  }
  return result;
}

export async function exportBundles({ root, bundleDirectory, version, target, debug = false, zipApp }) {
  const bundles = await findBundles(bundleDirectory);
  if (!bundles.length) throw new Error('Tauri 未生成可分发产物，未更新 build 目录');
  const parent = resolve(root, 'build', version);
  await mkdir(parent, { recursive: true });
  const stage = await mkdtemp(join(parent, '.staging-'));
  const destination = join(parent, `${target}${debug ? '-debug' : ''}`);
  const backup = `${stage}.previous`;
  let previous = false;
  try {
    const names = new Set();
    for (const source of bundles) {
      const name = basename(source);
      if (names.has(name)) throw new Error(`产物名称冲突：${name}`);
      names.add(name);
      await cp(source, join(stage, name), { recursive: true, dereference: false, verbatimSymlinks: true });
      if (name.endsWith('.app') && zipApp) {
        const archiveName = `${basename(name, '.app')}_${version}_${target}${debug ? '-debug' : ''}.zip`;
        await zipApp(join(stage, name), join(stage, archiveName));
        names.add(archiveName);
      }
    }
    await writeFile(join(stage, 'build-info.json'), JSON.stringify({ version, target, profile: debug ? 'debug' : 'release', builtAt: new Date().toISOString(), files: [...names] }, null, 2) + '\n');
    try { await rename(destination, backup); previous = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await rename(stage, destination); } catch (error) { if (previous) await rename(backup, destination); throw error; }
    if (previous) await rm(backup, { recursive: true, force: true });
    return destination;
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}
