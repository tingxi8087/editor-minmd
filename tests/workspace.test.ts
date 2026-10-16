// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceModel } from "../src/workspace/model";
import type { DirectoryEntry, DirectoryRoot, DocumentFile, FileGateway } from "../src/lib/files";

const models: WorkspaceModel[] = [];
const file = (name: string, content = `# ${name}\n\n正文`) => ({ path: `/notes/${name}.md`, name: `${name}.md`, content });
const entry = (path: string, isDirectory = false): DirectoryEntry => ({ path, name: path.split('/').pop()!, isDirectory, isMarkdown: !isDirectory, isSymlink: false });
function setup() {
  const gateway = {
    loadImage: vi.fn<FileGateway['loadImage']>().mockResolvedValue('data:image/png;base64,iVBORw0KGgo='),
    importImage: vi.fn<FileGateway['importImage']>().mockResolvedValue({ reference: 'assets/image.png', name: '粘贴图片' }),
    openLink: vi.fn<FileGateway['openLink']>().mockResolvedValue(null),
    openDocument: vi.fn<FileGateway['openDocument']>().mockResolvedValue(null),
    saveDocument: vi.fn<FileGateway['saveDocument']>().mockImplementation(async (path, content) => ({ path: path ?? '/notes/saved.md', name: path?.split('/').pop() ?? 'saved.md', content })),
    releaseDocument: vi.fn<FileGateway['releaseDocument']>().mockResolvedValue(undefined),
    openDirectory: vi.fn<FileGateway['openDirectory']>().mockResolvedValue(null),
    listDirectory: vi.fn<FileGateway['listDirectory']>().mockResolvedValue([]),
    readWorkspaceDocument: vi.fn<FileGateway['readWorkspaceDocument']>().mockImplementation(async (_, path) => ({ path, name: path.split('/').pop()!, content: '# loaded' })),
    createEntry: vi.fn().mockResolvedValue("/notes/new.md"),
    renameEntry: vi.fn().mockResolvedValue("/notes/renamed.md"),
    trashEntry: vi.fn().mockResolvedValue(undefined),
    closeDirectory: vi.fn<FileGateway['closeDirectory']>().mockResolvedValue(undefined),
  };
  const model = new WorkspaceModel(gateway); models.push(model); return { model, gateway };
}
const edit = (model: WorkspaceModel, id: string, text: string) => {
  model.activate(id); const editor = model.active!.editor!;
  editor.commands.insertContentAt(editor.state.doc.content.size - 1, text);
};
afterEach(() => { models.forEach((model) => model.dispose()); models.length = 0; });

describe('multiple document sessions', () => {
  it('keeps a saved document ending in a code block clean during selection-only controls', () => {
    const { model } = setup();
    const raw = '| A | B |\n| --- | --- |\n| x | y |\n\n```js\nconst n = 1;\n```\n';
    const tab = model.openFile(file('blocks', raw));
    tab.editor!.commands.setTextSelection(4);
    expect(tab.dirty).toBe(false);
    expect(model.markdown(tab)).toBe(raw);
    expect(tab.editor!.can().undo()).toBe(false);
  });
  it('retains contents, selections, scroll, reading mode and independent undo/redo', () => {
    const { model } = setup(); const a = model.openFile(file('A')); edit(model, a.id, '编辑A');
    a.editor!.commands.setTextSelection(2); a.scrollTop = 120; model.setReading(true);
    const b = model.openFile(file('B')); edit(model, b.id, '编辑B');
    b.editor!.commands.undo(); expect(model.markdown(b)).not.toContain('编辑B');
    expect(model.markdown(a)).toContain('编辑A'); expect(a.dirty).toBe(true);
    model.activate(a.id); expect(a.editor!.state.selection.from).toBe(2); expect(a.scrollTop).toBe(120); expect(a.reading).toBe(true);
    model.setReading(false); a.editor!.commands.undo(); expect(model.markdown(a)).not.toContain('编辑A'); expect(a.dirty).toBe(false);
    a.editor!.commands.redo(); expect(model.markdown(a)).toContain('编辑A');
    model.activate(b.id); b.editor!.commands.redo(); expect(model.markdown(b)).toContain('编辑B');
  });
  it('deduplicates repeated open without replacing a dirty document or its history', () => {
    const { model, gateway } = setup(); const a = model.openFile(file('A')); edit(model, a.id, 'unsaved');
    gateway.openDocument.mockResolvedValue(file('A', '# external'));
    return model.chooseFile().then(() => {
      expect(model.tabs).toHaveLength(1); expect(model.activeId).toBe(a.id);
      expect(model.markdown(a)).toContain('unsaved'); expect(a.editor!.can().undo()).toBe(true);
    });
  });
  it('creates independent unsaved documents and preserves drafts when opening another file', () => {
    const { model } = setup(); const a = model.create()!; edit(model, a.id, 'draft'); const b = model.create()!;
    expect(model.tabs).toHaveLength(2); expect(a.editor).not.toBe(b.editor); expect(model.markdown(a)).toContain('draft');
    expect([a.name, b.name]).toEqual(['未命名.md', '未命名 2.md']);
    const text = model.create('text')!; const text2 = model.create('text')!; expect([text.name, text2.name]).toEqual(['未命名', '未命名 2']); expect(text.mode).toBe('source');
    model.openFile(file('disk')); expect(model.hasDirty).toBe(true); expect(model.tabs).toHaveLength(5);
  });
  it('saves exactly the requested tab and protects all other open paths', async () => {
    const { model, gateway } = setup(); const a = model.openFile(file('A')); edit(model, a.id, 'only A');
    const b = model.openFile(file('B')); edit(model, b.id, 'only B');
    expect(await model.save(a.id)).toBe(true);
    const args = gateway.saveDocument.mock.calls[0];
    expect(args[0]).toBe(a.path); expect(args[1]).toContain('only A'); expect(args[1]).not.toContain('only B');
    expect(args[2]).toBe(file('A').content); expect(args[4]).toEqual([b.path]);
    expect(a.dirty).toBe(false); expect(b.dirty).toBe(true); expect(model.activeId).toBe(b.id);
  });
  it('does not write unmodified files and preserves original bytes during unchanged Save As', async () => {
    const { model, gateway } = setup(); const raw = '\uFEFF---\r\ntitle: A\r\n---\r\n# 原文\r\n\r\n';
    const a = model.openFile(file('A', raw)); await model.save(a.id); expect(gateway.saveDocument).not.toHaveBeenCalled();
    await model.save(a.id, true); expect(gateway.saveDocument.mock.calls[0][1]).toBe(raw);
  });
  it('keeps dirty state after a cancelled save or conflict', async () => {
    const { model, gateway } = setup(); const a = model.create()!; edit(model, a.id, 'must keep');
    gateway.saveDocument.mockResolvedValueOnce(null); expect(await model.save(a.id)).toBe(false); expect(a.dirty).toBe(true);
    gateway.saveDocument.mockRejectedValueOnce('external conflict'); expect(await model.save(a.id)).toBe(false);
    expect(model.error).toBe('external conflict'); expect(model.markdown(a)).toContain('must keep'); expect(a.dirty).toBe(true);
  });
  it('updates a Save As path and retains the resource base until the tab closes', async () => {
    const { model, gateway } = setup(); const a = model.openFile(file('A'));
    gateway.saveDocument.mockResolvedValueOnce({ ...file('new'), content: '# A' });
    await model.save(a.id, true); expect(a.path).toBe('/notes/new.md'); expect(a.name).toBe('new.md');
    expect(a.resourceBase).toBe('/notes/A.md'); expect(gateway.releaseDocument).not.toHaveBeenCalled();
    model.requestClose([a.id]); await model.completeClose();
    expect(gateway.releaseDocument).toHaveBeenCalledWith('/notes/A.md'); expect(gateway.releaseDocument).toHaveBeenCalledWith('/notes/new.md');
  });
  it('holds edits read-only during pending native saves and ignores tab-switch requests', async () => {
    const { model, gateway } = setup(); const a = model.openFile(file('A')); edit(model, a.id, 'saving');
    const b = model.openFile(file('B')); model.activate(a.id);
    let resolve!: (file: DocumentFile | null) => void;
    gateway.saveDocument.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const saving = model.save(a.id); expect(a.editor!.isEditable).toBe(false); model.activate(b.id); expect(model.activeId).toBe(a.id);
    resolve({ ...file('A'), content: model.markdown(a) }); await saving; expect(a.editor!.isEditable).toBe(true);
  });
  it('opens unsupported Markdown as editable source without damaging other tabs', () => {
    const { model } = setup(); const a = model.openFile(file('A')); edit(model, a.id, 'draft');
    const b = model.openFile(file('footnote', '正文[^1]\n\n[^1]: 注释'));
    expect(b.editor).toBeNull(); expect(b.mode).toBe('source'); expect(b.source).not.toBeNull(); expect(b.unsupported).toBe('脚注'); expect(model.markdown(b)).toBe(b.raw); expect(a.dirty).toBe(true);
  });
});

describe('closing tabs and windows', () => {
  it('confirms the dirty target even when another tab was active; cancellation loses nothing', () => {
    const { model } = setup(); const a = model.openFile(file('A')); edit(model, a.id, 'keep'); const b = model.openFile(file('B'));
    model.requestClose([a.id]); expect(model.closeTarget?.id).toBe(a.id); expect(model.activeId).toBe(a.id);
    model.cancelClose(); expect(model.tabs).toHaveLength(2); expect(a.dirty).toBe(true); expect(model.markdown(a)).toContain('keep');
    model.activate(b.id); expect(model.activeId).toBe(b.id);
  });
  it('returns to the originally active tab after confirming a nonadjacent background tab close', async () => {
    const { model } = setup(); const a = model.openFile(file('A')); edit(model, a.id, 'draft');
    model.openFile(file('B')); const c = model.openFile(file('C'));
    model.requestClose([a.id]); expect(model.active).toBe(a); model.approveClose(); await model.completeClose();
    expect(model.active).toBe(c); expect(model.tabs).toHaveLength(2);
  });
  it('closes a clean tab immediately and activates its neighbor', async () => {
    const { model, gateway } = setup(); const a = model.openFile(file('A')); const b = model.openFile(file('B'));
    model.requestClose([b.id]); expect(model.closeTarget).toBeNull(); await model.completeClose();
    expect(model.tabs).toEqual([a]); expect(model.activeId).toBe(a.id); expect(b.editor!.isDestroyed).toBe(true);
    expect(gateway.releaseDocument).toHaveBeenCalledWith(b.path);
  });
  it('walks through all dirty documents on window close; later cancellation retains unsaved tabs', async () => {
    const { model } = setup(); const a = model.openFile(file('A')); edit(model, a.id, 'A'); const b = model.openFile(file('B')); edit(model, b.id, 'B');
    model.requestClose(model.tabs.map((tab) => tab.id), true);
    expect(await model.completeClose()).toBe(false); expect(model.tabs).toHaveLength(2);
    model.approveClose(); expect(model.closeTarget?.id).toBe(b.id); model.cancelClose();
    expect(model.tabs).toHaveLength(2); expect(a.dirty).toBe(true); expect(b.dirty).toBe(true);
    model.requestClose([a.id, b.id], true); await model.save(a.id); model.approveClose(); model.approveClose();
    expect(await model.completeClose()).toBe(true); expect(model.tabs).toHaveLength(0);
  });
  it('does not close dirty tabs if saving is cancelled', async () => {
    const { model, gateway } = setup(); const a = model.create()!; edit(model, a.id, 'keep'); model.requestClose([a.id]);
    gateway.saveDocument.mockResolvedValueOnce(null); expect(await model.save(a.id)).toBe(false);
    expect(model.closeTarget).toBe(a); expect(await model.completeClose()).toBe(false); expect(model.tabs).toHaveLength(1);
  });
  it('close others preserves the selected tab and handles the last tab without recreating a guide', async () => {
    const { model } = setup(); const a = model.openFile(file('A')); const b = model.openFile(file('B'));
    model.requestClose([a.id]); await model.completeClose(); expect(model.active).toBe(b);
    model.requestClose([b.id]); await model.completeClose(); expect(model.active).toBeNull(); expect(model.tabs).toHaveLength(0);
  });
});

describe('directory workspaces', () => {
  const root = (path = '/notes'): DirectoryRoot => ({ path, name: path.split('/').pop()!, entries: [entry(`${path}/docs`, true), entry(`${path}/A.md`)] });
  it('opens a directory without recursing and retains existing dirty/outside tabs', async () => {
    const { model, gateway } = setup(); const a = model.openFile(file('outside')); edit(model, a.id, 'keep');
    gateway.openDirectory.mockResolvedValueOnce(root()); await model.chooseDirectory();
    expect(model.root?.path).toBe('/notes'); expect(gateway.listDirectory).not.toHaveBeenCalled(); expect(model.tabs).toEqual([a]); expect(a.dirty).toBe(true);
    await model.toggleDirectory('/notes/docs'); expect(gateway.listDirectory).toHaveBeenCalledWith('/notes', '/notes/docs');
    await model.toggleDirectory('/notes/docs'); await model.toggleDirectory('/notes/docs'); expect(gateway.listDirectory).toHaveBeenCalledTimes(1);
  });
  it('deduplicates dirty tree files without re-reading disk', async () => {
    const { model, gateway } = setup(); gateway.openDirectory.mockResolvedValue(root()); await model.chooseDirectory();
    const a = model.openFile(file('A')); edit(model, a.id, 'keep'); model.create();
    await model.openTreeFile(entry('/notes/A.md')); expect(model.active).toBe(a); expect(gateway.readWorkspaceDocument).not.toHaveBeenCalled();
  });
  it('reports a missing file without removing the current tab; reads valid leaves through the gateway', async () => {
    const { model, gateway } = setup(); gateway.openDirectory.mockResolvedValue(root()); await model.chooseDirectory();
    const a = model.openFile(file('A')); gateway.readWorkspaceDocument.mockRejectedValueOnce('file deleted');
    await model.openTreeFile(entry('/notes/missing.md')); expect(model.active).toBe(a); expect(model.error).toBe('file deleted');
    await model.openTreeFile(entry('/notes/docs/child.md')); expect(model.tabs).toHaveLength(2); expect(model.active?.path).toBe('/notes/docs/child.md');
  });
  it('cancelling or failing a directory dialog leaves the previous directory and tabs intact', async () => {
    const { model, gateway } = setup(); gateway.openDirectory.mockResolvedValueOnce(root()); await model.chooseDirectory();
    gateway.openDirectory.mockResolvedValueOnce(null); await model.chooseDirectory(); expect(model.root?.path).toBe('/notes');
    gateway.openDirectory.mockRejectedValueOnce('permission denied'); await model.chooseDirectory(); expect(model.root?.path).toBe('/notes'); expect(model.error).toBe('permission denied');
  });
  it('ignores late child responses after root changes, and refreshes errors with retry', async () => {
    const { model, gateway } = setup(); gateway.openDirectory.mockResolvedValueOnce(root()); await model.chooseDirectory();
    let resolve!: (entries: DirectoryEntry[]) => void;
    gateway.listDirectory.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const pending = model.toggleDirectory('/notes/docs');
    gateway.openDirectory.mockResolvedValueOnce(root('/other')); await model.chooseDirectory();
    resolve([entry('/notes/docs/stale.md')]); await pending;
    expect(model.children.has('/notes/docs')).toBe(false); expect(model.loading.size).toBe(0);
    gateway.listDirectory.mockRejectedValueOnce('unreadable'); await model.toggleDirectory('/other/docs'); expect(model.treeErrors.get('/other/docs')).toBe('unreadable');
    gateway.listDirectory.mockResolvedValueOnce([entry('/other/docs/fixed.md')]); await model.loadDirectory('/other/docs');
    expect(model.treeErrors.has('/other/docs')).toBe(false); expect(model.children.get('/other/docs')).toHaveLength(1);
  });
  it('refreshes a cached parent after saving a new document into the root', async () => {
    const { model, gateway } = setup(); gateway.openDirectory.mockResolvedValue(root()); await model.chooseDirectory();
    const tab = model.create()!; edit(model, tab.id, 'new file');
    gateway.saveDocument.mockResolvedValueOnce({ path: '/notes/new.md', name: 'new.md', content: 'new file' });
    gateway.listDirectory.mockResolvedValueOnce([entry('/notes/new.md')]);
    await model.save(tab.id); expect(model.children.get('/notes')?.[0].name).toBe('new.md'); expect(tab.dirty).toBe(false);
  });
  it('refresh collapses stale children and does not disturb open edits', async () => {
    const { model, gateway } = setup(); gateway.openDirectory.mockResolvedValue(root()); await model.chooseDirectory();
    await model.toggleDirectory('/notes/docs'); const tab = model.openFile(file('A')); edit(model, tab.id, 'keep');
    gateway.listDirectory.mockResolvedValueOnce([entry('/notes/added.md')]); await model.refreshTree();
    expect(model.children.has('/notes/docs')).toBe(false); expect([...model.expanded]).toEqual(['/notes']);
    expect(model.children.get('/notes')?.[0].name).toBe('added.md'); expect(model.markdown(tab)).toContain('keep');
  });
  it('closing the directory preserves opened documents and invalidates cached tree data', async () => {
    const { model, gateway } = setup(); gateway.openDirectory.mockResolvedValue(root()); await model.chooseDirectory(); const a = model.openFile(file('A'));
    await model.closeDirectory(); expect(model.root).toBeNull(); expect(model.children.size).toBe(0); expect(model.active).toBe(a);
    expect(gateway.closeDirectory).toHaveBeenCalledOnce();
  });
});

describe('Markdown images and links', () => {
  it('stops slash image insertion when an untitled Markdown is saved as a text file', async () => {
    const { model, gateway } = setup(); const tab = model.create()!; tab.editor!.commands.setContent('<p>/image</p>');
    gateway.saveDocument.mockResolvedValueOnce({ path: '/notes/text.txt', name: 'text.txt', content: '/image\n' });
    await model.insertImages(tab.id, undefined, undefined, { from: 1, to: 7 });
    expect(tab.mode).toBe('source'); expect(tab.editor).toBeNull(); expect(gateway.importImage).not.toHaveBeenCalled(); expect(model.markdown(tab)).toContain('/image');
  });

  it('replaces a slash image command only after import and restores the entire command with undo', async () => {
    const { model, gateway } = setup(); const tab = model.openFile(file('Slash', '/image'));
    tab.editor!.commands.setTextSelection(7);
    gateway.importImage.mockResolvedValueOnce(null);
    await model.insertImages(tab.id, undefined, undefined, { from: 1, to: 7 });
    expect(tab.editor!.getText()).toBe('/image'); expect(tab.dirty).toBe(false);
    await model.insertImages(tab.id, undefined, undefined, { from: 1, to: 7 });
    expect(model.markdown(tab)).toContain('![粘贴图片](assets/image.png)'); expect(tab.editor!.getText()).not.toContain('/image');
    tab.editor!.commands.undo(); expect(tab.editor!.getText()).toBe('/image');
  });
  it('does not replace changed text after an asynchronous slash image import', async () => {
    const { model, gateway } = setup(); const tab = model.openFile(file('Slash', '/image'));
    let finish!: (value: { reference: string; name: string }) => void;
    gateway.importImage.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = model.insertImages(tab.id, undefined, undefined, { from: 1, to: 7 });
    tab.editor!.commands.insertContentAt({ from: 1, to: 7 }, 'changed');
    finish({ reference: 'assets/image.png', name: 'image' }); await pending;
    expect(tab.editor!.getText()).toBe('changed'); expect(model.error).toContain('位置已改变'); expect(tab.editor!.getJSON().content?.some(node => node.type === 'image')).toBe(false);
  });

  it('saves an untitled document before importing an image; cancelled save imports nothing', async () => {
    const { model, gateway } = setup(); const tab = model.create()!;
    gateway.saveDocument.mockResolvedValueOnce(null);
    await model.insertImages(tab.id); expect(gateway.importImage).not.toHaveBeenCalled(); expect(tab.path).toBeNull();
    await model.insertImages(tab.id); expect(gateway.importImage).toHaveBeenCalledWith('/notes/saved.md', undefined, undefined, undefined);
    expect(model.markdown(tab)).toContain('![粘贴图片](assets/image.png)'); expect(tab.dirty).toBe(true);
    expect(tab.editor!.can().undo()).toBe(true);
    tab.editor!.commands.undo(); expect(model.markdown(tab)).not.toContain('image.png');
  });
  it('cancels image picking without changing the document and reports import errors', async () => {
    const { model, gateway } = setup(); const tab = model.openFile(file('A'));
    gateway.importImage.mockResolvedValueOnce(null); await model.insertImages(tab.id); expect(tab.dirty).toBe(false);
    gateway.importImage.mockRejectedValueOnce('图片不能超过 20 MB'); await model.insertImages(tab.id);
    expect(model.error).toContain('20 MB'); expect(tab.dirty).toBe(false); expect(model.busy).toBe(false);
  });
  it('passes native drop paths and does not insert into read-only or other tabs', async () => {
    const { model, gateway } = setup(); const tab = model.openFile(file('A'));
    await model.insertImages(tab.id, undefined, ['/tmp/中文图.png', '/tmp/second.png']);
    expect(gateway.importImage).toHaveBeenCalledTimes(2); expect(gateway.importImage.mock.calls[0][1]).toBe('/tmp/中文图.png');
    model.setReading(true); await model.insertImages(tab.id); expect(gateway.importImage).toHaveBeenCalledTimes(2);
    model.openFile(file('B')); await model.insertImages(tab.id); expect(gateway.importImage).toHaveBeenCalledTimes(2);
  });
  it('tokenizes only local destinations for Save As, preserving source editor and undo history', async () => {
    const { model, gateway } = setup(); const tab = model.openFile(file('A', '# A\n\n![中文](assets/a%20b.png)\n\n[笔记](../笔记.md#标题) [网站](https://example.com)\n'));
    edit(model, tab.id, '编辑'); const before = tab.editor!.getJSON();
    gateway.saveDocument.mockResolvedValueOnce({ path: '/elsewhere/new.md', name: 'new.md', content: '# saved\n' });
    await model.save(tab.id, true);
    const args = gateway.saveDocument.mock.calls[0]; expect(args[5]?.basePath).toBe('/notes/A.md');
    expect(args[5]?.references.map(ref => ref.value)).toEqual(['assets/a%20b.png', '../笔记.md#标题']);
    expect(args[1]).toContain('https://example.com'); expect(args[1]).not.toContain('(assets/a%20b.png)');
    expect(tab.editor!.getJSON()).toEqual(before); expect(tab.editor!.can().undo()).toBe(true);
    edit(model, tab.id, '再改'); expect(model.markdown(tab)).toContain('../notes/assets/a%20b.png');
    await model.insertImages(tab.id); expect(tab.editor!.getJSON().content?.some(node => node.type === 'image' && node.attrs?.src === '../elsewhere/assets/image.png')).toBe(true);
  });
  it('opens linked Markdown through the same tab controller and deduplicates dirty tabs', async () => {
    const { model, gateway } = setup(); const a = model.openFile(file('A')); edit(model, a.id, 'unsaved');
    const b = model.openFile(file('B')); gateway.openLink.mockResolvedValue(file('A', '# external'));
    await model.openLink(b.id, 'A.md'); expect(model.tabs).toHaveLength(2); expect(model.activeId).toBe(a.id); expect(model.markdown(a)).toContain('unsaved');
    gateway.openLink.mockRejectedValueOnce('链接文件不存在'); await model.openLink(a.id, 'missing.md'); expect(model.error).toContain('不存在'); expect(model.activeId).toBe(a.id);
    await model.openLink(a.id, 'javascript:alert(1)'); expect(gateway.openLink).toHaveBeenCalledTimes(2);
  });
  it('loads relative images using the document resource base without modifying stored Markdown', async () => {
    const { model, gateway } = setup(); const raw = '# 标题\n\n![图](assets/图.png)\n';
    const tab = model.openFile(file('A', raw));
    await Promise.resolve(); expect(gateway.loadImage).toHaveBeenCalledWith('/notes/A.md', 'assets/图.png');
    expect(model.markdown(tab)).toBe(raw); expect(tab.dirty).toBe(false);
  });
});
