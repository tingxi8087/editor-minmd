// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { RecentModel, type RecentGateway } from '../src/lib/recents';
import { WorkspaceModel } from '../src/workspace/model';
import type { FileGateway } from '../src/lib/files';
const models: WorkspaceModel[] = [];
afterEach(() => { models.splice(0).forEach(model => model.dispose()); });
const empty = () => ({ files: [], directories: [] });
function setup() {
  const gateway: RecentGateway = {
    load: vi.fn().mockResolvedValue(empty()), record: vi.fn().mockResolvedValue(empty()),
    remove: vi.fn().mockResolvedValue(empty()), clear: vi.fn().mockResolvedValue(empty()),
    openFile: vi.fn().mockResolvedValue({ path: '/notes/a.md', name: 'a.md', content: '# A' }),
    openDirectory: vi.fn().mockResolvedValue({ path: '/notes', name: 'notes', entries: [] }),
  };
  const recent = new RecentModel(gateway);
  const files = { openDocument: vi.fn().mockResolvedValue(null), openDirectory: vi.fn().mockResolvedValue(null), saveDocument: vi.fn().mockResolvedValue(null) } as unknown as FileGateway;
  const model = new WorkspaceModel(files, undefined, recent); models.push(model);
  return { recent, gateway, model, files };
}
it('serializes initial load and writes, with the newest result winning', async () => {
  const { recent, gateway } = setup();
  let resolve!: (value: ReturnType<typeof empty>) => void;
  vi.mocked(gateway.load).mockImplementation(() => new Promise(done => { resolve = done; }));
  vi.mocked(gateway.record).mockResolvedValue({ files: [{ path: '/a', name: 'a' }], directories: [] });
  const loading = recent.load(); const writing = recent.record('/a', false);
  await Promise.resolve(); expect(gateway.record).not.toHaveBeenCalled(); expect(recent.busy).toBe(true);
  resolve(empty()); await loading; await writing;
  expect(recent.files[0].path).toBe('/a'); expect(recent.busy).toBe(false);
});
it('retains known entries on storage failure and permits clearing recovery', async () => {
  const { recent, gateway } = setup();
  vi.mocked(gateway.load).mockResolvedValueOnce({ files: [{ path: '/a', name: 'a' }], directories: [] }).mockRejectedValueOnce('损坏');
  await recent.load(); expect(await recent.load()).toBe(false); expect(recent.files).toHaveLength(1); expect(recent.error).toContain('损坏');
  await recent.clear(); expect(recent.files).toEqual([]); expect(recent.error).toBe('');
});
it('records only successful file opens and accepted directories, excluding cancelled dialogs and guide/drafts', async () => {
  const { model, gateway } = setup(); model.addGuide('# guide'); model.create();
  await model.chooseFile(); await model.chooseDirectory(); expect(gateway.record).not.toHaveBeenCalled();
  model.openFile({ path: '/notes/a.md', name: 'a.md', content: '# A' }); await Promise.resolve();
  expect(gateway.record).toHaveBeenCalledWith('/notes/a.md', false);
  await model.openRecent('/notes', true); await Promise.resolve(); await Promise.resolve();
  expect(gateway.record).toHaveBeenCalledWith('/notes', true);
});
it('activates an existing dirty tab without reading disk or losing undo', async () => {
  const { model, gateway } = setup(); const tab = model.openFile({ path: '/notes/a.md', name: 'a.md', content: '# A' });
  tab.editor!.commands.insertContent('未保存'); model.create();
  expect(await model.openRecent('/notes/a.md', false)).toBe(true);
  expect(gateway.openFile).not.toHaveBeenCalled(); expect(model.active).toBe(tab); expect(tab.dirty).toBe(true);
  expect(model.markdown(tab)).toContain('未保存'); expect(tab.editor!.can().undo()).toBe(true);
});
it('reopens saved files and directories without replacing other unsaved tabs', async () => {
  const { model, gateway } = setup(); const draft = model.create()!; draft.editor!.commands.insertContent('草稿');
  expect(await model.openRecent('/notes/a.md', false)).toBe(true); expect(gateway.openFile).toHaveBeenCalledWith('/notes/a.md');
  expect(await model.openRecent('/notes', true)).toBe(true); expect(model.root?.path).toBe('/notes'); expect(model.tabs).toContain(draft); expect(draft.dirty).toBe(true);
});
it('keeps workspace and records on failed reopening; blocks duplicate and closing operations', async () => {
  const { model, recent, gateway } = setup(); await model.openRecent('/notes', true);
  vi.mocked(gateway.openDirectory).mockRejectedValue('目录不存在');
  expect(await model.openRecent('/missing', true)).toBe(false); expect(model.root?.path).toBe('/notes'); expect(recent.error).toContain('目录不存在');
  vi.mocked(gateway.openFile).mockRejectedValue('文件不存在');
  expect(await model.openRecent('/missing', false)).toBe(false); expect(recent.error).toContain('文件不存在');
  model.busy = true; expect(await model.openRecent('/notes', true)).toBe(false);
});
it('history persistence failure never prevents a successful document open', async () => {
  const { model, recent, gateway } = setup(); vi.mocked(gateway.record).mockRejectedValue('磁盘已满');
  expect(await model.openRecent('/notes/a.md', false)).toBe(true);
  await recent.load(); expect(model.active?.path).toBe('/notes/a.md'); expect(model.error).toBe('');
});
it('records first save and Save As, but not a cancelled save', async () => {
  const { model, files, gateway, recent } = setup(); const tab = model.create()!;
  await model.save(tab.id); expect(gateway.record).not.toHaveBeenCalled();
  vi.mocked(files.saveDocument).mockResolvedValue({ path: '/notes/saved.md', name: 'saved.md', content: '' });
  expect(await model.save(tab.id)).toBe(true); await recent.load(); expect(gateway.record).toHaveBeenCalledWith('/notes/saved.md', false);
  vi.mocked(files.saveDocument).mockResolvedValue({ path: '/notes/copy.md', name: 'copy.md', content: '' });
  expect(await model.save(tab.id, true)).toBe(true); await recent.load(); expect(gateway.record).toHaveBeenCalledWith('/notes/copy.md', false);
});
