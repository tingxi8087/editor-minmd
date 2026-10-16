// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Settings from '../src/components/Settings';
import { associationExtensions, type AssociationGateway } from '../src/lib/associations';
import { App, ConfigProvider } from 'paper-ink';
const setup = (supported = true) => {
  const gateway: AssociationGateway = { supported: vi.fn().mockResolvedValue(supported), apply: vi.fn().mockResolvedValue([{ extension: 'md', contentType: 'net.daringfireball.markdown', success: true, message: '已设为默认' }]) };
  const close = vi.fn();
  render(<ConfigProvider><App><Settings gateway={gateway} onClose={close} /></App></ConfigProvider>);
  return { gateway, close, user: userEvent.setup() };
};
beforeEach(() => localStorage.clear()); afterEach(cleanup);
it('starts fully selected and changes no system association until the action is clicked', async () => {
  const { gateway, user } = setup();
  await waitFor(() => expect((screen.getByRole('button', { name: '设为默认打开应用' }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.getByText(`已选择 ${associationExtensions.length} 种扩展名`)).toBeTruthy();
  expect(gateway.apply).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '设为默认打开应用' }));
  expect(gateway.apply).toHaveBeenCalledWith(associationExtensions);
  expect(await screen.findByText('已设为默认')).toBeTruthy();
});
it('supports empty selection, individual extensions, mixed groups and persistence', async () => {
  const { user } = setup(); await waitFor(() => expect((screen.getByRole('button', { name: '取消全选' }) as HTMLButtonElement).disabled).toBe(false));
  await user.click(screen.getByRole('button', { name: '取消全选' }));
  expect((screen.getByRole('button', { name: '设为默认打开应用' }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole('checkbox', { name: '.md' }));
  expect((screen.getByRole('checkbox', { name: /Markdown/ }) as HTMLInputElement).indeterminate).toBe(true);
  cleanup(); setup();
  expect((screen.getByRole('checkbox', { name: '.md' }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole('checkbox', { name: '.markdown' }) as HTMLInputElement).checked).toBe(false);
  expect(screen.getByText('已选择 1 种扩展名')).toBeTruthy();
});
it('group selection and select-all work, and close remains explicit', async () => {
  const { user, close } = setup(); await waitFor(() => expect((screen.getByRole('button', { name: '取消全选' }) as HTMLButtonElement).disabled).toBe(false));
  await user.click(screen.getByRole('checkbox', { name: /Markdown/ }));
  expect((screen.getByRole('checkbox', { name: '.md' }) as HTMLInputElement).checked).toBe(false);
  await user.click(screen.getByRole('button', { name: '全选' }));
  expect((screen.getByRole('checkbox', { name: '.md' }) as HTMLInputElement).checked).toBe(true);
  const dialog = screen.getByRole('dialog'); await user.click(dialog.parentElement!); expect(close).not.toHaveBeenCalled();
  await user.click(within(dialog).getAllByRole('button', { name: '关闭' }).at(-1)!); expect(close).toHaveBeenCalledOnce();
});
it('locks selection and closing while applying and reports failures per extension', async () => {
  const { gateway, user, close } = setup(); let done!: (rows: Awaited<ReturnType<AssociationGateway['apply']>>) => void;
  vi.mocked(gateway.apply).mockImplementation(() => new Promise(resolve => { done = resolve; }));
  await waitFor(() => expect((screen.getByRole('button', { name: '设为默认打开应用' }) as HTMLButtonElement).disabled).toBe(false));
  await user.click(screen.getByRole('button', { name: '设为默认打开应用' }));
  expect((screen.getByRole('button', { name: '取消全选' }) as HTMLButtonElement).disabled).toBe(true);
  await user.keyboard('{Escape}'); expect(close).not.toHaveBeenCalled();
  done([{ extension: 'md', contentType: null, success: false, message: '需要在系统中确认' }]);
  expect(await screen.findByText('需要在系统中确认')).toBeTruthy();
  expect(screen.getByText('0/1 项已设为默认')).toBeTruthy();
});
it('reports native errors and unsupported systems without claiming success', async () => {
  const { gateway, user } = setup(); vi.mocked(gateway.apply).mockRejectedValue('请从 editor-minmd.app 中设置');
  await waitFor(() => expect((screen.getByRole('button', { name: '设为默认打开应用' }) as HTMLButtonElement).disabled).toBe(false));
  await user.click(screen.getByRole('button', { name: '设为默认打开应用' }));
  expect((await screen.findByRole('alert')).textContent).toContain('editor-minmd.app');
  cleanup(); setup(false); expect(await screen.findByText('目前仅支持 macOS 桌面应用。')).toBeTruthy();
  expect((screen.getByRole('button', { name: '设为默认打开应用' }) as HTMLButtonElement).disabled).toBe(true);
});
it('preserves an explicitly empty selection when reopening', () => {
  localStorage.setItem('minmd-file-associations-v1', '[]'); setup(); expect(screen.getByText('已选择 0 种扩展名')).toBeTruthy();
});
it('keeps the UI, native whitelist and bundle declarations aligned without claiming video types', async () => {
  const { readFileSync } = await import('node:fs');
  const config = JSON.parse(readFileSync('src-tauri/tauri.macos.conf.json', 'utf8'));
  const native = readFileSync('src-tauri/src/associations.rs', 'utf8');
  const section = native.slice(native.indexOf('pub const EXTENSIONS'), native.indexOf('#[derive(Default)]'));
  const extensions = [...section.matchAll(/"([a-z]+)"/g)].map(match => match[1]);
  expect([...extensions].sort()).toEqual([...associationExtensions].sort());
  const claims = config.bundle.fileAssociations;
  expect(claims.flatMap((row: { ext: string[] }) => row.ext).sort()).toEqual(associationExtensions.filter(ext => ext !== 'ts').sort());
  expect(claims.every((row: { contentTypes?: string[]; exportedType?: unknown }) => row.contentTypes?.length || row.exportedType)).toBe(true);
});

it('shows About without association actions and keeps selections when switching tabs', async () => {
  const { user, gateway } = setup();
  await user.click(screen.getByRole('tab', { name: '关于' }));
  const manifest = await import('../package.json');
  expect(screen.getByText(manifest.version)).toBeTruthy();
  expect(screen.getByText('MIT')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '设为默认打开应用' })).toBeNull();
  expect(gateway.apply).not.toHaveBeenCalled();
  await user.click(screen.getByRole('tab', { name: '默认打开方式' }));
  await user.click(screen.getByRole('button', { name: '取消全选' }));
  await user.click(screen.getByRole('tab', { name: '关于' }));
  await user.click(screen.getByRole('tab', { name: '默认打开方式' }));
  expect(screen.getByText('已选择 0 种扩展名')).toBeTruthy();
});

it('treats the browser preview as unsupported without invoking a native bridge', async () => {
  const { associations } = await import('../src/lib/associations');
  await expect(associations.supported()).resolves.toBe(false);
});
