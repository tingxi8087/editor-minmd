import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, readlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
// @ts-expect-error Build scripts are native Node ES modules, executed without TS compilation.
import { syncVersion } from '../scripts/version.mjs';
// @ts-expect-error Native Node module shared with the packaging entry point.
import { exportBundles } from '../scripts/artifacts.mjs';
const temporary: string[] = [];
const root = async () => { const path = await mkdtemp(join(tmpdir(), 'minmd-build-')); temporary.push(path); return path; };
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
it('takes package.json as the version source without changing dependency versions or rewriting unchanged files', async () => {
  const dir = await root(); await mkdir(join(dir, 'src-tauri'));
  await writeFile(join(dir, 'package.json'), JSON.stringify({ version: '1.2.3-beta.2' }));
  await writeFile(join(dir, 'package-lock.json'), JSON.stringify({ version: '0.1.0', packages: { '': { version: '0.1.0' }, 'node_modules/example': { version: '5.0.0' } } }));
  const cargo = join(dir, 'src-tauri/Cargo.toml');
  await writeFile(cargo, '[package]\nname = "test"\nversion = "0.1.0"\n\n[dependencies]\nthing = { version = "9" }\n');
  await writeFile(join(dir, 'src-tauri/Cargo.lock'), 'version = 4\n\n[[package]]\nname = "test"\nversion = "0.1.0"\n\n[[package]]\nname = "dependency"\nversion = "9.0.0"\n');
  expect(await syncVersion(dir)).toBe('1.2.3-beta.2');
  const cargoLock = await readFile(join(dir, 'src-tauri/Cargo.lock'), 'utf8');
  expect(cargoLock).toContain('version = "1.2.3-beta.2"');
  expect(cargoLock).toContain('version = "9.0.0"');
  expect(await readFile(cargo, 'utf8')).toContain('version = "1.2.3-beta.2"');
  expect(await readFile(cargo, 'utf8')).toContain('thing = { version = "9" }');
  const lock = JSON.parse(await readFile(join(dir, 'package-lock.json'), 'utf8'));
  expect(lock.version).toBe('1.2.3-beta.2'); expect(lock.packages[''].version).toBe(lock.version); expect(lock.packages['node_modules/example'].version).toBe('5.0.0');
  const before = (await stat(cargo)).mtimeMs; await syncVersion(dir); expect((await stat(cargo)).mtimeMs).toBe(before);
});
it('rejects invalid versions before changing any generated version', async () => {
  const dir = await root();
  for (const version of ['../../outside', '01.2.3', '1.2', '1.2.3-01', 'latest']) {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ version }));
    await expect(syncVersion(dir)).rejects.toThrow('SemVer');
  }
});
const fixture = async () => {
  const dir = await root(); const bundles = join(dir, 'cargo/bundle');
  await mkdir(join(bundles, 'macos/MinMD.app/Contents/MacOS'), { recursive: true });
  await writeFile(join(bundles, 'macos/MinMD.app/Contents/MacOS/minmd'), 'executable', { mode: 0o755 });
  if (process.platform !== 'win32') await symlink('minmd', join(bundles, 'macos/MinMD.app/Contents/MacOS/link'));
  await mkdir(join(bundles, 'dmg')); await writeFile(join(bundles, 'dmg/MinMD_1.2.3.dmg'), 'installer');
  return { dir, bundles };
};
it('exports apps and installers under the version and target with a manifest and portable archive', async () => {
  const { dir, bundles } = await fixture();
  const destination = await exportBundles({ root: dir, bundleDirectory: bundles, version: '1.2.3', target: 'aarch64-apple-darwin', zipApp: async (_app: string, archive: string) => writeFile(archive, 'zip') });
  expect(destination).toBe(join(dir, 'build/1.2.3/aarch64-apple-darwin'));
  expect(await readFile(join(destination, 'MinMD_1.2.3.dmg'), 'utf8')).toBe('installer');
  if (process.platform !== 'win32') {
    expect(await readlink(join(destination, 'MinMD.app/Contents/MacOS/link'))).toBe('minmd');
    expect((await stat(join(destination, 'MinMD.app/Contents/MacOS/minmd'))).mode & 0o111).not.toBe(0);
  }
  const manifest = JSON.parse(await readFile(join(destination, 'build-info.json'), 'utf8'));
  expect(manifest.version).toBe('1.2.3'); expect(manifest.profile).toBe('release');
  expect(manifest.files).toContain('MinMD_1.2.3_aarch64-apple-darwin.zip');
});
it('preserves the last successful export when archiving fails, and isolates debug and other versions', async () => {
  const { dir, bundles } = await fixture();
  const options = { root: dir, bundleDirectory: bundles, version: '1.2.3', target: 'aarch64-apple-darwin' };
  const destination = await exportBundles(options); await writeFile(join(destination, 'old-marker'), 'keep');
  await expect(exportBundles({ ...options, zipApp: async () => { throw new Error('zip failed'); } })).rejects.toThrow('zip failed');
  expect(await readFile(join(destination, 'old-marker'), 'utf8')).toBe('keep');
  await exportBundles({ ...options, debug: true }); await exportBundles({ ...options, version: '1.2.4' });
  expect(await readFile(join(destination, 'old-marker'), 'utf8')).toBe('keep');
  await exportBundles(options); await expect(stat(join(destination, 'old-marker'))).rejects.toThrow();
});
it('refuses an empty bundle instead of reporting successful packaging', async () => {
  const dir = await root(); const empty = join(dir, 'bundle'); await mkdir(empty);
  await expect(exportBundles({ root: dir, bundleDirectory: empty, version: '1.0.0', target: 'test' })).rejects.toThrow('未生成可分发产物');
  await expect(stat(join(dir, 'build'))).rejects.toThrow();
});
it('keeps desktop commands and frontend hooks separate so Tauri never invokes itself recursively', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8')); const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
  expect(pkg.scripts.dev).toBe('node scripts/desktop.mjs dev'); expect(pkg.scripts.build).toBe('node scripts/desktop.mjs build');
  expect(config.version).toBe('../package.json'); expect(config.build.beforeDevCommand).toBe('npm run dev:web'); expect(config.build.beforeBuildCommand).toBe('npm run build:web');
  expect(pkg.scripts['dev:web']).toContain('vite --host'); expect(pkg.scripts['build:web']).toContain('tsc -b && vite build');
});
