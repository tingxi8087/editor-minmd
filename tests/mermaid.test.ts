// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editorExtensions } from '../src/components/DocumentEditor/extensions';
import { MAX_MERMAID_LENGTH, validateMermaid } from '../src/components/DocumentEditor/mermaidRenderer';
const mocks = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('../src/components/DocumentEditor/mermaidRenderer', async original => ({
  ...await original<typeof import('../src/components/DocumentEditor/mermaidRenderer')>(), renderMermaid: mocks.render,
}));
const editors: Editor[] = [];
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 350)); };
const setup = (content = 'graph TD\nA-->B') => {
  const element = document.createElement('div'); element.className = 'workspace'; document.body.append(element);
  const editor = new Editor({ element, editorProps: { handleScrollToSelection: () => true }, extensions: editorExtensions(), content: `\`\`\`mermaid\n${content}\n\`\`\``, contentType: 'markdown' });
  editors.push(editor); return { editor, element };
};
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); document.body.replaceChildren(); vi.useRealTimers(); vi.resetAllMocks(); });
describe('Mermaid code block', () => {
  it('renders preview without replacing source, persists fenced language and supports reading source toggle', async () => {
    mocks.render.mockResolvedValue('data:image/svg+xml,test');
    const { editor, element } = setup(); await flush();
    expect(element.querySelector('img')?.alt).toBe('Mermaid 图表');
    expect(element.querySelector('code')?.textContent).toBe('graph TD\nA-->B');
    expect(editor.getMarkdown()).toContain('```mermaid\ngraph TD\nA-->B\n```');
    editor.setEditable(false); await Promise.resolve();
    expect(element.querySelector('pre')?.hidden).toBe(true);
    const toggle = [...element.querySelectorAll('button')].find(button => button.textContent === '查看源码')!;
    toggle.click(); expect(element.querySelector('pre')?.hidden).toBe(false);
    expect(element.querySelector<HTMLButtonElement>('.code-language')?.hidden).toBe(true);
  });
  it('ignores stale completions and destroyed views', async () => {
    const resolvers: ((value: string) => void)[] = [];
    mocks.render.mockImplementation(() => new Promise(resolve => resolvers.push(resolve)));
    const { editor, element } = setup(); await flush();
    editor.commands.insertContentAt(2, 'new'); await flush();
    resolvers[1]('data:image/svg+xml,new'); await Promise.resolve(); await Promise.resolve();
    resolvers[0]('data:image/svg+xml,old'); await Promise.resolve(); await Promise.resolve();
    expect(element.querySelector('img')?.getAttribute('src')).toContain(',new');
    editor.commands.insertContentAt(2, 'next'); await flush(); editor.destroy();
    resolvers[2]('data:image/svg+xml,destroyed'); await Promise.resolve(); await Promise.resolve();
    expect(element.querySelector('img')?.getAttribute('src') ?? '').not.toContain('destroyed');
  });
  it('keeps invalid source visible in reading mode and reacts to theme', async () => {
    mocks.render.mockRejectedValue(new Error('语法错误'));
    const { editor, element } = setup(); editor.setEditable(false, false); const updates = vi.fn(); editor.on('update', updates); const before = editor.getMarkdown(); await flush();
    expect(element.querySelector('.mermaid-preview')?.textContent).toContain('语法错误');
    expect(element.querySelector('pre')?.hidden).toBe(false);
    element.classList.add('dark'); await flush();
    expect(mocks.render).toHaveBeenLastCalledWith('graph TD\nA-->B', true);
    expect(editor.getMarkdown()).toBe(before); expect(updates).not.toHaveBeenCalled();
  });
  it('copies only source, allows language changes, supports undo and leaves ordinary highlighting intact', async () => {
    mocks.render.mockResolvedValue('data:image/svg+xml,test');
    const writeText = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { editor, element } = setup('const n = 1;'); await flush();
    const before = editor.getMarkdown();
    [...element.querySelectorAll('button')].find(button => button.textContent === '复制')!.click(); await Promise.resolve(); await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('const n = 1;'); expect(editor.getMarkdown()).toBe(before);
    element.querySelector<HTMLButtonElement>('.code-language')!.click();
    element.querySelector<HTMLButtonElement>('[data-language=javascript]')!.click();
    expect(editor.getMarkdown()).toContain('```javascript');
    expect(element.querySelector('.hljs-keyword')?.textContent).toBe('const');
    expect(element.querySelector('.mermaid-preview')?.hasAttribute('hidden')).toBe(true);
    editor.commands.undo(); expect(editor.getMarkdown()).toContain('```mermaid');
  });
  it('keeps empty Mermaid quiet without rendering and supports editable diagram/source views', async () => {
    const { editor, element } = setup(''); await flush();
    expect(mocks.render).not.toHaveBeenCalled();
    expect(element.querySelector('.mermaid-preview')?.textContent).toBe('输入 Mermaid 源码后预览图表');
    expect(element.querySelector('.mermaid-error')).toBeNull();
    const button = (text: string) => [...element.querySelectorAll('button')].find(item => item.textContent === text)!;
    button('图表').click(); expect(element.querySelector('pre')?.hidden).toBe(true);
    expect(document.activeElement).toBe(button('图表'));
    expect(editor.view.hasFocus()).toBe(false);
    button('源码').click(); expect(element.querySelector('pre')?.hidden).toBe(false);
    expect(editor.getMarkdown()).toContain('```mermaid');
    editor.setEditable(false); await Promise.resolve();
    expect(element.querySelector<HTMLButtonElement>('[aria-label=删除代码块]')?.hidden).toBe(true);
    expect(element.querySelector<HTMLElement>('[aria-label="Mermaid 视图"]')?.hidden).toBe(true);
  });
  it('searches languages and accepts safe custom language names with undo', async () => {
    const { editor, element } = setup(); await flush();
    element.querySelector<HTMLButtonElement>('.code-language')!.click();
    const search = element.querySelector<HTMLInputElement>('input')!; search.value = 'rust'; search.dispatchEvent(new Event('input'));
    expect(element.querySelectorAll('[role=option]')).toHaveLength(1);
    expect(element.querySelector('[role=option]')?.textContent).toBe('Rust');
    search.value = 'custom-lang'; search.dispatchEvent(new Event('input'));
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(editor.getMarkdown()).toContain('```custom-lang');
    editor.commands.undo(); expect(editor.getMarkdown()).toContain('```mermaid');
    element.querySelector<HTMLButtonElement>('.code-language')!.click();
    search.value = '<unsafe>'; search.dispatchEvent(new Event('input'));
    expect(element.querySelectorAll('[role=option]')).toHaveLength(0);
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(element.querySelector<HTMLElement>('.code-language-menu')?.hidden).toBe(true);
    expect(editor.getMarkdown()).toContain('```mermaid');
  });
  it('deletes a sole code block into an empty paragraph and restores it with one undo', async () => {
    const { editor, element } = setup('graph TD\nA-->B'); await flush();
    const before = editor.getMarkdown();
    element.querySelector<HTMLButtonElement>('[aria-label=删除代码块]')!.click();
    expect(editor.getJSON()).toMatchObject({ content: [{ type: 'paragraph' }] });
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
    // StarterKit's trailing-node plugin restores a final empty paragraph after the code block.
    editor.commands.undo(); expect(editor.getMarkdown().trimEnd()).toBe(before.trimEnd());
    editor.commands.redo(); expect(editor.getJSON().content?.[0].type).toBe('paragraph');
  });
  it('deletes only the selected block between paragraphs, preserving neighbors', async () => {
    const { editor, element } = setup();
    editor.commands.setContent('before\n\n```javascript\nconst n = 1;\n```\n\nafter', { contentType: 'markdown' }); await flush();
    element.querySelector<HTMLButtonElement>('[aria-label=删除代码块]')!.click();
    expect(editor.getMarkdown()).toBe('before\n\nafter');
    editor.commands.undo(); expect(editor.getMarkdown()).toContain('```javascript\nconst n = 1;');
  });
  it('preserves keyboard routes into paragraphs before and after code blocks', () => {
    const { editor } = setup('graph TD');
    editor.commands.setTextSelection(1);
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
    expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');
    editor.commands.setContent('```javascript\nconst n = 1;\n```', { contentType: 'markdown' });
    editor.commands.setTextSelection(editor.state.doc.firstChild!.nodeSize - 1);
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
    expect(editor.state.doc.firstChild?.type.name).toBe('codeBlock');
  });
  it('lets Backspace turn an empty code block back into a paragraph', () => {
    const { editor } = setup('');
    editor.commands.setTextSelection(1);
    editor.commands.keyboardShortcut('Backspace');
    expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');
    expect(editor.getMarkdown().trim()).toBe('');
  });
  it('rejects oversized and configurable diagrams before rendering', () => {
    expect(() => validateMermaid('x'.repeat(MAX_MERMAID_LENGTH + 1))).toThrow('30,000');
    expect(() => validateMermaid('%%{init:{"securityLevel":"loose"}}%%\ngraph TD\nA-->B')).toThrow('配置');
    expect(() => validateMermaid('---\nconfig:\n  htmlLabels: true\n---\ngraph TD')).toThrow('配置');
    expect(() => validateMermaid('sequenceDiagram\nA->>B: hi')).not.toThrow();
  });
});
