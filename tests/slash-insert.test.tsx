// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigProvider } from 'paper-ink';
import SlashInsert, { type SlashInsertRequest } from '../src/components/SlashInsert';
import { WorkspaceModel } from '../src/workspace/model';
import { files } from '../src/lib/files';
vi.mock('../src/lib/files', async original => ({ ...(await original<typeof import('../src/lib/files')>()), files: { ...(await original<typeof import('../src/lib/files')>()).files, chooseMarkdownReference: vi.fn() } }));
class TestResizeObserver { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal('ResizeObserver', TestResizeObserver);
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
const models: WorkspaceModel[] = [];
function setup(kind: SlashInsertRequest['kind'], saved = true) {
  const model = new WorkspaceModel(); models.push(model);
  const tab = saved ? model.openFile({ path: '/notes/current.md', name: 'current.md', content: '/query' }) : model.create()!;
  if (!saved) tab.editor!.commands.setContent('/query', { contentType: 'markdown' });
  tab.editor!.commands.setTextSelection({ from: 1, to: 7 });
  const closed = vi.fn();
  function Harness() { const [request, setRequest] = useState<SlashInsertRequest | null>({ id: tab.id, kind, from: 1, to: 7 }); return <ConfigProvider><SlashInsert workspace={model} request={request} onClose={() => { closed(); setRequest(null); }} /></ConfigProvider>; }
  render(<Harness />);
  return { model, tab, closed, user: userEvent.setup() };
}
beforeEach(() => { localStorage.clear(); vi.mocked(files.chooseMarkdownReference).mockReset(); HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); models.forEach(model => model.dispose()); models.length = 0; });

describe('slash inline insert dialogs', () => {
  it('searches Chinese emoji, replaces query atomically, remembers recent and round trips as ordinary text', async () => {
    const { model, tab, user } = setup('emoji');
    await user.type(screen.getByRole('textbox', { name: '搜索表情' }), '灵感');
    await user.click(screen.getByRole('button', { name: '灵感 💡' }));
    expect(model.markdown(tab)).toBe('💡');
    expect(localStorage.getItem('minmd.recent-emoji')).toContain('💡');
    const loaded = model.openFile({ path: '/notes/reloaded.md', name: 'reloaded.md', content: model.markdown(tab) });
    expect(loaded.editor!.getText()).toBe('💡');
    act(() => { model.activate(tab.id); tab.editor!.commands.undo(); });
    expect(model.markdown(tab)).toBe('/query');
    act(() => { tab.editor!.commands.redo(); }); expect(model.markdown(tab)).toBe('💡');
  });
  it('cancels without changing source or selected query and ignores mask clicks', async () => {
    const { model, tab, user } = setup('link');
    const mask = document.querySelector('.pi-modal-wrap')!;
    expect(mask).toBeTruthy(); await user.click(mask);
    expect(screen.getByRole('textbox', { name: '插入链接地址' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(model.markdown(tab)).toBe('/query');
    expect(tab.editor!.state.selection.from).toBe(1); expect(tab.editor!.state.selection.to).toBe(7);
    expect(tab.dirty).toBe(false);
  });
  it('undo restores a freshly typed slash query without merging insertion into typing history', async () => {
    const model = new WorkspaceModel(); models.push(model); const tab = model.create()!;
    tab.editor!.commands.insertContent('/date');
    function Harness() { const [request, setRequest] = useState<SlashInsertRequest | null>({ id: tab.id, kind: 'date', from: 1, to: 6 }); return <ConfigProvider><SlashInsert workspace={model} request={request} onClose={() => setRequest(null)} /></ConfigProvider>; }
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-10-16' } });
    await userEvent.click(screen.getByRole('button', { name: '插入' }));
    expect(tab.editor!.getText()).toBe('2026-10-16');
    act(() => { tab.editor!.commands.undo(); }); expect(tab.editor!.getText()).toBe('/date');
    act(() => { tab.editor!.commands.undo(); }); expect(tab.editor!.getText()).toBe('');
  });
  it('inserts the chosen local date as plain YYYY-MM-DD text and ignores composing Enter', async () => {
    const { model, tab, user } = setup('date');
    const date = screen.getByLabelText('日期');
    fireEvent.change(date, { target: { value: '2026-10-16' } });
    fireEvent.keyDown(date, { key: 'Enter', isComposing: true, keyCode: 229 });
    expect(model.markdown(tab)).toBe('/query');
    await user.click(screen.getByRole('button', { name: '插入' })); expect(model.markdown(tab)).toBe('2026-10-16');
  });
  it('rejects unsafe links and inserts a standard Markdown relative link', async () => {
    const { model, tab, user } = setup('link');
    await user.type(screen.getByRole('textbox', { name: '链接显示文字' }), '另一个文档');
    const input = screen.getByRole('textbox', { name: '插入链接地址' });
    await user.type(input, 'javascript:alert(1)'); await user.click(screen.getByRole('button', { name: '插入' }));
    expect(screen.getByRole('alert').textContent).toContain('网页地址'); expect(model.markdown(tab)).toBe('/query');
    await user.clear(input); await user.type(input, '../docs/笔记.md'); await user.click(screen.getByRole('button', { name: '插入' }));
    expect(model.markdown(tab)).toBe('[另一个文档](../docs/笔记.md)');
    const reopened = model.openFile({ path: '/notes/new.md', name: 'new.md', content: model.markdown(tab) });
    expect(reopened.editor!.getJSON().content?.[0].content?.[0].marks?.[0].attrs?.href).toBe('../docs/笔记.md');
  });
  it('keeps slash text after chooser cancel, then inserts a standard local Markdown reference', async () => {
    const { model, tab, user } = setup('reference');
    vi.mocked(files.chooseMarkdownReference).mockResolvedValueOnce(null).mockResolvedValueOnce({ reference: 'docs/%E7%AC%94%E8%AE%B0.md', name: '笔记.md' });
    await user.click(screen.getByRole('button', { name: '选择本地 Markdown' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '选择本地 Markdown' }).hasAttribute('disabled')).toBe(false));
    expect(model.markdown(tab)).toBe('/query');
    await user.click(screen.getByRole('button', { name: '选择本地 Markdown' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: '链接显示文字' }).getAttribute('value')).toBe('笔记'));
    expect(files.chooseMarkdownReference).toHaveBeenCalledWith('/notes/current.md');
    await user.click(screen.getByRole('button', { name: '插入' }));
    expect(model.markdown(tab)).toBe('[笔记](docs/%E7%AC%94%E8%AE%B0.md)');
  });
  it('requires saving before a reference and leaves the original query intact', () => {
    const { model, tab } = setup('reference', false);
    expect(screen.getByRole('button', { name: '选择本地 Markdown' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('请先保存当前文档，再引用本地 Markdown 文件。')).toBeTruthy();
    expect(files.chooseMarkdownReference).not.toHaveBeenCalled(); expect(tab.editor!.getText()).toBe('/query');
  });
  it('preserves the original document on Escape and reports native chooser failures', async () => {
    const { model, tab, user } = setup('reference');
    vi.mocked(files.chooseMarkdownReference).mockRejectedValueOnce(new Error('无法读取文件'));
    await user.click(screen.getByRole('button', { name: '选择本地 Markdown' }));
    expect((await screen.findByRole('alert')).textContent).toContain('无法读取文件');
    await user.keyboard('{Escape}'); expect(model.markdown(tab)).toBe('/query');
    expect(screen.queryByRole('button', { name: '选择本地 Markdown' })).toBeNull();
  });
  it('shows recent emoji and supports English search', async () => {
    localStorage.setItem('minmd.recent-emoji', JSON.stringify(['💡', 'invalid']));
    const { user } = setup('emoji');
    expect(screen.getByRole('button', { name: '最近使用 💡' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '最近使用 invalid' })).toBeNull();
    await user.type(screen.getByRole('textbox', { name: '搜索表情' }), 'smile');
    expect(screen.getByRole('button', { name: '开心 😀' })).toBeTruthy();
  });
  it('browses all five categories and searches across categories without changing the query text', async () => {
    const { model, tab, user } = setup('emoji');
    expect(screen.getByRole('button', { name: '表情分类' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: '猫 🐱' })).toBeNull();
    for (const name of ['手势', '自然', '生活', '符号']) expect(screen.getByRole('button', { name: `${name}分类` })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '自然分类' }));
    expect(screen.getByRole('button', { name: '自然分类' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '猫 🐱' })).toBeTruthy();
    expect(model.markdown(tab)).toBe('/query');
    await user.type(screen.getByRole('textbox', { name: '搜索表情' }), '吉他');
    expect(screen.getByRole('button', { name: '吉他 🎸' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '吉他 🎸' }));
    expect(model.markdown(tab)).toBe('🎸');
  });
  it('drops a pending chooser result when switching tabs', async () => {
    const { model, tab, closed, user } = setup('reference');
    let resolve!: (value: { reference: string; name: string }) => void;
    vi.mocked(files.chooseMarkdownReference).mockImplementation(() => new Promise(done => { resolve = done; }));
    await user.click(screen.getByRole('button', { name: '选择本地 Markdown' }));
    act(() => { model.create(); }); expect(closed).toHaveBeenCalled();
    await act(async () => { resolve({ reference: 'wrong.md', name: 'wrong.md' }); });
    expect(model.markdown(tab)).toBe('/query'); expect(model.markdown(model.active!)).toBe('');
  });
  it('closes on document mutation or mode switch instead of deleting stale ranges', async () => {
    const { model, tab, closed } = setup('link');
    act(() => { tab.editor!.commands.setContent('外部更新', { contentType: 'markdown' }); });
    expect(closed).toHaveBeenCalled(); expect(model.markdown(tab)).toBe('外部更新');
    cleanup();
    const next = setup('date');
    act(() => { next.model.setMode('source'); }); expect(next.closed).toHaveBeenCalled(); expect(next.model.markdown(next.tab)).toBe('/query');
  });
});
