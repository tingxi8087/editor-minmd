import { spawn, execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { syncVersion, projectRoot } from './version.mjs';
import { exportBundles } from './artifacts.mjs';

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: projectRoot, stdio: 'inherit', ...options });
    const interrupt = () => child.kill('SIGINT');
    const terminate = () => child.kill('SIGTERM');
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    child.once('error', error => { dispose(); reject(error); });
    child.once('close', (code, signal) => { dispose(); code === 0 ? resolve() : reject(Object.assign(new Error(`${command} ${args[0] ?? ''} ${signal ? `被 ${signal} 中断` : `失败（${code}）`}`), { exitCode: signal ? 130 : code || 1 })); });
    function dispose() { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); }
  });
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (!['dev', 'build'].includes(command)) throw new Error('桌面入口仅支持 dev 或 build');
  const version = await syncVersion();
  const cli = join(projectRoot, 'node_modules/@tauri-apps/cli/tauri.js');
  if (command === 'dev') {
    await run(process.execPath, [cli, 'dev', ...args, '--config', JSON.stringify({ version })]);
  } else {
    if (args.includes('--no-bundle')) throw new Error('npm run build 需要生成分发包；仅构建网页请使用 npm run build:web');
    const targetIndex = args.findIndex(arg => arg === '--target' || arg === '-t');
    const suppliedTarget = args.find(arg => arg.startsWith('--target='))?.slice('--target='.length) ?? (targetIndex >= 0 ? args[targetIndex + 1] : undefined);
    const host = execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/^host: (.+)$/m)?.[1];
    const target = suppliedTarget ?? host;
    if (!target || !/^[a-zA-Z0-9_-]+$/.test(target)) throw new Error('无法识别有效的 Rust 目标平台');
    const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--no-deps', '--format-version=1', '--manifest-path', join(projectRoot, 'src-tauri/Cargo.toml')], { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
    const debug = args.includes('--debug') || args.includes('-d');
    const bundleDirectory = join(metadata.target_directory, ...(suppliedTarget ? [target] : []), debug ? 'debug' : 'release', 'bundle');
    // Remove only Cargo's generated bundle cache, so no stale installer enters this export.
    await rm(bundleDirectory, { recursive: true, force: true });
    await run(process.execPath, [cli, 'build', ...args, '--config', JSON.stringify({ version })]);
    const destination = await exportBundles({ root: projectRoot, bundleDirectory, version, target, debug,
      zipApp: process.platform === 'darwin' ? (source, archive) => run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', source, archive]) : undefined,
    });
    console.log(`\nMinMD ${version} 桌面产物：${destination}`);
  }
} catch (error) {
  console.error(`\n${error.message}`);
  process.exitCode = error.exitCode ?? 1;
}
