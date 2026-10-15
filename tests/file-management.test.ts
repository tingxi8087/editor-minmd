// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceModel } from '../src/workspace/model';
import { files, type DirectoryEntry } from '../src/lib/files';
import type { Draft, ReliabilityGateway } from '../src/lib/reliability';
const models: WorkspaceModel[] = [];
const entry = (path: string, isDirectory = false): DirectoryEntry => ({ path, name: path.split('/').pop()!, isDirectory, isFile: !isDirectory, isMarkdown: /\.md$/.test(path), isSymlink: false });
function setup() {
  const disk = new Map([['/notes/docs/a.md', '# A\n'], ['/notes/docs/b.ts', 'const n = 1;\n'], ['/notes/docs-other/c.txt', 'outside']]);
  const gateway = { ...files,
    createEntry: vi.fn<typeof files.createEntry>().mockImplementation(async (_, parent, name, folder) => { const path = `${parent}/${name}`; if (disk.has(path)) throw '名称已存在'; if (!folder) disk.set(path, ''); return path; }),
    renameEntry: vi.fn<typeof files.renameEntry>().mockImplementation(async (_, path, name) => { const target = path.slice(0, path.lastIndexOf('/') + 1) + name; for (const [key, value] of [...disk]) if (key === path || key.startsWith(path + '/')) { disk.delete(key); disk.set(target + key.slice(path.length), value); } return target; }),
    trashEntry: vi.fn<typeof files.trashEntry>().mockImplementation(async (_, path) => { for (const key of [...disk.keys()]) if (key === path || key.startsWith(path + '/')) disk.delete(key); }),
    listDirectory: vi.fn<typeof files.listDirectory>().mockImplementation(async (_, path) => [...disk.keys()].filter(key => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/')).map(key => entry(key))),
    readWorkspaceDocument: vi.fn<typeof files.readWorkspaceDocument>().mockImplementation(async (_, path) => ({ path, name: path.split('/').pop()!, content: disk.get(path)! })),
    saveDocument: vi.fn<typeof files.saveDocument>().mockImplementation(async (path, content) => { disk.set(path!, content); return { path: path!, name: path!.split('/').pop()!, content }; }),
    releaseDocument: vi.fn<typeof files.releaseDocument>().mockResolvedValue(undefined),
  };
  const storage = {
    loadDrafts: vi.fn<ReliabilityGateway['loadDrafts']>().mockResolvedValue([]), writeDrafts: vi.fn<ReliabilityGateway['writeDrafts']>().mockResolvedValue(undefined),
    authorizeDraft: vi.fn<ReliabilityGateway['authorizeDraft']>().mockResolvedValue(null), checkDocuments: vi.fn<ReliabilityGateway['checkDocuments']>().mockResolvedValue([]),
    watchDocuments: vi.fn<ReliabilityGateway['watchDocuments']>().mockResolvedValue(undefined), onDiskChange: vi.fn<ReliabilityGateway['onDiskChange']>().mockResolvedValue(() => {}),
  };
  const model = new WorkspaceModel(gateway, storage); models.push(model);
  model.root = { path: '/notes', name: 'notes', entries: [entry('/notes/docs', true)] };
  model.children.set('/notes', model.root.entries); model.children.set('/notes/docs', [entry('/notes/docs/a.md'), entry('/notes/docs/b.ts')]); model.expanded = new Set(['/notes', '/notes/docs']);
  const open = (path: string) => model.openFile({ path, name: path.split('/').pop()!, content: disk.get(path)! });
  return { model, gateway, storage, disk, open };
}
afterEach(() => { models.forEach(model => model.dispose()); models.length = 0; });
describe('directory mutations and document sessions', () => {
  it('creates and opens a file in its requested folder and expands a new folder', async () => {
    const { model, gateway, disk } = setup();
    expect(await model.createEntry('/notes/docs', '新建.txt', false)).toBe(true);
    expect(disk.get('/notes/docs/新建.txt')).toBe(''); expect(model.active?.mode).toBe('source'); expect(model.active?.dirty).toBe(false);
    expect(model.children.get('/notes/docs')?.some(e => e.name === '新建.txt')).toBe(true);
    expect(await model.createEntry('/notes/docs', '空文件夹', true)).toBe(true); expect(model.expanded.has('/notes/docs/空文件夹')).toBe(true);
    expect(gateway.createEntry).toHaveBeenLastCalledWith('/notes', '/notes/docs', '空文件夹', true);
  });
  it('preserves dirty content/history and retargets child files, drafts and future saves on folder rename', async () => {
    const { model, gateway, storage, open, disk } = setup(); await model.startReliability();
    const a = open('/notes/docs/a.md'); a.editor!.commands.insertContentAt(2, 'edited'); const editor = a.editor;
    const b = open('/notes/docs/b.ts'); b.source!.dispatch({ changes: { from: 0, insert: '// draft\n' }, userEvent: 'input.type' }); const source = b.source;
    const outside = open('/notes/docs-other/c.txt');
    expect(await model.renameEntry('/notes/docs', '重命名')).toBe(true);
    expect(a.path).toBe('/notes/重命名/a.md'); expect(a.resourceBase).toBe(a.path); expect(a.editor).toBe(editor); expect(a.editor!.can().undo()).toBe(true);
    expect(b.source).toBe(source); expect(b.source!.canUndo).toBe(true); expect(b.dirty).toBe(true); expect(outside.path).toBe('/notes/docs-other/c.txt');
    expect(model.expanded.has('/notes/重命名')).toBe(true); expect(model.children.has('/notes/docs')).toBe(false);
    const drafts = storage.writeDrafts.mock.calls.at(-1)![0]; expect(drafts.map(d => d.path)).toEqual(['/notes/重命名/a.md', '/notes/重命名/b.ts']);
    expect(gateway.renameEntry.mock.calls[0][3]).toEqual([{ path: '/notes/docs/a.md', content: '# A\n' }, { path: '/notes/docs/b.ts', content: 'const n = 1;\n' }]);
    expect(await model.save(b.id)).toBe(true); expect(disk.get('/notes/重命名/b.ts')).toContain('// draft');
  });
  it('changes editor type when a renamed extension changes and retains unsaved content', async () => {
    const { model, open } = setup(); const a = open('/notes/docs/a.md'); a.editor!.commands.insertContentAt(2, 'edited');
    expect(await model.renameEntry(a.path!, 'a.ts')).toBe(true); expect(a.mode).toBe('source'); expect(a.kind).toBe('text'); expect(a.editor).toBeNull(); expect(a.dirty).toBe(true); expect(a.sourceText).toContain('edited');
    await a.source!.languageReady; expect(a.source!.language).toBe('TypeScript');
  });
  it('blocks deleting a dirty descendant without invoking the native recycle operation', async () => {
    const { model, gateway, open } = setup(); const tab = open('/notes/docs/b.ts'); tab.source!.dispatch({ changes: { from: 0, insert: 'unsaved' } });
    expect(await model.trashEntry('/notes/docs')).toBe(false); expect(gateway.trashEntry).not.toHaveBeenCalled(); expect(model.tabs).toContain(tab); expect(model.error).toContain('未保存');
  });
  it('closes only recycled clean descendants and prunes tree state after success', async () => {
    const { model, gateway, open } = setup(); const a = open('/notes/docs/a.md'); open('/notes/docs/b.ts'); const outside = open('/notes/docs-other/c.txt');
    expect(await model.trashEntry('/notes/docs')).toBe(true); expect(model.tabs).toEqual([outside]); expect(model.active).toBe(outside);
    expect(a.editor!.isDestroyed).toBe(true); expect(model.children.has('/notes/docs')).toBe(false); expect(model.expanded.has('/notes/docs')).toBe(false);
    expect(gateway.trashEntry.mock.calls[0][2]).toHaveLength(2);
  });
  it('keeps clean tabs, paths and caches intact when recycle or rename fails', async () => {
    const { model, gateway, open, disk } = setup(); const a = open('/notes/docs/a.md');
    gateway.trashEntry.mockRejectedValueOnce('系统回收站不可用'); expect(await model.trashEntry('/notes/docs')).toBe(false); expect(model.tabs).toContain(a); expect(a.editor!.isDestroyed).toBe(false);
    gateway.renameEntry.mockRejectedValueOnce('名称已存在'); expect(await model.renameEntry(a.path!, 'b.md')).toBe(false); expect(a.path).toBe('/notes/docs/a.md'); expect(disk.has(a.path!)).toBe(true); expect(model.busy).toBe(false);
  });
  it('refuses root/outside/pending recovery mutations and resources retained by another tab', async () => {
    const { model, gateway, open } = setup(); expect(await model.renameEntry('/notes', 'new')).toBe(false); expect(await model.trashEntry('/notes')).toBe(false); expect(await model.createEntry('/notes-other', 'x', false)).toBe(false);
    model.pendingDrafts = [{ path: '/notes/docs/a.md' } as Draft]; expect(await model.renameEntry('/notes/docs', 'new')).toBe(false); expect(await model.trashEntry('/notes/docs')).toBe(false); model.pendingDrafts = [];
    const outside = open('/notes/docs-other/c.txt'); outside.resourceBase = '/notes/docs/a.md'; expect(await model.trashEntry('/notes/docs')).toBe(false);
    expect(gateway.renameEntry).not.toHaveBeenCalled(); expect(gateway.trashEntry).not.toHaveBeenCalled();
  });
  it('locks editors and competing file actions until rename finishes', async () => {
    const { model, gateway, open } = setup(); const b = open('/notes/docs/b.ts');
    let finish!: (path: string) => void; gateway.renameEntry.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const renaming = model.renameEntry('/notes/docs', 'new'); await vi.waitFor(() => expect(gateway.renameEntry).toHaveBeenCalled());
    b.source!.dispatch({ changes: { from: 0, insert: 'blocked' } }); expect(b.sourceText).not.toContain('blocked'); expect(await model.trashEntry('/notes/docs')).toBe(false);
    finish('/notes/new'); expect(await renaming).toBe(true); b.source!.dispatch({ changes: { from: 0, insert: 'allowed' } }); expect(b.sourceText).toContain('allowed');
  });
  it('aborts mutation before touching disk when pending draft persistence fails', async () => {
    const { model, gateway, storage, open } = setup(); await model.startReliability(); const tab = open('/notes/docs/b.ts'); tab.source!.dispatch({ changes: { from: 0, insert: 'draft' } });
    storage.writeDrafts.mockRejectedValue('no space'); expect(await model.renameEntry('/notes/docs', 'new')).toBe(false); expect(gateway.renameEntry).not.toHaveBeenCalled(); expect(tab.path).toBe('/notes/docs/b.ts');
  });
  it('refreshes filesystem and Windows drive roots using absolute parent paths after rename', async () => {
    for (const [root, source, target] of [['/', '/a.txt', '/b.txt'], ['C:\\', 'C:\\a.txt', 'C:\\b.txt']]) {
      const { model, gateway } = setup(); model.root = { path: root, name: root, entries: [] }; model.children = new Map([[root, []]]);
      model.openFile({ path: source, name: 'a.txt', content: 'keep' }); gateway.renameEntry.mockResolvedValueOnce(target);
      expect(await model.renameEntry(source, 'b.txt')).toBe(true); expect(gateway.listDirectory).toHaveBeenCalledWith(root, root);
    }
  });

});
