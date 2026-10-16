// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editorExtensions } from '../src/components/DocumentEditor/extensions';
import DocumentSearch from '../src/components/DocumentSearch';
import { findMatches, replaceMatches, revealMatch, searchKey, setSearch } from '../src/components/DocumentSearch/extension';
vi.mock('../src/components/DocumentEditor/mermaidRenderer', async original => ({
  ...await original<typeof import('../src/components/DocumentEditor/mermaidRenderer')>(), renderMermaid: vi.fn().mockResolvedValue('data:image/svg+xml,test'),
}));
const editors: Editor[] = [];
const setup = (markdown = 'hello **world** hello\n\nother hello') => {
  const element = document.createElement('div'); document.body.append(element);
  const editor = new Editor({ element, extensions: editorExtensions(), content: markdown, contentType: 'markdown', editorProps: { handleScrollToSelection: () => true } });
  editors.push(editor); return editor;
};
afterEach(() => { cleanup(); editors.splice(0).forEach(editor => editor.destroy()); document.body.replaceChildren(); });
describe('rich document find and replace', () => {
  it('finds across marks while respecting paragraph, cell and inline atom boundaries', () => {
    const editor = setup('hello **world**\n\nhello\n\n| one | two |\n| --- | --- |\n| hello | world |');
    expect(findMatches(editor.state.doc, 'hello world')).toHaveLength(1);
    expect(findMatches(editor.state.doc, 'worldhello')).toHaveLength(0);
    expect(findMatches(editor.state.doc, 'helloworld')).toHaveLength(0);
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'left' }, { type: 'image', attrs: { src: 'x.png', alt: 'hidden' } }, { type: 'text', text: 'right' }] }] });
    expect(findMatches(editor.state.doc, 'leftright')).toHaveLength(0);
    expect(findMatches(editor.state.doc, 'hidden')).toHaveLength(0);
  });
  it('treats special characters literally, keeps case-insensitive offsets correct and empty query safe', () => {
    const editor = setup('a.b A.B İ x😀x');
    expect(findMatches(editor.state.doc, 'a.b')).toHaveLength(2);
    expect(findMatches(editor.state.doc, 'a.b', true)).toHaveLength(1);
    const emoji = findMatches(editor.state.doc, '😀');
    expect(emoji).toHaveLength(1); expect(editor.state.doc.textBetween(emoji[0].from, emoji[0].to)).toBe('😀');
    expect(findMatches(editor.state.doc, '')).toEqual([]);
    expect(findMatches(editor.state.doc, '[')).toEqual([]);
  });
  it('decorates all results and current result without writing content or undo history in reading mode', () => {
    const editor = setup(); editor.setEditable(false); const before = editor.getJSON(); const updated = vi.fn(); editor.on('update', updated);
    setSearch(editor, { query: 'hello' }); revealMatch(editor, 1);
    expect(editor.view.dom.querySelectorAll('.document-search-match')).toHaveLength(3);
    expect(editor.view.dom.querySelectorAll('.document-search-current')).toHaveLength(1);
    expect(editor.getJSON()).toEqual(before); expect(updated).not.toHaveBeenCalled();
    expect(editor.can().undo()).toBe(false);
    expect(replaceMatches(editor, 'bad', true)).toBe(false); expect(editor.getJSON()).toEqual(before);
  });
  it('replaces across inline marks using initial marks, and entire replace-all is one independent undo', () => {
    const editor = setup('**hello** world\n\nhello world'); const before = editor.getMarkdown();
    setSearch(editor, { query: 'hello world' });
    expect(replaceMatches(editor, 'changed', true)).toBe(true);
    expect(editor.getMarkdown()).toContain('**changed**');
    expect(editor.getMarkdown()).not.toContain('hello');
    expect(searchKey.getState(editor.state)?.matches).toHaveLength(0);
    editor.commands.undo(); expect(editor.getMarkdown()).toBe(before);
    editor.commands.redo(); expect(editor.getMarkdown()).not.toContain('hello');
  });
  it('replaces current result, supports deletion, and never loops when replacement contains query', () => {
    const editor = setup('x x x'); setSearch(editor, { query: 'x' }); revealMatch(editor, 1);
    replaceMatches(editor, 'xx'); expect(editor.getText().trim()).toBe('x xx x');
    replaceMatches(editor, '', true); expect(editor.getText().trim()).toBe('');
    editor.commands.undo(); expect(editor.getText().trim()).toBe('x xx x');
  });
  it('keeps replacement dollar tokens and backslashes literal instead of regex substitution', () => {
    const editor = setup('cat cat'); setSearch(editor, { query: 'cat' });
    replaceMatches(editor, '$&\\path', true);
    expect(editor.getText().trim()).toBe('$&\\path $&\\path');
    editor.commands.undo(); expect(editor.getText().trim()).toBe('cat cat');
  });
  it('reuses the match list for navigation-only metadata', () => {
    const editor = setup(); setSearch(editor, { query: 'hello' });
    const matches = searchKey.getState(editor.state)?.matches;
    revealMatch(editor, 2); expect(searchKey.getState(editor.state)?.matches).toBe(matches);
  });
  it('refreshes results after edits and clears all decorations when closed', () => {
    const editor = setup('cat'); setSearch(editor, { query: 'cat' });
    editor.commands.insertContentAt(4, ' cat'); expect(searchKey.getState(editor.state)?.matches).toHaveLength(2);
    setSearch(editor, { query: '' }); expect(editor.view.dom.querySelectorAll('.document-search-match')).toHaveLength(0);
    expect(editor.getMarkdown()).toBe('cat cat');
  });
  it('finds only source text in code blocks and signals hidden Mermaid source reveal', () => {
    const editor = setup('```mermaid\ngraph TD\nA-->B\n```'); const revealed = vi.fn();
    editor.view.dom.querySelector('.rich-code-block')!.addEventListener('document-search-reveal', revealed);
    setSearch(editor, { query: 'graph' }); revealMatch(editor, 0);
    expect(revealed).toHaveBeenCalledTimes(1);
    expect(findMatches(editor.state.doc, '复制')).toHaveLength(0);
    expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)).toBe('graph');
  });
  it('provides compact Chinese controls, count, wraparound navigation and keyboard navigation', () => {
    const editor = setup(); const onClose = vi.fn(); render(<DocumentSearch editor={editor} onClose={onClose} />);
    const input = screen.getByRole('textbox', { name: '查找内容' });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'hello' } }); expect(screen.getByRole('status').textContent).toBe('1 / 3');
    fireEvent.keyDown(input, { key: 'Enter' }); expect(screen.getByRole('status').textContent).toBe('2 / 3');
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true }); expect(screen.getByRole('status').textContent).toBe('1 / 3');
    fireEvent.click(screen.getByRole('button', { name: '上一处' })); expect(screen.getByRole('status').textContent).toBe('3 / 3');
    fireEvent.keyDown(input, { key: 'Escape' }); expect(onClose).toHaveBeenCalledOnce();
    expect(editor.view.dom.querySelector('.document-search-match')).toBeNull();
  });
  it('never navigates/closes on IME Enter or Escape and displays no-match count', () => {
    const editor = setup(); const onClose = vi.fn(); render(<DocumentSearch editor={editor} onClose={onClose} />);
    const input = screen.getByRole('textbox', { name: '查找内容' }); fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true }); expect(screen.getByRole('status').textContent).toBe('1 / 3');
    fireEvent.keyDown(input, { key: 'Escape', keyCode: 229 }); expect(onClose).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'missing' } }); expect(screen.getByRole('status').textContent).toBe('0 / 0');
    expect((screen.getByRole('button', { name: '下一处' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('keeps native Enter activation for focused buttons instead of navigating results', async () => {
    const editor = setup('cat cat'); const onClose = vi.fn(); const user = userEvent.setup();
    render(<DocumentSearch editor={editor} onClose={onClose} />);
    fireEvent.change(screen.getByRole('textbox', { name: '查找内容' }), { target: { value: 'cat' } });
    const toggle = screen.getByRole('button', { name: '展开替换' }); toggle.focus(); await user.keyboard('{Enter}');
    expect(screen.getByRole('textbox', { name: '替换内容' })).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: '替换内容' }), { target: { value: 'dog' } });
    screen.getByRole('button', { name: '全部替换' }).focus(); await user.keyboard('{Enter}');
    expect(editor.getMarkdown()).toBe('dog dog'); expect(document.activeElement).toBe(editor.view.dom);
    screen.getByRole('button', { name: '关闭查找' }).focus(); await user.keyboard('{Enter}');
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('toggles case, performs replace-all from the UI, and hides replacement in reading or busy states', () => {
    const editor = setup('cat CAT'); const { rerender } = render(<DocumentSearch editor={editor} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('textbox', { name: '查找内容' }), { target: { value: 'cat' } });
    fireEvent.click(screen.getByRole('button', { name: '区分大小写' })); expect(screen.getByRole('status').textContent).toBe('1 / 1');
    fireEvent.click(screen.getByRole('button', { name: '展开替换' }));
    fireEvent.change(screen.getByRole('textbox', { name: '替换内容' }), { target: { value: 'dog' } });
    fireEvent.click(screen.getByRole('button', { name: '全部替换' })); expect(editor.getMarkdown()).toBe('dog CAT');
    rerender(<DocumentSearch editor={editor} readOnly onClose={() => {}} />);
    expect(screen.queryByRole('textbox', { name: '替换内容' })).toBeNull(); expect(screen.queryByRole('button', { name: '展开替换' })).toBeNull();
    rerender(<DocumentSearch editor={editor} onClose={() => {}} />);
    expect(screen.queryByRole('textbox', { name: '替换内容' })).toBeNull();
  });
  it('focuses the editor after replacing even the last result, so document undo is immediately available', () => {
    const editor = setup('cat cat'); render(<DocumentSearch editor={editor} onClose={() => {}} />);
    const query = screen.getByRole('textbox', { name: '查找内容' });
    fireEvent.change(query, { target: { value: 'cat' } });
    fireEvent.keyDown(query, { key: 'Enter' }); expect(document.activeElement).toBe(query);
    fireEvent.click(screen.getByRole('button', { name: '展开替换' }));
    const replacement = screen.getByRole('textbox', { name: '替换内容' });
    fireEvent.change(replacement, { target: { value: 'dog' } }); replacement.focus();
    fireEvent.click(screen.getByRole('button', { name: '全部替换' }));
    expect(screen.getByRole('status').textContent).toBe('0 / 0');
    expect(document.activeElement).toBe(editor.view.dom);
    act(() => { editor.commands.undo(); }); expect(editor.getMarkdown()).toBe('cat cat');
    replacement.focus(); fireEvent.keyDown(replacement, { key: 'Enter' });
    expect(document.activeElement).toBe(editor.view.dom); expect(editor.getMarkdown()).toBe('dog cat');
  });
  it('prefills real selected document text and selects input again on repeated open requests', () => {
    const editor = setup('selected word'); editor.commands.setTextSelection({ from: 1, to: 9 });
    const { rerender, unmount } = render(<DocumentSearch editor={editor} openRequest={1} onClose={() => {}} />);
    const input = screen.getByRole('textbox', { name: '查找内容' }) as HTMLInputElement; expect(input.value).toBe('selected');
    fireEvent.change(input, { target: { value: 'word' } });
    rerender(<DocumentSearch editor={editor} openRequest={2} onClose={() => {}} />);
    expect(input.value).toBe('word'); expect(input.selectionStart).toBe(0); expect(input.selectionEnd).toBe(4);
    unmount(); expect(searchKey.getState(editor.state)?.query).toBe('');
  });
  it('switches editors without leaking decorations or transaction listeners', () => {
    const first = setup('first'); const second = setup('second'); const { rerender, unmount } = render(<DocumentSearch editor={first} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('textbox', { name: '查找内容' }), { target: { value: 'first' } });
    rerender(<DocumentSearch editor={second} onClose={() => {}} />); expect(searchKey.getState(first.state)?.query).toBe('');
    expect(screen.getByRole('status').textContent).toBe('0 / 0');
    act(() => first.commands.insertContent('first')); expect(screen.getByRole('status').textContent).toBe('0 / 0');
    unmount(); expect(searchKey.getState(second.state)?.query).toBe('');
  });
});
