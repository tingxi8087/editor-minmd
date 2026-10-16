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
  const editor = new Editor({ element, extensions: editorExtensions(), content: `\`\`\`mermaid\n${content}\n\`\`\``, contentType: 'markdown' });
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
    expect(element.querySelector('select')?.hidden).toBe(true);
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
    const select = element.querySelector('select')!; select.value = 'javascript'; select.dispatchEvent(new Event('change'));
    expect(editor.getMarkdown()).toContain('```javascript');
    expect(element.querySelector('.hljs-keyword')?.textContent).toBe('const');
    expect(element.querySelector('.mermaid-preview')?.hasAttribute('hidden')).toBe(true);
    editor.commands.undo(); expect(editor.getMarkdown()).toContain('```mermaid');
  });
  it('rejects oversized and configurable diagrams before rendering', () => {
    expect(() => validateMermaid('x'.repeat(MAX_MERMAID_LENGTH + 1))).toThrow('30,000');
    expect(() => validateMermaid('%%{init:{"securityLevel":"loose"}}%%\ngraph TD\nA-->B')).toThrow('配置');
    expect(() => validateMermaid('---\nconfig:\n  htmlLabels: true\n---\ngraph TD')).toThrow('配置');
    expect(() => validateMermaid('sequenceDiagram\nA->>B: hi')).not.toThrow();
  });
});
