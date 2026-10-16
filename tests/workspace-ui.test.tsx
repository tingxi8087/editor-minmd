// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App as InkApp, ConfigProvider } from "paper-ink";
import type { WorkspaceSessionGateway } from "../src/lib/workspaceSession";
import { RecentModel, type RecentGateway } from "../src/lib/recents";
import { Workspace } from "../src/App";
import { BackgroundModel, type BackgroundGateway } from "../src/lib/background";
import { WorkspaceModel } from "../src/workspace/model";
import type { Draft, ReliabilityGateway } from "../src/lib/reliability";
import type { FileGateway, DirectoryEntry } from "../src/lib/files";

// jsdom has no layout; ProseMirror uses these Range methods when restoring a selection.
class TestResizeObserver { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal('ResizeObserver', TestResizeObserver);
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
const platform = vi.hoisted(() => ({
  menu: null as null | ((event: { payload: string }) => void),
  drop: null as null | ((event: { payload: { type: string; position: { x: number; y: number }; paths: string[] } }) => void),
  close: null as null | ((event: { preventDefault: () => void }) => void),
  destroy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/lib/files', async (original) => ({ ...(await original<typeof import('../src/lib/files')>()), desktopAvailable: true }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (_event, callback) => { platform.menu = callback; return () => { platform.menu = null; }; }) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({
  onDragDropEvent: vi.fn(async callback => { platform.drop = callback; return () => { platform.drop = null; }; }),
  setTitle: vi.fn().mockResolvedValue(undefined), destroy: platform.destroy,
  onCloseRequested: vi.fn(async (callback) => { platform.close = callback; return () => { platform.close = null; }; }),
}) }));

const entry = (path: string, isDirectory = false, isMarkdown = !isDirectory): DirectoryEntry => ({ path, name: path.split('/').pop()!, isDirectory, isMarkdown, isSymlink: false });
const fixture = (recent?: RecentModel, session?: WorkspaceSessionGateway) => {
  const gateway = {
    loadImage: vi.fn<FileGateway['loadImage']>().mockResolvedValue('data:image/png;base64,iVBORw0KGgo='),
    importImage: vi.fn<FileGateway['importImage']>().mockResolvedValue({ reference: 'assets/image.png', name: '粘贴图片' }),
    openLink: vi.fn<FileGateway['openLink']>().mockResolvedValue(null),
    openDocument: vi.fn<FileGateway['openDocument']>().mockResolvedValue(null),
    saveDocument: vi.fn<FileGateway['saveDocument']>().mockImplementation(async (path, content) => ({ path: path ?? '/notes/new.md', name: path?.split('/').pop() ?? 'new.md', content })),
    releaseDocument: vi.fn<FileGateway['releaseDocument']>().mockResolvedValue(undefined),
    openDirectory: vi.fn<FileGateway['openDirectory']>().mockResolvedValue({ path: '/notes', name: 'notes', entries: [entry('/notes/docs', true), entry('/notes/A.md'), entry('/notes/a.txt', false, false)] }),
    listDirectory: vi.fn<FileGateway['listDirectory']>().mockResolvedValue([entry('/notes/docs/B.md')]),
    readWorkspaceDocument: vi.fn<FileGateway['readWorkspaceDocument']>().mockImplementation(async (_, path) => ({ path, name: path.split('/').pop()!, content: `# ${path.endsWith('A.md') ? 'Alpha' : 'Beta'}\n\n正文` })),
    createEntry: vi.fn().mockResolvedValue("/notes/new.md"),
    renameEntry: vi.fn().mockResolvedValue("/notes/renamed.md"),
    trashEntry: vi.fn().mockResolvedValue(undefined),
    closeDirectory: vi.fn<FileGateway['closeDirectory']>().mockResolvedValue(undefined),
  };
  const storage = {
    loadDrafts: vi.fn<ReliabilityGateway['loadDrafts']>().mockResolvedValue([]),
    writeDrafts: vi.fn<ReliabilityGateway['writeDrafts']>().mockResolvedValue(undefined),
    authorizeDraft: vi.fn<ReliabilityGateway['authorizeDraft']>().mockResolvedValue(null),
    checkDocuments: vi.fn<ReliabilityGateway['checkDocuments']>().mockResolvedValue([]),
    watchDocuments: vi.fn<ReliabilityGateway['watchDocuments']>().mockResolvedValue(undefined),
    onDiskChange: vi.fn<ReliabilityGateway['onDiskChange']>().mockResolvedValue(() => {}),
  };
  const model = new WorkspaceModel(gateway, storage, recent, session);
  model.addGuide('# 使用指南\n\n欢迎');
  const backgroundGateway = {
    load: vi.fn<BackgroundGateway['load']>().mockResolvedValue({ image: null, blur: 6, mask: 30 }),
    choose: vi.fn<BackgroundGateway['choose']>().mockResolvedValue(null),
    options: vi.fn<BackgroundGateway['options']>().mockResolvedValue(undefined),
    reset: vi.fn<BackgroundGateway['reset']>().mockResolvedValue({ image: null, blur: 6, mask: 30 }),
  };
  const background = new BackgroundModel(backgroundGateway);
  render(<ConfigProvider><InkApp><Workspace workspace={model} background={background} /></InkApp></ConfigProvider>);
  return { model, gateway, storage, background, backgroundGateway, user: userEvent.setup() };
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
  it('switches Markdown modes with Command 1/2/3 while protecting dialogs and ordinary text', async () => {
    const { model, user } = setup();
    act(() => { model.openFile({ path: '/notes/modes.md', name: 'modes.md', content: '# 标题\n\n正文\n' }); });
    const raw = model.markdown(model.active!);
    await waitFor(() => expect((screen.getByRole('button', { name: '查找文档' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.keyDown(window, { key: '2', metaKey: true });
    expect(model.active!.reading).toBe(true); expect(model.active!.editor!.isEditable).toBe(false);
    fireEvent.keyDown(window, { key: '3', metaKey: true });
    expect(model.active!.mode).toBe('source');
    fireEvent.keyDown(window, { key: '1', metaKey: true });
    expect(model.active!.mode).toBe('document'); expect(model.active!.reading).toBe(false); expect(model.active!.editor!.isEditable).toBe(true);
    expect(model.markdown(model.active!)).toBe(raw); expect(model.active!.dirty).toBe(false);
    await user.click(screen.getByRole('button', { name: '设置' }));
    fireEvent.keyDown(window, { key: '3', metaKey: true }); expect(model.active!.mode).toBe('document');
    await user.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: '关闭' }).at(-1)!);
    await user.click(screen.getByRole('button', { name: '新建文本' }));
    fireEvent.keyDown(window, { key: '1', metaKey: true }); expect(model.active!.mode).toBe('source');
  });
  it('finds across formatting and replaces through the real document bar, while reading mode remains read-only', async () => {
    const { model, user } = setup();
    act(() => { model.openFile({ path: '/notes/find.md', name: 'find.md', content: '# 查找\n\n你**好**，你好\n' }); });
    const raw = model.markdown(model.active!);
    await waitFor(() => expect((screen.getByRole('button', { name: '查找文档' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.keyDown(model.active!.editor!.view.dom, { key: 'f', metaKey: true });
    await user.type(screen.getByRole('textbox', { name: '查找内容' }), '你好');
    expect(screen.getByRole('region', { name: '文档查找' }).textContent).toContain('1 / 2');
    expect(document.querySelectorAll('.document-search-match')).toHaveLength(3);
    expect(model.markdown(model.active!)).toBe(raw); expect(model.active!.dirty).toBe(false);
    await user.click(screen.getByRole('button', { name: '展开替换' }));
    await user.type(screen.getByRole('textbox', { name: '替换内容' }), '完成');
    await user.click(screen.getByRole('button', { name: '全部替换' }));
    expect(model.markdown(model.active!)).toContain('完成'); expect(model.active!.dirty).toBe(true);
    act(() => { model.active!.editor!.commands.undo(); });
    expect(model.markdown(model.active!)).toBe(raw); expect(model.active!.dirty).toBe(false);
    fireEvent.keyDown(window, { key: '2', metaKey: true });
    expect(screen.queryByRole('textbox', { name: '替换内容' })).toBeNull(); expect(screen.queryByRole('button', { name: '展开替换' })).toBeNull();
    expect(screen.getByRole('textbox', { name: '查找内容' })).toBeTruthy();
    expect(model.active!.editor!.isEditable).toBe(false);
    fireEvent.keyDown(screen.getByRole('textbox', { name: '查找内容' }), { key: 'Escape' });
    expect(screen.queryByRole('region', { name: '文档查找' })).toBeNull(); expect(document.querySelector('.document-search-match')).toBeNull();
    expect(model.active!.dirty).toBe(false);
    fireEvent.keyDown(window, { key: '3', metaKey: true });
    fireEvent.keyDown(screen.getByRole('textbox', { name: '源码编辑器' }), { key: 'f', metaKey: true });
    expect(document.querySelector('.cm-search')).toBeTruthy();
  });
  it('cleans up document search on tab changes and keeps unsupported Markdown in source mode', async () => {
    const { model, user } = setup();
    act(() => { model.openFile({ path: '/notes/a.md', name: 'a.md', content: 'Alpha Alpha\n' }); });
    await user.click(screen.getByRole('button', { name: '查找文档' }));
    await user.type(screen.getByRole('textbox', { name: '查找内容' }), 'Alpha');
    const a = model.active!;
    expect(document.querySelector('.document-search-match')).toBeTruthy();
    act(() => { model.openFile({ path: '/notes/b.md', name: 'b.md', content: 'Beta\n' }); });
    expect(screen.queryByRole('textbox', { name: '查找内容' })).toBeNull();
    expect(a.editor!.view.dom.querySelector('.document-search-match')).toBeNull(); expect(a.dirty).toBe(false);
    act(() => { model.openFile({ path: '/notes/raw.md', name: 'raw.md', content: '<!-- 原样保留 -->\n' }); });
    fireEvent.keyDown(window, { key: '1', metaKey: true }); expect(model.active!.mode).toBe('source');
    fireEvent.keyDown(window, { key: '2', metaKey: true }); expect(model.active!.mode).toBe('source');
    expect(model.markdown(model.active!)).toBe('<!-- 原样保留 -->\n'); expect(model.active!.dirty).toBe(false);
  });
  it('captures Command/Ctrl B for the sidebar without changing bold or document content', async () => {
    const { model, user } = setup();
    await user.click(screen.getByRole('button', { name: '新建 Markdown' }));
    const editor = model.active!.editor!; const before = model.markdown(model.active!);
    const toggle = screen.getByRole('button', { name: '切换侧栏' });
    const initial = toggle.getAttribute('aria-expanded');
    fireEvent.keyDown(editor.view.dom, { key: 'b', metaKey: true });
    expect(toggle.getAttribute('aria-expanded')).not.toBe(initial);
    fireEvent.keyDown(editor.view.dom, { key: 'b', metaKey: true, repeat: true });
    expect(toggle.getAttribute('aria-expanded')).not.toBe(initial);
    expect(editor.isActive('bold')).toBe(false); expect(model.markdown(model.active!)).toBe(before); expect(model.active!.dirty).toBe(false);
    fireEvent.keyDown(editor.view.dom, { key: 'b', metaKey: true });
    expect(toggle.getAttribute('aria-expanded')).toBe(initial);
    await user.click(screen.getByRole('button', { name: '源码' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: '源码编辑器' }), { key: 'b', ctrlKey: true });
    expect(toggle.getAttribute('aria-expanded')).not.toBe(initial);
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(toggle.getAttribute('aria-expanded')).toBe(initial);
    expect(model.markdown(model.active!)).toBe(before); expect(model.active!.dirty).toBe(false);
  });
  it('opens slash date insertion from the real workbench and keeps one-step undo and source sync', async () => {
    const { model, user } = setup(); await user.click(screen.getByRole('button', { name: '新建 Markdown' }));
    const editor = model.active!.editor!;
    act(() => { editor.commands.focus(); editor.view.focus(); editor.commands.insertContent('/date'); });
    await user.click(await screen.findByRole('option', { name: '日期' }));
    const dialog = await screen.findByRole('dialog'); expect(editor.getText()).toBe('/date');
    fireEvent.change(within(dialog).getByLabelText('日期'), { target: { value: '2026-10-16' } });
    await user.click(within(dialog).getByRole('button', { name: '插入' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(editor.getText()).toBe('2026-10-16');
    act(() => { editor.commands.undo(); }); expect(editor.getText()).toBe('/date');
    act(() => { editor.commands.redo(); });
    await user.click(screen.getByRole('button', { name: '源码' }));
    expect(model.active!.source?.text()).toContain('2026-10-16');
  });
  it('routes slash image import through the existing file gateway and leaves cancelled command untouched', async () => {
    const { model, gateway, user } = setup();
    act(() => { model.openFile({ path: '/notes/slash.md', name: 'slash.md', content: '/image' }); });
    const editor = model.active!.editor!;
    act(() => { editor.commands.focus('end'); editor.view.focus(); editor.commands.setTextSelection(7); });
    gateway.importImage.mockResolvedValueOnce(null);
    await user.click(await screen.findByRole('option', { name: '图片' }));
    await waitFor(() => expect(gateway.importImage).toHaveBeenCalledOnce());
    expect(editor.getText()).toBe('/image'); expect(model.active!.dirty).toBe(false);
  });

  it('opens a root, lazily expands children, opens multiple tabs and preserves edits when switching', async () => {
    const { model, gateway, user } = setup();
    await user.click(screen.getAllByRole('button', { name: '打开目录' })[0]);
    const tree = await screen.findByRole('tree', { name: '文件树' });
    expect(gateway.listDirectory).not.toHaveBeenCalled();
    expect(within(tree).getByRole('button', { name: 'a.txt' }).hasAttribute('disabled')).toBe(false);
    await user.click(within(tree).getByRole('button', { name: 'A.md' }));
    expect(screen.getByRole('tabpanel').textContent).toContain('Alpha'); edit(model, '只属于A');
    await user.click(within(tree).getByRole('button', { name: 'docs' }));
    await user.click(await within(tree).findByRole('button', { name: 'B.md' }));
    expect(gateway.listDirectory).toHaveBeenCalledWith('/notes', '/notes/docs');
    expect(screen.getByRole('tabpanel').textContent).toContain('Beta');
    await user.click(screen.getByRole('tab', { name: /A.md/ }));
    expect(screen.getByRole('tabpanel').textContent).toContain('只属于A');
    expect(model.tabs).toHaveLength(3);
    await act(async () => { platform.menu?.({ payload: 'save' }); });
    await waitFor(() => expect(model.active!.dirty).toBe(false));
    expect(gateway.saveDocument.mock.calls[0][1]).toContain('只属于A');
    await user.click(screen.getByRole('button', { name: '关闭目录' }));
    expect(screen.queryByRole('tree')).toBeNull(); expect(screen.getAllByRole('tab')).toHaveLength(3);
  });
  it('prompts for the exact background tab being closed; cancellation keeps both documents', async () => {
    const { model, user } = setup();
    await user.click(screen.getByRole('button', { name: '新建 Markdown' })); edit(model, 'dirty A'); const a = model.active!;
    await user.click(screen.getByRole('button', { name: '新建 Markdown' }));
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
    await user.click(screen.getByRole('button', { name: '新建 Markdown' })); edit(model, 'draft'); const tab = model.active!;
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
    await user.click(screen.getByRole('button', { name: '新建 Markdown' })); edit(model, 'A');
    await user.click(screen.getByRole('button', { name: '新建 Markdown' })); edit(model, 'B');
    const preventDefault = vi.fn(); act(() => platform.close!({ preventDefault }));
    expect(preventDefault).toHaveBeenCalledOnce(); expect(screen.getByRole('dialog').textContent).toContain('2 份');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '不保存' }));
    expect(platform.destroy).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '不保存' }));
    await waitFor(() => expect(platform.destroy).toHaveBeenCalledOnce());
  });
  it('native menu close-tab closes only the active tab and does not close the window', async () => {
    const { model, user } = setup();
    await user.click(screen.getByRole('button', { name: '新建 Markdown' }));
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
  it('inserts, edits, opens and removes a link through the actual toolbar dialog', async () => {
    const { model, gateway, user } = setup();
    act(() => { model.openFile({ path: '/notes/A.md', name: 'A.md', content: '正文' }); model.active!.editor!.commands.setTextSelection(1); });
    await user.click(screen.getByRole('button', { name: '编辑链接' }));
    await user.type(screen.getByRole('textbox', { name: '链接文字' }), '另一页');
    await user.type(screen.getByRole('textbox', { name: '链接地址' }), 'B.md');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '应用' }));
    expect(model.markdown(model.active!)).toContain('[另一页](B.md)');
    act(() => { model.active!.editor!.commands.setTextSelection(2); });
    await user.click(screen.getByRole('button', { name: '编辑链接' }));
    const input = screen.getByRole('textbox', { name: '链接地址' }); await user.clear(input); await user.type(input, 'C.md');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '应用' }));
    expect(model.markdown(model.active!)).toContain('[另一页](C.md)');
    await user.click(screen.getByRole('button', { name: '阅读' }));
    fireEvent.click(screen.getByRole('link', { name: '另一页' }));
    expect(gateway.openLink).toHaveBeenCalledWith('/notes/A.md', 'C.md');
    await user.click(screen.getByRole('button', { name: '文档' }));
    act(() => { model.active!.editor!.commands.setTextSelection(2); });
    await user.click(screen.getByRole('button', { name: '编辑链接' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '移除链接' }));
    expect(model.markdown(model.active!)).not.toContain('](C.md)');
  });
  it('intercepts image clipboard bytes and inserts the imported relative image', async () => {
    const { model, gateway } = setup();
    act(() => { model.openFile({ path: '/notes/A.md', name: 'A.md', content: '正文' }); });
    const file = new File([new Uint8Array([137, 80, 78, 71])], '粘贴.png', { type: 'image/png' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([137, 80, 78, 71]).buffer });
    fireEvent.paste(document.querySelector('.tab-panel:not([hidden]) .tiptap')!, { clipboardData: { files: [file], getData: () => '' } });
    await waitFor(() => expect(gateway.importImage).toHaveBeenCalledWith('/notes/A.md', undefined, [137, 80, 78, 71], '粘贴.png'));
    await waitFor(() => expect(model.markdown(model.active!)).toContain('assets/image.png'));
  });
  it('routes native file drops inside the editor to the active document only', async () => {
    const { model, gateway } = setup();
    act(() => { model.openFile({ path: '/notes/A.md', name: 'A.md', content: '正文' }); });
    const panel = screen.getByRole('tabpanel');
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(new DOMRect(200, 100, 800, 600));
    vi.spyOn(model.active!.editor!.view, 'posAtCoords').mockReturnValue({ pos: 1, inside: 0 });
    await act(async () => { platform.drop!({ payload: { type: 'drop', position: { x: 300, y: 200 }, paths: ['/tmp/drop.png'] } }); });
    expect(gateway.importImage).toHaveBeenCalledWith('/notes/A.md', '/tmp/drop.png', undefined, undefined);
    await act(async () => { platform.drop!({ payload: { type: 'drop', position: { x: 20, y: 20 }, paths: ['/tmp/sidebar.png'] } }); });
    expect(gateway.importImage).toHaveBeenCalledTimes(1);
    act(() => model.setReading(true));
    await act(async () => { platform.drop!({ payload: { type: 'drop', position: { x: 300, y: 200 }, paths: ['/tmp/readonly.png'] } }); });
    expect(gateway.importImage).toHaveBeenCalledTimes(1);
  });
  it('renders an unavailable image placeholder without dirtying or dropping the source', async () => {
    const { model, gateway } = setup(); gateway.loadImage.mockRejectedValue('missing');
    act(() => { model.openFile({ path: '/notes/A.md', name: 'A.md', content: '![丢失的图](missing.png)' }); });
    await screen.findByText('图片不可用 · 丢失的图'); expect(model.active!.dirty).toBe(false);
    expect(model.markdown(model.active!)).toBe('![丢失的图](missing.png)');
  });
  it('offers recovered drafts, restores selected content and retains dirty document protection', async () => {
    const { model, storage, user } = setup();
    const draft: Draft = { id: 'restore-1', name: '未命名恢复.md', path: null, resourceBase: null, raw: '', content: '# 恢复标题\n\n恢复的正文', updatedAt: 100, scrollTop: 0, selection: 2 };
    storage.loadDrafts.mockResolvedValue([draft]); await act(async () => { await model.startReliability(); });
    expect(screen.getByText('发现 1 份未保存的恢复草稿')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '查看草稿' }));
    expect(screen.getByRole('dialog').textContent).toContain('恢复的正文');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '恢复' }));
    await waitFor(() => expect(model.pendingDrafts).toHaveLength(0));
    expect(model.active!.dirty).toBe(true); expect(model.markdown(model.active!)).toContain('恢复的正文');
    expect(screen.getByRole('tabpanel').textContent).toContain('恢复标题');
    expect(model.active!.editor!.isEditable).toBe(true);
    await user.click(screen.getByRole('button', { name: '关闭 未命名恢复.md' })); expect(screen.getByRole('dialog').textContent).toContain('保存这页的修改');
  });
  it('requires a separate discard confirmation and cancellation keeps the recovery record', async () => {
    const { model, storage, user } = setup();
    storage.loadDrafts.mockResolvedValue([{ id: 'discard-1', name: '保留草稿.md', path: null, resourceBase: null, raw: '', content: '待恢复', updatedAt: 100, scrollTop: 0, selection: 1 }]);
    await act(async () => { await model.startReliability(); }); await user.click(screen.getByRole('button', { name: '查看草稿' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '丢弃' }));
    expect(model.pendingDrafts).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: '保留草稿' })); expect(model.pendingDrafts).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: '丢弃' })); await user.click(screen.getByRole('button', { name: '确认丢弃' }));
    await waitFor(() => expect(model.pendingDrafts).toHaveLength(0));
  });
  it('shows local versus disk content and only reloads after explicit confirmation', async () => {
    const { model, storage, user } = setup(); await act(async () => { await model.startReliability(); model.openFile({ path: '/notes/A.md', name: 'A.md', content: '# Original' }); });
    edit(model, '本地编辑');
    storage.checkDocuments.mockResolvedValue([{ path: '/notes/A.md', kind: 'present', content: '# 外部版本' }]);
    await act(async () => { await model.checkDisk(); });
    await user.click(screen.getByRole('button', { name: '对比内容' }));
    const dialog = screen.getByRole('dialog'); expect(dialog.textContent).toContain('本地编辑'); expect(dialog.textContent).toContain('外部版本');
    await user.click(within(dialog).getByRole('button', { name: '继续保留本地修改' }));
    await user.click(screen.getByRole('button', { name: '重新载入' })); await user.click(screen.getByRole('button', { name: '保留本地修改' }));
    expect(model.active!.dirty).toBe(true);
    await user.click(screen.getByRole('button', { name: '重新载入' }));
    storage.checkDocuments.mockResolvedValue([{ path: '/notes/A.md', kind: 'present', content: '# 确认时的最新版本' }]);
    await user.click(screen.getByRole('button', { name: '放弃本地修改并载入' }));
    await waitFor(() => expect(model.active!.dirty).toBe(false)); expect(model.active!.raw).toBe('# 确认时的最新版本');
    expect(screen.getByRole('tabpanel').textContent).toContain('确认时的最新版本');
  });
  it('surfaces failed draft writes and retries without losing local content', async () => {
    const { model, storage, user } = setup(); await act(async () => { await model.startReliability(); model.create(); }); edit(model, '不能丢失');
    storage.writeDrafts.mockRejectedValueOnce('空间不足'); await act(async () => { await model.flushDrafts(); });
    expect(screen.getByRole('alert').textContent).toContain('空间不足'); expect(model.markdown(model.active!)).toContain('不能丢失');
    await user.click(screen.getByRole('button', { name: '重试草稿保护' }));
    await waitFor(() => expect(model.recoveryError).toBe(''));
  });
  it('switches Markdown between editable CodeMirror source and document without losing edits', async () => {
    const { model, user, gateway } = setup();
    act(() => { model.openFile({ path: '/notes/A.md', name: 'A.md', content: '# Title\n\n正文\n' }); });
    await user.click(screen.getByRole('button', { name: '源码' }));
    expect(screen.getByRole('textbox', { name: '源码编辑器' }).getAttribute('contenteditable')).toBe('true');
    const source = model.active!.source!;
    await act(async () => { await source.languageReady; source.dispatch({ changes: { from: source.state.doc.length, insert: '\n源码补充' } }); });
    expect(document.querySelector('.cm-lineNumbers')?.textContent).toContain('1');
    await user.click(screen.getByRole('button', { name: '文档' }));
    expect(screen.getByRole('tabpanel').textContent).toContain('源码补充');
    await user.click(screen.getByRole('button', { name: '源码' }));
    await act(async () => { platform.menu?.({ payload: 'save' }); });
    expect(gateway.saveDocument.mock.calls[0][1]).toContain('源码补充'); expect(model.active!.dirty).toBe(false);
  });
  it('opens code with real line gutters/highlight spans and wires undo, language and wrap controls', async () => {
    const { model, user } = setup();
    await act(async () => { model.openFile({ path: '/notes/a.ts', name: 'a.ts', content: 'const answer: number = 42;\nconsole.log(answer);\n' }); await model.active!.source!.languageReady; });
    expect(screen.queryByRole('button', { name: '文档' })).toBeNull();
    expect(screen.getByRole('textbox', { name: '源码编辑器' }).getAttribute('contenteditable')).toBe('true');
    expect(document.querySelector('.cm-lineNumbers')?.textContent).toContain('2');
    await waitFor(() => expect(document.querySelector('.cm-line span')).not.toBeNull());
    act(() => { const source = model.active!.source!; source.dispatch({ changes: { from: 0, insert: '// changed\n' } }); });
    await user.click(screen.getByRole('button', { name: '撤销源码' })); expect(model.active!.dirty).toBe(false);
    await user.click(screen.getByRole('button', { name: '重做源码' })); expect(model.active!.dirty).toBe(true);
    await user.selectOptions(screen.getByRole('combobox', { name: '语法语言' }), 'Plain Text'); expect(model.active!.source!.language).toBe('Plain Text');
    expect(screen.getByRole('option', { name: '自动 · TypeScript' })).not.toBeNull();
    const content = model.markdown(model.active!); await user.click(screen.getByRole('checkbox', { name: '自动换行' }));
    expect(model.active!.wrap).toBe(true); expect(model.markdown(model.active!)).toBe(content);
    await user.click(screen.getByRole('button', { name: '查找和替换' })); expect(document.querySelector('.cm-search')).not.toBeNull();
  });
  it('creates a plain text tab and protects its edits when closing through the native menu', async () => {
    const { model, user, gateway } = setup();
    await user.click(screen.getByRole('button', { name: '新建文本' }));
    expect(model.active!.kind).toBe('text'); expect(model.active!.name).toBe('未命名');
    act(() => { model.active!.source!.dispatch({ changes: { from: 0, insert: '**literal text**' } }); platform.menu!({ payload: 'close-tab' }); });
    expect(screen.getByRole('dialog').textContent).toContain('未命名'); expect(screen.getByRole('dialog').textContent).not.toContain('.txt');
    await user.click(screen.getByRole('button', { name: '保存并继续' }));
    await waitFor(() => expect(model.tabs).toHaveLength(1)); expect(gateway.saveDocument.mock.calls[0][1]).toBe('**literal text**'); expect(gateway.saveDocument.mock.calls[0][6]).toBe('未命名');
  });
  it('opens ordinary directory files and keeps unsupported Markdown source editable while refusing document conversion', async () => {
    const { model, gateway, user } = setup(); await user.click(screen.getAllByRole('button', { name: '打开目录' })[0]);
    await user.click(within(await screen.findByRole('tree')).getByRole('button', { name: 'a.txt' }));
    expect(model.active!.kind).toBe('text'); expect(screen.getByRole('textbox', { name: '源码编辑器' })).toBeTruthy();
    gateway.openDocument.mockResolvedValue({ path: '/notes/special.md', name: 'special.md', content: '<!-- keep -->\n\n[^a]: footnote' });
    await user.click(screen.getByRole('button', { name: '打开文件' })); expect(model.active!.mode).toBe('source');
    await user.click(screen.getByRole('button', { name: '文档' })); expect(model.active!.mode).toBe('source');
    expect(screen.getByRole('alert').textContent).toContain('源码模式');
    expect(screen.getByRole('textbox', { name: '源码编辑器' }).getAttribute('contenteditable')).toBe('true');
  });
  it('all closed tabs leave a working empty state, and a new document can still be created', async () => {
    const { model, user } = setup(); await user.click(screen.getByRole('button', { name: '关闭 使用指南' }));
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    await user.click(within(screen.getByRole('main')).getByRole('button', { name: '新建 MD' }));
    expect(model.tabs).toHaveLength(1); expect(model.active!.editor).not.toBeNull();
  });
  it('localizes the real CodeMirror search panel and performs replacement through Chinese controls', async () => {
    const { model, user } = setup();
    await act(async () => { model.openFile({ path: '/notes/a.txt', name: 'a.txt', content: 'alpha beta alpha\n' }); });
    await user.click(screen.getByRole('button', { name: '查找和替换' }));
    const panel = document.querySelector<HTMLElement>('.cm-search')!;
    expect(within(panel).getByRole('button', { name: '下一个' })).not.toBeNull();
    expect(within(panel).getByRole('button', { name: '上一个' })).not.toBeNull();
    expect(within(panel).getByRole('button', { name: '全选匹配' })).not.toBeNull();
    expect(within(panel).getByRole('checkbox', { name: '区分大小写' })).not.toBeNull();
    expect(within(panel).getByRole('checkbox', { name: '正则表达式' })).not.toBeNull();
    expect(within(panel).getByRole('checkbox', { name: '全字匹配' })).not.toBeNull();
    await user.type(within(panel).getByRole('textbox', { name: '查找' }), 'alpha');
    await user.type(within(panel).getByRole('textbox', { name: '替换' }), '纸墨');
    await user.click(within(panel).getByRole('button', { name: '全部替换' }));
    expect(model.markdown(model.active!)).toBe('纸墨 beta 纸墨\n');
    await user.click(within(panel).getByRole('button', { name: '关闭' })); expect(document.querySelector('.cm-search')).toBeNull();
  });
  it('creates files and folders through compact directory controls with cancellation', async () => {
    const { model, gateway, user } = setup(); await user.click(screen.getAllByRole('button', { name: '打开目录' })[0]);
    await user.click(screen.getByRole('button', { name: '目录中新建文件' }));
    let dialog = await screen.findByRole('dialog'); await user.click(within(dialog).getByRole('button', { name: '取消' })); expect(gateway.createEntry).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '目录中新建文件' })); dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByRole('textbox', { name: '名称' })); await user.type(within(dialog).getByRole('textbox', { name: '名称' }), 'hello.txt');
    gateway.listDirectory.mockImplementation(async (_, path) => path === '/notes' ? [entry('/notes/docs', true), entry('/notes/hello.txt', false, false)] : []); gateway.createEntry.mockResolvedValueOnce('/notes/hello.txt'); await user.click(within(dialog).getByRole('button', { name: '确定' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(model.active?.name).toBe('hello.txt'); expect(gateway.createEntry).toHaveBeenCalledWith('/notes', '/notes', 'hello.txt', false);
    await user.click(screen.getByRole('button', { name: '更多操作 docs' })); await user.click(screen.getByRole('menuitem', { name: '新建文件夹' }));
    dialog = await screen.findByRole('dialog'); gateway.createEntry.mockResolvedValueOnce('/notes/docs/新建文件夹');
    await user.click(within(dialog).getByRole('button', { name: '确定' })); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(gateway.createEntry).toHaveBeenLastCalledWith('/notes', '/notes/docs', '新建文件夹', true);
  });
  it('renames an opened file and recycles it only after explicit confirmation', async () => {
    const { model, gateway, user } = setup(); await user.click(screen.getAllByRole('button', { name: '打开目录' })[0]);
    await user.click(within(screen.getByRole('tree')).getByRole('button', { name: 'A.md' }));
    fireEvent.contextMenu(within(screen.getByRole('tree')).getByRole('button', { name: 'A.md' }), { clientX: 100, clientY: 100 });
    await user.click(screen.getByRole('menuitem', { name: '重命名' })); let dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByRole('textbox', { name: '名称' })); await user.type(within(dialog).getByRole('textbox', { name: '名称' }), 'renamed.md');
    await user.click(dialog.parentElement!);
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect((within(dialog).getByRole('textbox', { name: '名称' }) as HTMLInputElement).value).toBe('renamed.md');
    expect(gateway.renameEntry).not.toHaveBeenCalled();
    gateway.renameEntry.mockResolvedValueOnce('/notes/renamed.md'); gateway.listDirectory.mockResolvedValue([entry('/notes/renamed.md')]);
    await user.click(within(dialog).getByRole('button', { name: '确定' })); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(model.active?.path).toBe('/notes/renamed.md');
    await user.click(screen.getByRole('button', { name: '更多操作 renamed.md' })); await user.click(screen.getByRole('menuitem', { name: '移到回收站' })); dialog = await screen.findByRole('dialog');
    expect(gateway.trashEntry).not.toHaveBeenCalled(); await user.click(within(dialog).getByRole('button', { name: '取消' })); expect(model.tabs).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: '更多操作 renamed.md' })); await user.click(screen.getByRole('menuitem', { name: '移到回收站' })); dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '移到回收站' })); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(gateway.trashEntry).toHaveBeenCalledWith('/notes', '/notes/renamed.md', [{ path: '/notes/renamed.md', content: '# Alpha\n\n正文' }]); expect(model.tabs).toHaveLength(1);
  });
  it('keeps a failed file operation dialog open and exposes its error without losing edits', async () => {
    const { model, gateway, user } = setup(); await user.click(screen.getAllByRole('button', { name: '打开目录' })[0]); await user.click(within(screen.getByRole('tree')).getByRole('button', { name: 'A.md' })); edit(model, '保留');
    await user.click(screen.getByRole('button', { name: '更多操作 A.md' })); await user.click(screen.getByRole('menuitem', { name: '移到回收站' })); const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '移到回收站' })); expect(gateway.trashEntry).not.toHaveBeenCalled(); expect(within(dialog).getByRole('alert').textContent).toContain('未保存'); expect(model.markdown(model.active!)).toContain('保留');
  });

  it('uses top tabs as the only open-file navigation and removes the sidebar open list', async () => {
    const { user } = setup(); await user.click(screen.getByRole('button', { name: '新建 Markdown' }));
    expect(screen.getAllByRole('tab')).toHaveLength(2); expect(screen.queryByText(/^已打开/)).toBeNull(); expect(screen.queryByRole('button', { name: '使用指南' })).toBeNull();
    await user.click(screen.getByRole('tab', { name: '使用指南' })); expect(screen.getByRole('tabpanel').textContent).toContain('欢迎');
  });
  it('applies a selected background, edits native preferences and resets without modifying document content', async () => {
    const { model, user, background, backgroundGateway } = setup(); await user.click(screen.getByRole('button', { name: '新建 Markdown' })); edit(model, '必须保留'); const tab = model.active!; const content = model.markdown(tab); const version = tab.draftVersion;
    backgroundGateway.choose.mockResolvedValueOnce({ image: { name: '本地.png', dataUrl: 'data:image/png;base64,background' }, blur: 6, mask: 30 });
    await user.click(screen.getByRole('button', { name: '背景设置' })); const panel = screen.getByRole('dialog', { name: '背景设置' });
    await user.click(within(panel).getByRole('button', { name: '选择本地图片' })); expect(document.querySelector('.workspace.has-background')).not.toBeNull();
    fireEvent.change(within(panel).getByRole('slider', { name: '背景模糊' }), { target: { value: '16' } });
    fireEvent.change(within(panel).getByRole('slider', { name: '背景遮罩' }), { target: { value: '65' } });
    await act(async () => { await background.flush(); }); expect(backgroundGateway.options).toHaveBeenLastCalledWith(16, 65);
    expect((document.querySelector('.workspace-background img') as HTMLImageElement).style.filter).toBe('blur(16px)'); expect((document.querySelector('.workspace-background > div') as HTMLElement).style.opacity).toBe('0.65');
    await user.click(within(panel).getByRole('button', { name: '恢复默认' })); expect(document.querySelector('.workspace-background')).toBeNull(); expect([background.blur, background.mask]).toEqual([6, 30]);
    expect(model.markdown(tab)).toBe(content); expect(tab.draftVersion).toBe(version); expect(tab.dirty).toBe(true);
  });
  it('shows save errors with retry and keeps focus on range controls during live preview', async () => {
    const { user, background, backgroundGateway } = setup(); await act(async () => { await background.load(); });
    backgroundGateway.choose.mockResolvedValueOnce({ image: { name: 'bg.png', dataUrl: 'data:image/png;base64,background' }, blur: 6, mask: 30 });
    await user.click(screen.getByRole('button', { name: '背景设置' })); const panel = screen.getByRole('dialog', { name: '背景设置' }); await user.click(within(panel).getByRole('button', { name: '选择本地图片' }));
    backgroundGateway.options.mockRejectedValueOnce('disk full'); const slider = within(panel).getByRole('slider', { name: '背景模糊' }); slider.focus(); fireEvent.change(slider, { target: { value: '18' } });
    await waitFor(() => expect(within(panel).getByRole('alert').textContent).toContain('保存失败')); expect(document.activeElement).toBe(slider);
    await user.click(within(panel).getByRole('button', { name: '重试' })); await waitFor(() => expect(within(panel).queryByRole('alert')).toBeNull());
    await user.keyboard('{Escape}'); expect(screen.queryByRole('dialog', { name: '背景设置' })).toBeNull();
  });
  it('falls back to paper when the displayed image errors and disables adjustment until an image is available', async () => {
    const { user, backgroundGateway } = setup(); backgroundGateway.choose.mockResolvedValueOnce({ image: { name: 'bg.png', dataUrl: 'data:image/png;base64,background' }, blur: 6, mask: 30 });
    await user.click(screen.getByRole('button', { name: '背景设置' })); const panel = screen.getByRole('dialog', { name: '背景设置' }); expect((within(panel).getByRole('slider', { name: '背景模糊' }) as HTMLInputElement).disabled).toBe(true);
    await user.click(within(panel).getByRole('button', { name: '选择本地图片' })); fireEvent.error(document.querySelector('.workspace-background img')!);
    expect(document.querySelector('.workspace-background')).toBeNull(); expect(within(panel).getByRole('alert').textContent).toContain('默认纸面');
  });

  it('waits for the final background preference write before a normal native quit', async () => {
    const { background, backgroundGateway } = setup(); await act(async () => { await background.load(); });
    let finish!: () => void; backgroundGateway.options.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    act(() => { background.setOptions({ blur: 19 }); platform.menu!({ payload: 'quit' }); });
    expect(platform.destroy).not.toHaveBeenCalled(); expect(background.saving).toBe(true);
    await act(async () => { finish(); await background.flush(); }); await waitFor(() => expect(platform.destroy).toHaveBeenCalledTimes(1));
  });

});

it('opens recent directories through the compact header and retains missing records for removal', async () => {
  const entries = { files: [{ path: '/gone.md', name: 'gone.md' }], directories: [{ path: '/old', name: 'old' }] };
  const history = { load: vi.fn().mockResolvedValue(entries), record: vi.fn().mockResolvedValue(entries), remove: vi.fn().mockResolvedValue({ ...entries, files: [] }), clear: vi.fn().mockResolvedValue({ files: [], directories: [] }), openFile: vi.fn().mockRejectedValue('文件不存在'), openDirectory: vi.fn().mockResolvedValue({ path: '/old', name: 'old', entries: [] }) } satisfies RecentGateway;
  const recent = new RecentModel(history); const { model, user } = fixture(recent); mounted.push(model);
  await user.click(screen.getByRole('button', { name: '最近打开' }));
  await user.click(await screen.findByRole('button', { name: '打开文件 gone.md' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '文件不存在');
  await user.click(screen.getByRole('button', { name: '移除文件记录 gone.md' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '打开文件 gone.md' })).toBeNull());
  await user.click(screen.getByRole('button', { name: '打开目录 old' }));
  await waitFor(() => expect(model.root?.path).toBe('/old'));
  expect(screen.queryByRole('dialog', { name: '最近打开' })).toBeNull();
  expect(screen.getByRole('button', { name: '关闭目录' })).toBeTruthy();
});

it('restores saved tabs in the existing compact layout and shows recoverable failure details', async () => {
  const state = {version:1 as const,directory:null,tabs:[{path:'/a.md',mode:'document' as const,reading:false},{path:'/b.md',mode:'document' as const,reading:true}],activePath:'/b.md'};
  const session: WorkspaceSessionGateway = {restore:vi.fn().mockResolvedValue({exists:true,session:state,root:null,tabs:state.tabs.map(tab=>({...tab,file:{path:tab.path,name:tab.path.slice(1),content:'# 恢复正文'}})),errors:['文件恢复失败：missing.md']}),write:vi.fn().mockResolvedValue(undefined)};
  const {model,user}=fixture(undefined,session); mounted.push(model);
  await act(async()=>{await model.restoreSession();});
  expect(screen.getByRole('tab',{name:'b.md'}).getAttribute('aria-selected')).toBe('true');
  expect(screen.queryByRole('tab',{name:'使用指南'})).toBeNull();
  expect(screen.getByText(/有 1 项未能恢复/)).toBeTruthy();
  expect(model.active?.reading).toBe(true); await user.click(screen.getByRole('button',{name:'关闭提示'}));
  expect(screen.queryByText(/有 1 项未能恢复/)).toBeNull();
});
