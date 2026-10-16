// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceModel } from '../src/workspace/model';
import type { WorkspaceSessionGateway, RestoredWorkspace, SavedWorkspace } from '../src/lib/workspaceSession';
import type { FileGateway } from '../src/lib/files';
const models: WorkspaceModel[] = [];
afterEach(() => { models.splice(0).forEach(model => model.dispose()); vi.useRealTimers(); });
const file = (path: string, content = '# 正文') => ({ path, name: path.split('/').pop()!, content });
const saved = (paths = ['/notes/a.md', '/notes/b.md'], activePath = paths[0] ?? null): SavedWorkspace => ({ version: 1, directory: '/notes', tabs: paths.map(path => ({ path, mode: 'document', reading: false })), activePath });
const restored = (session = saved()): RestoredWorkspace => ({ exists: true, session, root: { path: '/notes', name: 'notes', entries: [] }, tabs: session.tabs.map(tab => ({ ...tab, file: file(tab.path) })), errors: [] });
function setup(data = restored()) {
  const gateway: WorkspaceSessionGateway = { restore: vi.fn().mockResolvedValue(data), write: vi.fn().mockResolvedValue(undefined) };
  const files = { releaseDocument: vi.fn().mockResolvedValue(undefined), closeDirectory: vi.fn().mockResolvedValue(undefined), openDirectory: vi.fn().mockResolvedValue({ path:'/other',name:'other',entries:[] }), openDocument: vi.fn().mockResolvedValue(null), saveDocument: vi.fn().mockImplementation(async (path,content) => ({ ...file(path ?? '/notes/new.md'), content })) } as unknown as FileGateway;
  const model = new WorkspaceModel(files, undefined, undefined, gateway); model.addGuide('# 指南'); models.push(model);
  return { model, gateway, files };
}
it('restores directory, ordered saved tabs, active tab and reading/source modes cleanly', async () => {
  const state = saved(['/notes/a.md','/notes/b.md','/notes/c.ts'],'/notes/b.md'); state.tabs[0].reading=true; state.tabs[2].mode='source';
  const { model, gateway } = setup(restored(state)); await model.restoreSession();
  expect(model.root?.path).toBe('/notes'); expect(model.tabs.map(t => t.path)).toEqual(state.tabs.map(t => t.path)); expect(model.active?.path).toBe('/notes/b.md');
  expect(model.tabs[0].reading).toBe(true); expect(model.tabs[2].mode).toBe('source'); expect(model.tabs.every(t => !t.dirty)).toBe(true);
  expect(model.tabs[0].editor!.isEditable).toBe(false); expect(model.active!.editor!.isEditable).toBe(true);
  await model.flushSession(); expect(gateway.write).not.toHaveBeenCalled();
});
it('keeps the guide on first launch; records saved paths but never untitled contents', async () => {
  const { model,gateway }=setup({ ...restored(saved([])), exists:false }); await model.restoreSession(); expect(model.active?.guide).toBe(true);
  model.create(); await model.flushSession(); expect(gateway.write).not.toHaveBeenCalled();
  const a=model.openFile(file('/a.md')); model.create(); await model.flushSession();
  expect(gateway.write).toHaveBeenLastCalledWith({version:1,directory:null,tabs:[{path:'/a.md',mode:'document',reading:false}],activePath:a.path}, false);
});
it('persists tab activation without waiting for quit and does not write on every body edit', async () => {
  const { model,gateway }=setup(); await model.restoreSession(); vi.useFakeTimers();
  model.activate(model.tabs[1].id); await vi.advanceTimersByTimeAsync(250);
  expect(gateway.write).toHaveBeenLastCalledWith(expect.objectContaining({ activePath:'/notes/b.md' }),false);
  const count=vi.mocked(gateway.write).mock.calls.length;
  model.active!.editor!.commands.insertContent('未保存'); await vi.advanceTimersByTimeAsync(1200); expect(gateway.write).toHaveBeenCalledTimes(count);
});
it('window quit retains every saved tab and the active tab from before close confirmation', async () => {
  const { model,gateway,files }=setup(); await model.restoreSession(); const first=model.tabs[0], second=model.tabs[1];
  first.editor!.commands.insertContent('未保存'); model.activate(second.id);
  model.requestClose(model.tabs.map(t=>t.id),true); expect(model.activeId).toBe(first.id); model.approveClose();
  expect(await model.completeClose()).toBe(true);
  expect(model.tabs).toEqual([]); expect(files.releaseDocument).toHaveBeenCalledTimes(2);
  await new Promise(resolve=>setTimeout(resolve,250)); expect(gateway.write).toHaveBeenCalledTimes(1);
  expect(gateway.write).toHaveBeenLastCalledWith(saved(['/notes/a.md','/notes/b.md'],'/notes/b.md'),false);
});
it('closing a single tab persists removal; closing all tabs stores an empty workspace', async () => {
  const { model,gateway }=setup(); await model.restoreSession(); model.requestClose([model.tabs[0].id]); await model.completeClose();
  await model.flushSession(); expect(gateway.write).toHaveBeenLastCalledWith(expect.objectContaining({tabs:[{path:'/notes/b.md',mode:'document',reading:false}],activePath:'/notes/b.md'}),false);
  model.requestClose([model.tabs[0].id]); await model.completeClose(); await model.closeDirectory(); await model.flushSession();
  expect(gateway.write).toHaveBeenLastCalledWith({version:1,directory:null,tabs:[],activePath:null},false);
});
it('skips unavailable files, uses a surviving active tab and retains failure warnings until dismissed', async () => {
  const data=restored(); data.tabs=data.tabs.slice(1); data.root=null; data.errors=['文件恢复失败：a.md','目录恢复失败'];
  const { model,gateway }=setup(data); await model.restoreSession(); expect(model.active?.path).toBe('/notes/b.md'); expect(model.root).toBeNull(); expect(model.sessionWarnings).toHaveLength(2);
  model.dismissSessionWarnings(); await model.flushSession(); expect(gateway.write).not.toHaveBeenCalled();
});
it('failed/corrupt initial load never overwrites metadata; explicit rebuilding recovers it', async () => {
  const { model,gateway }=setup(); vi.mocked(gateway.restore).mockRejectedValue('记录损坏'); await model.restoreSession();
  model.openFile(file('/new.md')); expect(await model.flushSession()).toBe(false); expect(gateway.write).not.toHaveBeenCalled(); expect(model.sessionError).toContain('损坏');
  expect(await model.flushSession(undefined,true)).toBe(true); expect(model.sessionReady).toBe(true); expect(model.sessionError).toBe('');
});
it('write failure blocks quit and can be retried without deleting live tabs', async () => {
  const { model,gateway,files }=setup(); await model.restoreSession(); model.activate(model.tabs[1].id);
  vi.mocked(gateway.write).mockRejectedValueOnce('磁盘已满'); model.requestClose(model.tabs.map(t=>t.id),true);
  expect(await model.completeClose()).toBe(false); expect(model.tabs).toHaveLength(2); expect(files.releaseDocument).not.toHaveBeenCalled(); expect(model.sessionError).toContain('磁盘已满');
  expect(await model.flushSession()).toBe(true); model.requestClose(model.tabs.map(t=>t.id),true); expect(await model.completeClose()).toBe(true);
});
it('restoration disables user mutations and never applies late results after disposal', async () => {
  const { model,gateway }=setup(); let done!: (value:RestoredWorkspace)=>void;
  vi.mocked(gateway.restore).mockImplementation(()=>new Promise(resolve=>{done=resolve;})); const loading=model.restoreSession();
  expect(model.busy).toBe(true); expect(model.create()).toBeNull(); model.dispose(); done(restored()); await loading; expect(model.tabs).toHaveLength(1);
});
it('retrying restoration preserves an existing dirty editor and its undo stack', async () => {
  const { model }=setup(); await model.restoreSession(); const tab=model.tabs[0]; tab.editor!.commands.insertContent('草稿正文'); await model.restoreSession();
  expect(model.tabs[0]).toBe(tab); expect(model.markdown(tab)).toContain('草稿正文'); expect(tab.editor!.can().undo()).toBe(true); expect(tab.dirty).toBe(true);
});
it('first save and Save As replace session paths and preserve the chosen active document', async () => {
  const { model,gateway,files }=setup({ ...restored(saved([])),exists:false }); await model.restoreSession(); const tab=model.create()!;
  await model.save(tab.id); await model.flushSession(); expect(gateway.write).toHaveBeenLastCalledWith(expect.objectContaining({activePath:'/notes/new.md'}),false);
  vi.mocked(files.saveDocument).mockResolvedValue(file('/copy.md')); await model.save(tab.id,true); await model.flushSession();
  expect(gateway.write).toHaveBeenLastCalledWith(expect.objectContaining({tabs:[{path:'/copy.md',mode:'document',reading:false}],activePath:'/copy.md'}),false);
});

it('serializes writes so a slow earlier activation cannot overwrite a later one', async () => {
  const {model,gateway}=setup(); await model.restoreSession();
  let done!: ()=>void; vi.mocked(gateway.write).mockImplementationOnce(()=>new Promise(resolve=>{done=resolve;}));
  model.activate(model.tabs[1].id); const first=model.flushSession(); await Promise.resolve();
  model.activate(model.tabs[0].id); const second=model.flushSession();
  expect(gateway.write).toHaveBeenCalledTimes(1); done(); await first; await second;
  expect(gateway.write).toHaveBeenLastCalledWith(expect.objectContaining({activePath:'/notes/a.md'}),false);
});
it('cancelled close keeps live tabs, and a save failure does not change the remembered paths', async () => {
  const {model,gateway,files}=setup(); await model.restoreSession(); model.requestClose([model.tabs[0].id]); model.cancelClose();
  expect(model.tabs).toHaveLength(2); await model.flushSession(); expect(gateway.write).not.toHaveBeenCalled();
  vi.mocked(files.saveDocument).mockRejectedValue('写入失败'); expect(await model.save(model.tabs[0].id,true)).toBe(false);
  await model.flushSession(); expect(gateway.write).not.toHaveBeenCalled();
});

it('flushes pending changes before a restore retry, preserving the current directory and saved tabs', async () => {
  const {model,gateway}=setup(); await model.restoreSession(); model.openFile(file('/new.md'));
  let done!: ()=>void; vi.mocked(gateway.write).mockImplementationOnce(()=>new Promise(resolve=>{done=resolve;}));
  const retry=model.restoreSession(); await Promise.resolve();
  expect(gateway.restore).toHaveBeenCalledTimes(1); done(); await retry;
  expect(gateway.write).toHaveBeenCalledWith(expect.objectContaining({activePath:'/new.md'}),false);
  expect(gateway.restore).toHaveBeenLastCalledWith(false); expect(model.tabs.some(t=>t.path==='/new.md')).toBe(true);
});
