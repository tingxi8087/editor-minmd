import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

// package.json is the only version source; generated copies are written only on change.
export async function syncVersion(root = projectRoot) {
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  if (typeof pkg.version !== 'string' || !semver.test(pkg.version)) throw new Error('package.json.version 必须是有效的 SemVer 版本号，如 0.2.0 或 0.2.0-beta.1');
  const cargoPath = resolve(root, 'src-tauri/Cargo.toml');
  const cargo = await readFile(cargoPath, 'utf8');
  const packageSection = /(^\[package\]\s*\n)([\s\S]*?)(?=^\[|$(?![\s\S]))/m;
  const section = cargo.match(packageSection);
  if (!section || !/^version[ \t]*=[ \t]*"[^"]+"[ \t]*$/m.test(section[2])) throw new Error('Cargo.toml 缺少 [package].version');
  const updated = cargo.replace(packageSection, (_, header, body) => header + body.replace(/^version[ \t]*=[ \t]*"[^"]+"[ \t]*$/m, `version = "${pkg.version}"`));
  if (updated !== cargo) await writeFile(cargoPath, updated);
  const lockPath = resolve(root, 'package-lock.json');
  const raw = await readFile(lockPath, 'utf8');
  const lock = JSON.parse(raw);
  if (lock.version !== pkg.version || (lock.packages?.[''] && lock.packages[''].version !== pkg.version)) {
    lock.version = pkg.version;
    if (lock.packages?.['']) lock.packages[''].version = pkg.version;
    await writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');
  }
  const name = section[2].match(/^name[ \t]*=[ \t]*"([^"]+)"/m)?.[1];
  const cargoLockPath = resolve(root, 'src-tauri/Cargo.lock');
  let cargoLock;
  try { cargoLock = await readFile(cargoLockPath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (cargoLock && name) {
    const nextLock = cargoLock.split(/(?=^\[\[package\]\]$)/m).map(block => {
      if (block.match(/^name = "([^"]+)"/m)?.[1] !== name) return block;
      return block.replace(/^version = "[^"]+"/m, `version = "${pkg.version}"`);
    }).join('');
    if (nextLock !== cargoLock) await writeFile(cargoLockPath, nextLock);
  }
  return pkg.version;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await syncVersion();
}
