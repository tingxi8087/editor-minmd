// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceModel } from '../src/workspace/model';
import { rebaseReference } from '../src/lib/resources';
import { files } from '../src/lib/files';
import type { Draft, DiskSnapshot, ReliabilityGateway } from '../src/lib/reliability';
const models: WorkspaceModel[] = [];
const file = (name = 'A', content = '# 原文\n\n正文') => ({ path: `/笔记/${name}.md`, name: `${name}.md`, content });
const draft = (id = 'old'): Draft => ({ id, name: 'A.md', path: '/笔记/A.md', resourceBase: '/笔记/A.md', raw: '# 原文\n\n正文', content: '# 恢复的内容\n\n未保存', updatedAt: 100, selection: 3, scrollTop: 120 });
function setup(initial: Draft[] = []) {
  let saved = structuredClone(initial); let callback = () => {};
  const disk = new Map<string, DiskSnapshot>();
  const storage = {
    loadDrafts: vi.fn<ReliabilityGateway['loadDrafts']>().mockImplementation(async () => structuredClone(saved)),
    writeDrafts: vi.fn<ReliabilityGateway['writeDrafts']>().mockImplementation(async drafts => { saved = structuredClone(drafts); }),
    authorizeDraft: vi.fn<ReliabilityGateway['authorizeDraft']>().mockImplementation(async id => { const d = saved.find(d => d.id === id)!; return d.path ? disk.get(d.path) ?? { path: d.path, kind: 'present', content: d.raw } : null; }),
    checkDocuments: vi.fn<ReliabilityGateway['checkDocuments']>().mockImplementation(async paths => paths.flatMap(path => disk.has(path) ? [disk.get(path)!] : [])),
    watchDocuments: vi.fn<ReliabilityGateway['watchDocuments']>().mockResolvedValue(undefined),
    onDiskChange: vi.fn<ReliabilityGateway['onDiskChange']>().mockImplementation(async cb => { callback = cb; return () => { callback = () => {}; }; }),
  };
  const gateway = { ...files,
    saveDocument: vi.fn<typeof files.saveDocument>().mockImplementation(async (path, content, _raw, as) => ({ path: as || !path ? '/新目录/副本.md' : path, name: as || !path ? '副本.md' : 'A.md', content })),
    releaseDocument: vi.fn<typeof files.releaseDocument>().mockResolvedValue(undefined),
    loadImage: vi.fn<typeof files.loadImage>().mockResolvedValue('data:image/png;base64,x'),
  };
  const make = () => { const model = new WorkspaceModel(gateway, storage); models.push(model); return model; };
  const model = make();
  return { model, make, gateway, storage, disk, saved: () => saved, event: () => callback() };
}
const edit = (model: WorkspaceModel, text = '本地修改') => { const editor = model.active!.editor!; editor.commands.insertContentAt(editor.state.doc.content.size - 1, text); };
beforeEach(() => { vi.useFakeTimers(); HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { models.forEach(model => model.dispose()); models.length = 0; vi.useRealTimers(); });

describe('durable draft recovery', () => {
  it('debounces writes, captures the latest input and does not touch original files', async () => {
    const { model, storage, gateway, saved } = setup(); await model.startReliability(); const tab = model.openFile(file());
    edit(model, '一'); await vi.advanceTimersByTimeAsync(400); edit(model, '二');
    expect(storage.writeDrafts).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(650);
    expect(saved()).toHaveLength(1); expect(saved()[0].raw).toBe(file().content); expect(saved()[0].content).toContain('一二');
    expect(saved()[0].path).toBe(tab.path); expect(gateway.saveDocument).not.toHaveBeenCalled();
  });
  it('protects continuous typing within the max-wait interval', async () => {
    const { model, storage } = setup(); await model.startReliability(); model.create();
    for (let i = 0; i < 8; i++) { edit(model, String(i)); await vi.advanceTimersByTimeAsync(400); }
    expect(storage.writeDrafts).toHaveBeenCalled();
    expect(storage.writeDrafts.mock.calls[0][0][0].content).toContain('01234567');
  });
  it('restores named and untitled drafts after a simulated crash, keeping baseline, cursor and scroll', async () => {
    const { model, make, saved, gateway } = setup(); await model.startReliability();
    model.openFile(file()); edit(model); const a = model.active!; a.scrollTop = 220; a.editor!.commands.setTextSelection(3);
    model.create(); edit(model, '未命名内容'); await model.flushDrafts(); expect(saved()).toHaveLength(2); model.dispose();
    const next = make(); await next.startReliability(); expect(next.tabs).toHaveLength(0); expect(next.pendingDrafts).toHaveLength(2);
    await next.recoverDraft(a.draftId); const restored = next.active!;
    expect(restored.path).toBe(a.path); expect(restored.dirty).toBe(true); expect(restored.raw).toBe(file().content);
    expect(restored.scrollTop).toBe(220); expect(restored.editor!.state.selection.from).toBe(3); expect(next.markdown(restored)).toContain('本地修改');
    expect(restored.editor!.can().undo()).toBe(false); expect(gateway.saveDocument).not.toHaveBeenCalled();
    await next.recoverDraft(next.pendingDrafts[0].id); expect(next.active!.path).toBeNull(); expect(next.markdown(next.active!)).toContain('未命名内容');
  });
  it('restores the exact structured document including empty headings, tasks and image attributes', async () => {
    const { model, make, saved } = setup(); await model.startReliability(); const tab = model.openFile(file('JSON', '# 标题\n\n![中文图](assets/图.png)\n\n- [x] 完成\n'));
    tab.editor!.commands.insertContentAt(tab.editor!.state.doc.content.size, [{ type: 'heading', attrs: { level: 2 } }, { type: 'paragraph' }]);
    const expected = tab.editor!.getJSON(); await model.flushDrafts(); expect(saved()[0].document).toEqual(expected); model.dispose();
    const next = make(); await next.startReliability(); await next.recoverDraft(tab.draftId);
    expect(next.active!.editor!.getJSON()).toEqual(expected); expect(next.active!.dirty).toBe(true);
  });
  it('recovers normalized image references after cross-directory Save As without using the old resource base', async () => {
    const { model, make, gateway, saved } = setup(); await model.startReliability();
    const tab = model.openFile(file('图文', '# 图文\n\n![图片](assets/a.png)\n')); edit(model);
    gateway.saveDocument.mockImplementationOnce(async (_path, content, _expected, _as, _protected, resources) => {
      for (const reference of resources?.references ?? []) content = content.replace(reference.token, rebaseReference(reference.value, resources!.basePath, '/新目录/副本.md'));
      return { path: '/新目录/副本.md', name: '副本.md', content };
    });
    await model.save(tab.id, true); edit(model, '另存后编辑'); await model.flushDrafts();
    const record = saved()[0]; expect(record.resourceBase).toBe('/新目录/副本.md'); expect(record.content).toContain('../%E7%AC%94%E8%AE%B0/assets/a.png'); model.dispose();
    const next = make(); await next.startReliability(); await next.recoverDraft(record.id);
    expect(next.active!.resourceBase).toBe('/新目录/副本.md');
    expect(gateway.loadImage).toHaveBeenLastCalledWith('/新目录/副本.md', '../%E7%AC%94%E8%AE%B0/assets/a.png');
    expect(next.markdown(next.active!)).toContain('另存后编辑');
  });
  it('retains unresolved old drafts while editing, saving and closing new tabs', async () => {
    const { model, saved } = setup([draft()]); await model.startReliability(); const tab = model.create()!; edit(model, '新草稿'); await model.flushDrafts();
    expect(saved()).toHaveLength(2); await model.save(tab.id); expect(saved().map(d => d.id)).toEqual(['old']);
    model.requestClose([tab.id]); await model.completeClose(); expect(saved().map(d => d.id)).toEqual(['old']);
  });
  it('recovers into a separate unsaved copy when the original path is already open', async () => {
    const { model } = setup([draft()]); await model.startReliability(); const original = model.openFile(file()); edit(model, '当前未保存');
    await model.recoverDraft('old'); expect(model.tabs).toHaveLength(2); expect(model.active!.path).toBeNull();
    expect(model.active!.resourceBase).toBe(original.path); expect(model.markdown(original)).toContain('当前未保存');
    expect(model.markdown(model.active!)).toContain('恢复的内容');
  });
  it('marks recovered content as conflicted when disk changed or was deleted', async () => {
    for (const state of [{ kind: 'present', content: '# 外部新版本' }, { kind: 'missing' }] as const) {
      const { model, disk, gateway } = setup([draft()]); disk.set('/笔记/A.md', { path: '/笔记/A.md', ...state });
      await model.startReliability(); await model.recoverDraft('old'); expect(model.active!.external?.kind).toBe(state.kind);
      expect(model.markdown(model.active!)).toContain('恢复的内容'); expect(await model.save(model.active!.id)).toBe(false); expect(gateway.saveDocument).not.toHaveBeenCalled();
    }
  });
  it('does not overwrite unreadable recovery data, and retry can enable protection', async () => {
    const { model, storage } = setup(); storage.loadDrafts.mockRejectedValueOnce('恢复文件损坏'); await model.startReliability();
    model.create(); edit(model); await model.flushDrafts(); expect(storage.writeDrafts).not.toHaveBeenCalled(); expect(model.recoveryError).toContain('损坏');
    await model.loadRecovery(); await model.flushDrafts(); expect(model.recoveryReady).toBe(true); expect(storage.writeDrafts).toHaveBeenCalled();
  });
  it('keeps drafts on failed writes and successful retry clears the error', async () => {
    const { model, storage, saved } = setup([draft()]); await model.startReliability(); storage.writeDrafts.mockRejectedValueOnce('disk full');
    await model.discardDraft('old'); expect(model.pendingDrafts).toHaveLength(1); expect(model.recoveryError).toContain('disk full');
    await model.discardDraft('old'); expect(model.pendingDrafts).toHaveLength(0); expect(saved()).toHaveLength(0); expect(model.recoveryError).toBe('');
  });
  it('serializes concurrent writes so an older snapshot cannot replace newer edits', async () => {
    const { model, storage, saved } = setup(); await model.startReliability(); model.create(); edit(model, '版本一');
    let resolve!: () => void; storage.writeDrafts.mockImplementationOnce(() => new Promise<void>(r => { resolve = r; }));
    const first = model.flushDrafts(); await Promise.resolve(); edit(model, '版本二'); const second = model.flushDrafts();
    expect(storage.writeDrafts).toHaveBeenCalledTimes(1); resolve(); await first; expect(model.active!.protectedDraftVersion).not.toBe(model.active!.draftVersion); await second;
    expect(model.active!.protectedDraftVersion).toBe(model.active!.draftVersion);
    expect(saved()[0].content).toContain('版本一版本二'); expect(storage.writeDrafts).toHaveBeenCalledTimes(2);
  });
  it('keeps a cancelled close recoverable, prunes only after explicit discard and blocks close on persistence failure', async () => {
    const { model, saved, storage } = setup(); await model.startReliability(); const tab = model.create()!; edit(model);
    model.requestClose([tab.id], true); model.cancelClose(); await model.flushDrafts(); expect(saved()).toHaveLength(1);
    model.requestClose([tab.id], true); model.approveClose(); await model.flushDrafts();
    storage.writeDrafts.mockRejectedValueOnce('full'); expect(await model.completeClose()).toBe(false); expect(model.tabs).toHaveLength(1);
    model.requestClose([tab.id], true); model.approveClose(); expect(await model.completeClose()).toBe(true); expect(saved()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(3000); expect(saved()).toHaveLength(0);
  });
  it('flushes on blur and stops pending timers and listeners on dispose', async () => {
    const { model, storage, event } = setup(); await model.startReliability(); model.create(); edit(model);
    window.dispatchEvent(new Event('blur')); await Promise.resolve(); await model.flushDrafts(); expect(storage.writeDrafts).toHaveBeenCalled();
    const count = storage.writeDrafts.mock.calls.length; const checks = storage.checkDocuments.mock.calls.length;
    edit(model, 'later'); model.dispose(); event(); window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(20000);
    expect(storage.writeDrafts).toHaveBeenCalledTimes(count); expect(storage.checkDocuments).toHaveBeenCalledTimes(checks);
  });
});

describe('external file changes', () => {
  it('auto-reloads clean files, resets only their history and preserves each tab selection/scroll/read mode', async () => {
    const { model, disk } = setup(); await model.startReliability(); const a = model.openFile(file());
    a.scrollTop = 180; a.editor!.commands.setTextSelection(3); model.setReading(true);
    const b = model.openFile(file('B')); edit(model, 'B修改'); const editorB = b.editor;
    const old = a.editor!; disk.set(a.path!, { path: a.path!, kind: 'present', content: '# 外部新标题\n\n新正文' }); await model.checkDisk();
    expect(old.isDestroyed).toBe(true); expect(a.dirty).toBe(false); expect(a.raw).toContain('外部新标题'); expect(a.scrollTop).toBe(180);
    expect(a.reading).toBe(true); expect(a.editor!.state.selection.from).toBe(3); expect(b.editor).toBe(editorB); expect(b.dirty).toBe(true);
    expect(model.activeId).toBe(b.id); expect(a.editor!.can().undo()).toBe(false);
  });
  it('preserves dirty content and blocks ordinary saves but allows Save As', async () => {
    const { model, disk, gateway } = setup(); await model.startReliability(); const tab = model.openFile(file()); edit(model);
    disk.set(tab.path!, { path: tab.path!, kind: 'present', content: '# 外部修改' }); await model.checkDisk();
    expect(model.markdown(tab)).toContain('本地修改'); expect(tab.raw).toBe(file().content); expect(tab.external?.content).toContain('外部修改');
    expect(await model.save(tab.id)).toBe(false); expect(gateway.saveDocument).not.toHaveBeenCalled();
    expect(await model.save(tab.id, true)).toBe(true); expect(tab.external).toBeNull(); expect(tab.path).toBe('/新目录/副本.md');
  });
  it('does not treat its own save event as an external update or reset undo', async () => {
    const { model, disk, event } = setup(); await model.startReliability(); const tab = model.openFile(file()); edit(model); await model.save(tab.id);
    const editor = tab.editor; disk.set(tab.path!, { path: tab.path!, kind: 'present', content: tab.raw }); event(); await vi.advanceTimersByTimeAsync(350);
    expect(tab.editor).toBe(editor); expect(tab.external).toBeNull(); expect(tab.editor!.can().undo()).toBe(true);
  });
  it('retains deleted or unreadable files, detects recreation and updates when clean', async () => {
    const { model, disk, gateway } = setup(); await model.startReliability(); const tab = model.openFile(file());
    for (const kind of ['missing', 'error'] as const) {
      disk.set(tab.path!, { path: tab.path!, kind, message: '读取失败' }); await model.checkDisk();
      expect(tab.external?.kind).toBe(kind); expect(model.tabs).toHaveLength(1); expect(model.markdown(tab)).toBe(file().content);
      expect(await model.save(tab.id)).toBe(false); expect(gateway.saveDocument).not.toHaveBeenCalled();
    }
    disk.set(tab.path!, { path: tab.path!, kind: 'present', content: '# 重新创建' }); await model.checkDisk();
    expect(tab.raw).toBe('# 重新创建'); expect(tab.external).toBeNull();
  });
  it('re-reads current disk contents after confirmation and never overwrites the file', async () => {
    const { model, disk, gateway, saved } = setup(); await model.startReliability(); const tab = model.openFile(file()); edit(model); await model.flushDrafts();
    disk.set(tab.path!, { path: tab.path!, kind: 'present', content: '# 第一版' }); await model.checkDisk();
    disk.set(tab.path!, { path: tab.path!, kind: 'present', content: '# 最新版' }); expect(await model.reloadDisk(tab.id)).toBe(true);
    expect(tab.raw).toBe('# 最新版'); expect(tab.dirty).toBe(false); expect(saved()).toHaveLength(0); expect(gateway.saveDocument).not.toHaveBeenCalled();
  });
  it('keeps dirty content if removing its recovery record fails during reload', async () => {
    const { model, disk, storage } = setup(); await model.startReliability(); const tab = model.openFile(file()); edit(model); await model.flushDrafts();
    disk.set(tab.path!, { path: tab.path!, kind: 'present', content: '# 外部版本' });
    storage.writeDrafts.mockRejectedValueOnce('无法更新恢复文件');
    expect(await model.reloadDisk(tab.id)).toBe(false); expect(tab.dirty).toBe(true);
    expect(model.markdown(tab)).toContain('本地修改'); expect(model.recoveryError).toContain('无法更新');
  });
  it('restored untitled documents retain their newline convention and get unique names', async () => {
    const { model } = setup([{ ...draft(), path: null, resourceBase: null, name: '未命名.md', raw: '', content: '恢复正文\n' }]);
    await model.startReliability(); await model.recoverDraft('old');
    expect(model.markdown(model.active!)).toBe('恢复正文\n'); model.create(); expect(model.active!.name).toBe('未命名 2.md');
  });
  it('keeps local content if the file disappears while the reload confirmation is open', async () => {
    const { model, disk } = setup(); await model.startReliability(); const tab = model.openFile(file()); edit(model);
    disk.set(tab.path!, { path: tab.path!, kind: 'missing' }); expect(await model.reloadDisk(tab.id)).toBe(false);
    expect(tab.dirty).toBe(true); expect(model.markdown(tab)).toContain('本地修改');
  });
  it('protects unsupported new disk syntax and can return to WYSIWYG on later valid changes', async () => {
    const { model, disk } = setup(); await model.startReliability(); const tab = model.openFile(file());
    disk.set(tab.path!, { path: tab.path!, kind: 'present', content: '<!-- keep -->' }); await model.checkDisk();
    expect(tab.unsupported).toBe('内嵌 HTML'); expect(tab.editor).toBeNull(); expect(tab.raw).toBe('<!-- keep -->');
    disk.set(tab.path!, { path: tab.path!, kind: 'present', content: '# 普通文档' }); await model.checkDisk(); expect(tab.editor).not.toBeNull();
  });
  it('does not apply stale disk reads after saving or closing the original tab', async () => {
    const { model, storage } = setup(); await model.startReliability(); const tab = model.openFile(file()); edit(model);
    let resolve!: (snapshots: DiskSnapshot[]) => void;
    storage.checkDocuments.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const checking = model.checkDisk(); await model.save(tab.id); resolve([{ path: tab.path!, kind: 'present', content: '# 旧读数' }]); await checking;
    expect(tab.raw).toContain('本地修改'); expect(tab.external).toBeNull();
    storage.checkDocuments.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const next = model.checkDisk(); model.requestClose([tab.id]); await model.completeClose(); resolve([{ path: tab.path!, kind: 'present', content: '# 旧读数' }]); await next;
    expect(model.tabs).toHaveLength(0);
  });
  it('preserves edits made while a disk read is pending', async () => {
    const { model, storage } = setup(); await model.startReliability(); const tab = model.openFile(file());
    let resolve!: (snapshots: DiskSnapshot[]) => void; storage.checkDocuments.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const checking = model.checkDisk(); edit(model); resolve([{ path: tab.path!, kind: 'present', content: '# 外部版本' }]); await checking;
    expect(model.markdown(tab)).toContain('本地修改'); expect(tab.external?.content).toBe('# 外部版本');
  });
  it('clears transient disk check failures and retries a failed event subscription', async () => {
    const { model, storage, disk } = setup(); storage.onDiskChange.mockRejectedValueOnce('event failed'); await model.startReliability();
    const tab = model.openFile(file()); storage.checkDocuments.mockRejectedValueOnce('temporary failure'); await model.checkDisk();
    expect(model.checkError).toContain('temporary failure');
    disk.set(tab.path!, { path: tab.path!, kind: 'present', content: '# 成功重试' }); await model.checkDisk();
    expect(model.listenerError).toBe(''); expect(storage.onDiskChange).toHaveBeenCalledTimes(2); expect(model.checkError).toBe(''); expect(tab.raw).toBe('# 成功重试');
  });
  it('checks on native notifications, focus and periodic fallback, while watcher failures remain visible', async () => {
    const { model, storage, disk, event } = setup(); storage.watchDocuments.mockRejectedValueOnce('watch unavailable'); await model.startReliability();
    const tab = model.openFile(file()); disk.set(tab.path!, { path: tab.path!, kind: 'present', content: '# 通知刷新' });
    event(); event(); await vi.advanceTimersByTimeAsync(350); expect(tab.raw).toBe('# 通知刷新');
    disk.set(tab.path!, { path: tab.path!, kind: 'present', content: '# 焦点刷新' }); window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(350);
    expect(tab.raw).toBe('# 焦点刷新');
    disk.set(tab.path!, { path: tab.path!, kind: 'present', content: '# 定时刷新' }); await vi.advanceTimersByTimeAsync(15000); expect(tab.raw).toBe('# 定时刷新');
  });
});
