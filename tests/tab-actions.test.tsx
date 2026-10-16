// @vitest-environment jsdom
import { useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DocumentTabs from '../src/components/DocumentTabs';
import { WorkspaceModel } from '../src/workspace/model';
import { useSettings } from '../src/store/settings';
import type { Draft, ReliabilityGateway } from '../src/lib/reliability';
import type { FileGateway } from '../src/lib/files';
const models: WorkspaceModel[] = [];
beforeEach(() => { useSettings.setState({ markdownMode: 'document' }); HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); models.splice(0).forEach(model => model.dispose()); useSettings.setState({ markdownMode: 'document' }); });
function setup() {
  const releaseDocument = vi.fn().mockResolvedValue(undefined);
  const model = new WorkspaceModel({ releaseDocument } as unknown as FileGateway); models.push(model);
  const tabs = ['a', 'b', 'c'].map(name => model.openFile({ path: `/notes/${name}.md`, name: `${name}.md`, content: `# ${name}\n` }));
  const close = vi.fn((ids: string[]) => { model.requestClose(ids); if (!model.closeTarget) void model.completeClose(); });
  function Tabs() { useSyncExternalStore(model.subscribe, model.snapshot); return <DocumentTabs workspace={model} onClose={close} />; }
  render(<Tabs />);
  return { model, tabs, close, releaseDocument };
}
const menu = (name: string) => fireEvent.contextMenu(screen.getByRole('tab', { name: new RegExp(`^${name.replace('.', '\\.')}`) }), { clientX: 5000, clientY: 5000 });
it.each([
  ['关闭其他', ['b.md']], ['关闭左侧', ['b.md', 'c.md']], ['关闭右侧', ['a.md', 'b.md']], ['全部关闭', []], ['关闭已保存', []],
])('%s closes the correct snapshot relative to the right-clicked inactive tab', async (label, remaining) => {
  const { model, tabs, releaseDocument } = setup();
  expect(model.activeId).toBe(tabs[2].id);
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  fireEvent(screen.getByRole('tab', { name: 'b.md' }), event); expect(event.defaultPrevented).toBe(true);
  expect(model.activeId).toBe(tabs[2].id);
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['关闭其他', '关闭左侧', '关闭右侧', '全部关闭', '关闭已保存']);
  fireEvent.click(screen.getByRole('menuitem', { name: label }));
  await waitFor(() => expect(model.tabs.map(tab => tab.name)).toEqual(remaining));
  expect(releaseDocument).toHaveBeenCalledTimes(3 - remaining.length); expect(screen.queryByRole('menu')).toBeNull();
});
it('closes only clean tabs, including untitled clean tabs, and preserves dirty saved files', async () => {
  const { model, tabs } = setup();
  act(() => { model.activate(tabs[1].id); tabs[1].editor!.commands.insertContent('修改'); model.create('text'); });
  menu('b.md'); fireEvent.click(screen.getByRole('menuitem', { name: '关闭已保存' }));
  await waitFor(() => expect(model.tabs.map(tab => tab.id)).toEqual([tabs[1].id]));
  expect(tabs[1].dirty).toBe(true); expect(model.closing).toBeNull();
});
it('batch close waits for each dirty tab; cancel keeps every tab and discard follows the same plan', async () => {
  const { model, tabs, releaseDocument } = setup();
  act(() => { model.activate(tabs[0].id); tabs[0].editor!.commands.insertContent('甲'); model.activate(tabs[2].id); tabs[2].editor!.commands.insertContent('丙'); });
  menu('b.md'); fireEvent.click(screen.getByRole('menuitem', { name: '关闭其他' }));
  expect(model.closeTarget?.id).toBe(tabs[0].id); expect(releaseDocument).not.toHaveBeenCalled();
  act(() => model.cancelClose()); expect(model.tabs).toHaveLength(3);
  menu('b.md'); fireEvent.click(screen.getByRole('menuitem', { name: '关闭其他' }));
  act(() => model.approveClose()); expect(model.closeTarget?.id).toBe(tabs[2].id);
  await act(async () => { model.approveClose(); await model.completeClose(); });
  expect(model.tabs.map(tab => tab.name)).toEqual(['b.md']);
});
it('disables empty sides, supports keyboard navigation and dismisses on Escape or outside pointer', () => {
  const { model, tabs } = setup();
  menu('a.md'); expect((screen.getByRole('menuitem', { name: '关闭左侧' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' }); expect(document.activeElement?.textContent).toBe('关闭右侧');
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' }); expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'a.md' }));
  fireEvent.keyDown(screen.getByRole('tab', { name: 'c.md' }), { key: 'F10', shiftKey: true });
  expect((screen.getByRole('menuitem', { name: '关闭右侧' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.pointerDown(document.body); expect(screen.queryByRole('menu')).toBeNull();
  act(() => model.requestClose([tabs[0].id])); menu('b.md'); expect(screen.queryByRole('menu')).toBeNull();
});
it('shares all three modes across existing/new Markdown tabs, preserves edits and keeps text in source', () => {
  const { model, tabs } = setup();
  act(() => {
    model.activate(tabs[0].id); tabs[0].editor!.commands.insertContent('新增');
    model.selectMode('reading');
  });
  expect(tabs.every(tab => tab.mode === 'document' && tab.reading)).toBe(true);
  expect(tabs[0].dirty).toBe(true);
  act(() => { model.selectMode('source'); });
  expect(tabs.every(tab => tab.mode === 'source' && !tab.reading)).toBe(true);
  expect(model.markdown(tabs[0])).toContain('新增');
  act(() => {
    const opened = model.openFile({ path: '/new.md', name: 'new.md', content: '# 新文件' });
    expect(opened.mode).toBe('source');
    model.selectMode('document');
    expect(model.tabs.every(tab => tab.mode === 'document' && !tab.reading)).toBe(true);
    model.create('text'); expect(model.active!.mode).toBe('source');
    expect(model.selectMode('reading')).toBe(false);
    expect(useSettings.getState().markdownMode).toBe('document');
  });
});
it('persists the shared mode across store rehydration and new workspaces', async () => {
  const { model } = setup();
  act(() => { model.selectMode('reading'); });
  const saved = localStorage.getItem('minmd-appearance')!;
  expect(JSON.parse(saved).state.markdownMode).toBe('reading');
  useSettings.setState({ markdownMode: 'document' }); localStorage.setItem('minmd-appearance', saved);
  await act(async () => { await useSettings.persist.rehydrate(); });
  const next = new WorkspaceModel(); models.push(next);
  const tab = next.create()!; expect(tab.reading).toBe(true); expect(tab.editor!.isEditable).toBe(false);
});
it('keeps unsupported Markdown in source and rejects unsafe mode selection without changing the shared preference', () => {
  const { model, tabs } = setup();
  act(() => {
    model.selectMode('source');
    const unsupported = model.openFile({ path: '/footnote.md', name: 'footnote.md', content: '文字[^1]\n\n[^1]: 注释\n' });
    expect(model.selectMode('document')).toBe(false); expect(useSettings.getState().markdownMode).toBe('source');
    model.activate(tabs[0].id); model.selectMode('reading');
    expect(unsupported.mode).toBe('document'); expect(unsupported.reading).toBe(true); expect(tabs.every(tab => tab.reading)).toBe(true);
    expect(model.markdown(unsupported)).toBe(unsupported.raw);
  });
});

it.each(['source', 'reading'] as const)('restores dirty Markdown drafts using the shared %s view without replacing their contents', async preferred => {
  useSettings.setState({ markdownMode: preferred });
  const draft: Draft = { id: 'draft-mode', path: null, name: '恢复.md', resourceBase: null, raw: '# 原文\n', content: '# 恢复正文\n\n未保存', mode: preferred === 'source' ? 'document' : 'source', authority: 'source', updatedAt: 100, selection: 2, scrollTop: 0 };
  const storage = { loadDrafts: vi.fn().mockResolvedValue([draft]), authorizeDraft: vi.fn().mockResolvedValue(null), writeDrafts: vi.fn().mockResolvedValue(undefined), watchDocuments: vi.fn().mockResolvedValue(undefined), onDiskChange: vi.fn().mockResolvedValue(() => {}), checkDocuments: vi.fn().mockResolvedValue([]) } satisfies ReliabilityGateway;
  const model = new WorkspaceModel(undefined, storage); models.push(model);
  await model.startReliability(); await model.recoverDraft(draft.id);
  expect(model.active!.mode).toBe(preferred === 'source' ? 'source' : 'document');
  expect(model.active!.reading).toBe(preferred === 'reading'); expect(model.active!.dirty).toBe(true);
  expect(model.markdown(model.active!)).toBe(draft.content); expect(model.pendingDrafts).toEqual([]);
  expect(useSettings.getState().markdownMode).toBe(preferred);
});
