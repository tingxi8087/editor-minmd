// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App as InkApp, ConfigProvider } from "paper-ink";
import { Workspace } from "../src/App";
import { WorkspaceModel } from "../src/workspace/model";
import type { FileGateway, DirectoryEntry } from "../src/lib/files";

const platform = vi.hoisted(() => ({
  menu: null as null | ((event: { payload: string }) => void),
  close: null as null | ((event: { preventDefault: () => void }) => void),
  destroy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/lib/files', async (original) => ({ ...(await original<typeof import('../src/lib/files')>()), desktopAvailable: true }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (_event, callback) => { platform.menu = callback; return () => { platform.menu = null; }; }) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({
  setTitle: vi.fn().mockResolvedValue(undefined), destroy: platform.destroy,
  onCloseRequested: vi.fn(async (callback) => { platform.close = callback; return () => { platform.close = null; }; }),
}) }));

const entry = (path: string, isDirectory = false, isMarkdown = !isDirectory): DirectoryEntry => ({ path, name: path.split('/').pop()!, isDirectory, isMarkdown, isSymlink: false });
const fixture = () => {
  const gateway = {
    openDocument: vi.fn<FileGateway['openDocument']>().mockResolvedValue(null),
    saveDocument: vi.fn<FileGateway['saveDocument']>().mockImplementation(async (path, content) => ({ path: path ?? '/notes/new.md', name: path?.split('/').pop() ?? 'new.md', content })),
    releaseDocument: vi.fn<FileGateway['releaseDocument']>().mockResolvedValue(undefined),
    openDirectory: vi.fn<FileGateway['openDirectory']>().mockResolvedValue({ path: '/notes', name: 'notes', entries: [entry('/notes/docs', true), entry('/notes/A.md'), entry('/notes/a.txt', false, false)] }),
    listDirectory: vi.fn<FileGateway['listDirectory']>().mockResolvedValue([entry('/notes/docs/B.md')]),
    readWorkspaceDocument: vi.fn<FileGateway['readWorkspaceDocument']>().mockImplementation(async (_, path) => ({ path, name: path.split('/').pop()!, content: `# ${path.endsWith('A.md') ? 'Alpha' : 'Beta'}\n\n正文` })),
    closeDirectory: vi.fn<FileGateway['closeDirectory']>().mockResolvedValue(undefined),
  };
  const model = new WorkspaceModel(gateway);
  model.addGuide('# 使用指南\n\n欢迎');
  render(<ConfigProvider><InkApp><Workspace workspace={model} /></InkApp></ConfigProvider>);
  return { model, gateway, user: userEvent.setup() };
};
const mounted: WorkspaceModel[] = [];
const setup = () => { const value = fixture(); mounted.push(value.model); return value; };
const edit = (model: WorkspaceModel, text: string) => act(() => { const editor = model.active!.editor!; editor.commands.insertContentAt(editor.state.doc.content.size - 1, text); });
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  platform.destroy.mockClear();
});
afterEach(() => { cleanup(); mounted.forEach((model) => model.dispose()); mounted.length = 0; });

describe('workspace UI integration', () => {
  it('opens a root, lazily expands children, opens multiple tabs and preserves edits when switching', async () => {
    const { model, gateway, user } = setup();
    await user.click(screen.getAllByRole('button', { name: '打开目录' })[0]);
    const tree = await screen.findByRole('tree', { name: '文件树' });
    expect(gateway.listDirectory).not.toHaveBeenCalled();
    expect(within(tree).getByRole('button', { name: 'a.txt' }).hasAttribute('disabled')).toBe(true);
    await user.click(within(tree).getByRole('button', { name: 'A.md' }));
    expect(screen.getByRole('tabpanel').textContent).toContain('Alpha'); edit(model, '只属于A');
    await user.click(within(tree).getByRole('button', { name: 'docs' }));
    await user.click(await within(tree).findByRole('button', { name: 'B.md' }));
    expect(gateway.listDirectory).toHaveBeenCalledWith('/notes', '/notes/docs');
    expect(screen.getByRole('tabpanel').textContent).toContain('Beta');
    await user.click(screen.getByRole('tab', { name: /A.md/ }));
    expect(screen.getByRole('tabpanel').textContent).toContain('只属于A');
    expect(model.tabs).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(model.active!.dirty).toBe(false));
    expect(gateway.saveDocument.mock.calls[0][1]).toContain('只属于A');
    await user.click(screen.getByRole('button', { name: '关闭目录' }));
    expect(screen.queryByRole('tree')).toBeNull(); expect(screen.getAllByRole('tab')).toHaveLength(3);
  });
  it('prompts for the exact background tab being closed; cancellation keeps both documents', async () => {
    const { model, user } = setup();
    await user.click(screen.getByRole('button', { name: '新建' })); edit(model, 'dirty A'); const a = model.active!;
    await user.click(screen.getByRole('button', { name: '新建' }));
    await user.click(screen.getByRole('button', { name: `关闭 ${a.name}` }));
    const dialog = await screen.findByRole('dialog'); expect(dialog.textContent).toContain(a.name); expect(model.active).toBe(a);
    await user.click(within(dialog).getByRole('button', { name: '继续编辑' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(model.tabs).toHaveLength(3); expect(a.dirty).toBe(true);
    await user.click(screen.getByRole('button', { name: `关闭 ${a.name}` }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '不保存' }));
    await waitFor(() => expect(model.tabs.some((tab) => tab.id === a.id)).toBe(false));
  });
  it('keeps a dirty tab open on cancelled native save, then saves and closes successfully', async () => {
    const { model, gateway, user } = setup();
    await user.click(screen.getByRole('button', { name: '新建' })); edit(model, 'draft'); const tab = model.active!;
    await user.click(screen.getByRole('button', { name: `关闭 ${tab.name}` }));
    gateway.saveDocument.mockResolvedValueOnce(null);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '保存并继续' }));
    expect(screen.getByRole('dialog')).toBeTruthy(); expect(tab.dirty).toBe(true);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '保存并继续' }));
    await waitFor(() => expect(model.tabs.some((item) => item.id === tab.id)).toBe(false));
    expect(gateway.saveDocument.mock.calls[1][1]).toContain('draft');
  });
  it('native window close considers every dirty tab, with sequential confirmation', async () => {
    const { model, user } = setup();
    await user.click(screen.getByRole('button', { name: '新建' })); edit(model, 'A');
    await user.click(screen.getByRole('button', { name: '新建' })); edit(model, 'B');
    const preventDefault = vi.fn(); act(() => platform.close!({ preventDefault }));
    expect(preventDefault).toHaveBeenCalledOnce(); expect(screen.getByRole('dialog').textContent).toContain('2 份');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '不保存' }));
    expect(platform.destroy).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '不保存' }));
    await waitFor(() => expect(platform.destroy).toHaveBeenCalledOnce());
  });
  it('native menu close-tab closes only the active tab and does not close the window', async () => {
    const { model, user } = setup();
    await user.click(screen.getByRole('button', { name: '新建' }));
    act(() => platform.menu!({ payload: 'close-tab' }));
    await waitFor(() => expect(model.tabs).toHaveLength(1)); expect(platform.destroy).not.toHaveBeenCalled();
  });
  it('switching reading mode or selecting a duplicate file never dirties clean tabs', async () => {
    const { model, gateway, user } = setup(); gateway.openDocument.mockResolvedValue({ path: '/outside/A.md', name: 'A.md', content: '# outside' });
    await user.click(screen.getByRole('button', { name: '打开文件' }));
    await user.click(screen.getByRole('button', { name: '阅读' })); expect(model.active!.editor!.isEditable).toBe(false);
    await user.click(screen.getByRole('button', { name: '文档' })); expect(model.active!.editor!.isEditable).toBe(true);
    await user.click(screen.getByRole('button', { name: '打开文件' })); expect(model.tabs).toHaveLength(2); expect(model.hasDirty).toBe(false);
  });
  it('all closed tabs leave a working empty state, and a new document can still be created', async () => {
    const { model, user } = setup(); await user.click(screen.getByRole('button', { name: '关闭 使用指南' }));
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    await user.click(within(screen.getByRole('main')).getByRole('button', { name: '新建文档' }));
    expect(model.tabs).toHaveLength(1); expect(model.active!.editor).not.toBeNull();
  });
});
