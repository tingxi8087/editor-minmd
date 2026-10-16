// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderReading, wikiTarget } from '../src/components/MarkdownReader/render';
import MarkdownReader from '../src/components/MarkdownReader';
import { unsupportedMarkdown } from '../src/lib/markdown';
vi.mock('../src/components/DocumentEditor/mermaidRenderer', () => ({ renderMermaid: vi.fn(async () => 'data:image/svg+xml;base64,PHN2Zy8+') }));
afterEach(cleanup);
const dom = (raw: string) => { const root = document.createElement('div'); root.innerHTML = renderReading(raw).html; return root; };
describe('independent raw Markdown reading', () => {
  it('renders footnotes and unique headings with return links', () => {
    const root = dom('# 标题\n\n正文[^1]\n\n[^1]: **脚注内容**\n\n# 标题');
    expect(root.querySelector('.footnotes strong')?.textContent).toBe('脚注内容');
    expect(root.querySelector('h1')?.id).toBe('read-标题');
    expect(root.querySelectorAll('h1')[1].id).toBe('read-标题-1');
    for (const a of root.querySelectorAll<HTMLAnchorElement>('.footnote-ref a, .footnote-backref')) expect(root.querySelector(`[id="${a.hash.slice(1)}"]`)).toBeTruthy();
  });
  it('renders inline and block math locally; invalid formulas retain source', () => {
    const root = dom('公式 $x^2$\n\n$$\n\\frac{a}{b}\n$$\n\n错误 $\\badcommand{x}$');
    expect(root.querySelectorAll('.katex')).toHaveLength(2);
    expect(root.querySelector('.reader-math')).toBeTruthy();
    expect(root.querySelector('.reader-formula-error')?.textContent).toContain('\\badcommand');
    expect(dom('$$\nunclosed').textContent).toContain('$$');
  });
  it('renders GFM alerts, nested containers, unknown container names and task states', () => {
    const root = dom('> [!WARNING]\n> 注意 **内容**\n\n:::: tip 标题\n外层\n\n::: custom\n未知内容\n:::\n::::\n\n- [x] 完成\n- [ ] 待办');
    expect(root.querySelector('.reader-alert .reader-label')?.textContent).toBe('WARNING');
    expect(root.querySelectorAll('.reader-container')).toHaveLength(2);
    expect(root.textContent).toContain('未知内容');
    expect(root.querySelectorAll('input:disabled')).toHaveLength(2);
    expect(root.querySelectorAll('input:checked')).toHaveLength(1);
  });
  it('preserves literal code and unknown fence contents without interpreting extensions', () => {
    const root = dom('`<version> [^1] $x$ [[A]]`\n\n```custom\n> [!NOTE]\n<div>\n```');
    expect(root.querySelector('code')?.textContent).toContain('<version>');
    expect(root.querySelector('pre code')?.textContent).toContain('<div>');
    expect(root.querySelector('.reader-alert')).toBeNull();
    expect(dom('按 <kbd>⌘</kbd> 保存').querySelector('kbd')?.textContent).toBe('⌘');
  });
  it('renders wiki aliases, heading references, image and document embeds with encoded paths', () => {
    expect(wikiTarget('目录/文件#中文 标题|别名')).toMatchObject({href:'%E7%9B%AE%E5%BD%95/%E6%96%87%E4%BB%B6.md#中文-标题',label:'别名'});
    const root = dom('[[文件|别名]]\n\n![[图片 空格.png]]\n\n![[子目录/文件#标题]]');
    expect(root.querySelector('a')?.textContent).toBe('别名');
    expect(root.querySelector('img')?.getAttribute('src')).toContain('%20');
    expect(root.querySelector('[data-reader-embed]')).toBeTruthy();
  });
  it('sanitizes HTML, scripts, handlers, injected reader attributes and dangerous URLs', () => {
    const root = dom('<div onclick="alert(1)">安全正文<script>alert(1)</script><iframe src="https://evil.test"></iframe><a href="javascript:alert(1)">坏链接</a><img src="x" onerror="alert(1)"><span data-reader-embed="evil.md" style="position:fixed">文字</span></div>\n\n<!-- 不显示注释 -->');
    expect(root.textContent).toContain('安全正文');
    expect(root.querySelector('script,iframe,[onclick],[onerror],[data-reader-embed],[style],a[href^="javascript:"]')).toBeNull();
    expect(root.innerHTML).not.toContain('不显示注释');
  });
  it('keeps fenced and inline examples out of the document-mode protection detector', () => {
    for (const code of ['`build/<version>/`','``a ` <div> [^1] $$ [[A]]``','```html\n<div>\n```','    <div>',String.raw`\<div>`,String.raw`\[\[文档]]`,String.raw`\$x\$`]) expect(unsupportedMarkdown(code)).toBeNull();
    for (const [raw, reason] of [['正文[^1]\n\n[^1]: 解释','脚注'],['$x^2$','数学公式'],['> [!NOTE]\n> 内容','提示块扩展'],['[[A]]','自定义 Markdown 语法'],['<span>hello</span>','内嵌 HTML'],['```ts\n未闭合','未闭合代码块']]) expect(unsupportedMarkdown(raw)).toBe(reason);
  });
});

function reader(markdown: string, extra: Partial<React.ComponentProps<typeof MarkdownReader>> = {}) {
  const callbacks = { onHeadings: vi.fn(), onLink: vi.fn(), onScroll: vi.fn(), loadImage: vi.fn(async () => 'data:image/png;base64,eA=='), loadEmbed: vi.fn(async () => ({path:'/notes/child.md',name:'child.md',content:'# 子文档\n\n嵌入正文'})) };
  const view = render(<MarkdownReader markdown={markdown} id="test" base="/notes/main.md" active dark={false} scrollTop={0} findOpen={false} findRequest={0} onCloseFind={vi.fn()} {...callbacks} {...extra} />);
  return { ...view, ...callbacks };
}
describe('reading resources, links and search', () => {
  it('hydrates local images and document embeds without opening tabs; links use embedded resource bases', async () => {
    const {loadImage,loadEmbed,onLink} = reader('![图](pic.png)\n\n![[child]]', { loadEmbed: async () => ({path:'/notes/sub/child.md',name:'child.md',content:'# 嵌入\n\n[下页](next.md)'}) });
    await waitFor(() => expect(screen.getByText('下页')).toBeTruthy());
    expect(loadImage).toHaveBeenCalledWith('file:///notes/pic.png');
    fireEvent.click(screen.getByText('下页')); expect(onLink).toHaveBeenCalledWith('file:///notes/sub/next.md');
    expect(loadEmbed).not.toHaveBeenCalled(); // overridden callback above
  });
  it('stops cycles and leaves readable links and errors for missing embeds', async () => {
    const load = vi.fn(async (ref: string) => { if (ref.endsWith('missing.md')) throw new Error('文件不存在'); return {path:'/notes/child.md',name:'child.md',content:'![[main]]'}; });
    reader('![[child]]\n\n![[missing]]', {loadEmbed:load});
    await waitFor(() => expect(screen.getByText(/循环引用/)).toBeTruthy());
    expect(screen.getByText(/文件不存在/)).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('updates rendered raw content, retains read-only search and does not offer replacement', async () => {
    reader('你**好**，你好\n\n脚注[^1]\n\n[^1]: 备注', {findOpen:true,findRequest:1});
    fireEvent.change(screen.getByRole('textbox',{name:'查找内容'}),{target:{value:'你好'}});
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('1 / 2'));
    fireEvent.click(screen.getByRole('button',{name:'下一处'})); expect(screen.getByRole('status').textContent).toBe('2 / 2');
    expect(screen.queryByRole('button',{name:'展开替换'})).toBeNull();
    expect(screen.getByRole('article').getAttribute('contenteditable')).toBeNull();
  });
});

it('limits embedded sections to their heading and handles missing anchors', async () => {
  reader('![[child#目标]]\n\n![[child#不存在]]', {loadEmbed: async () => ({path:'/notes/child.md',name:'child.md',content:'# 顶部\n\n忽略前文\n\n## 目标\n\n目标正文\n\n### 子标题\n\n子内容\n\n## 后面\n\n忽略后文'})});
  await waitFor(() => expect(screen.getByText('目标正文')).toBeTruthy());
  expect(screen.getByText('子内容')).toBeTruthy(); expect(screen.queryByText('忽略前文')).toBeNull(); expect(screen.queryByText('忽略后文')).toBeNull();
  expect(screen.getByText(/嵌入标题不存在/)).toBeTruthy();
});
it('stops deep embeds and keeps the rest of the document readable', async () => {
  const load = vi.fn(async (ref: string) => { const name = ref.split('/').pop()!; const n = Number(name.match(/\d+/)?.[0] ?? 0); return {path:`/notes/child${n}.md`,name,content:`正文${n}\n\n![[child${n+1}]]`}; });
  reader('# 根文档\n\n![[child0]]\n\n结尾保留', {loadEmbed:load});
  await waitFor(() => expect(screen.getByText(/嵌入层级或数量超过限制/)).toBeTruthy());
  expect(load).toHaveBeenCalledTimes(3); expect(screen.getByText('结尾保留')).toBeTruthy();
});
it('renders Mermaid as inert images and retains source when rendering fails', async () => {
  const {renderMermaid} = await import('../src/components/DocumentEditor/mermaidRenderer');
  vi.mocked(renderMermaid).mockRejectedValueOnce(new Error('无效图表'));
  reader('```mermaid\nbad diagram\n```\n\n```mermaid\nflowchart LR\n A --> B\n```');
  await waitFor(() => expect(screen.getByAltText('Mermaid 图表')).toBeTruthy());
  expect(screen.getByText('bad diagram')).toBeTruthy(); expect(screen.getByText(/图表无法渲染/)).toBeTruthy();
});
it('copies literal code without altering Markdown', async () => {
  const write = vi.fn(async () => {}); Object.defineProperty(navigator, 'clipboard', {value:{writeText:write}, configurable:true});
  reader('```ts\nconst x = 1;\n```');
  fireEvent.click(screen.getByRole('button',{name:'复制代码'}));
  await waitFor(() => expect(write).toHaveBeenCalledWith('const x = 1;\n'));
});

it('does not protect standard autolinks, quoted code fences or escaped extension examples', () => {
  for (const raw of ['<https://example.com>','> ```html\n> <div>\n> ```','- 项目\n\n  ```html\n  <span>\n  ```',String.raw`\[^1]`,String.raw`\$x\$`]) expect(unsupportedMarkdown(raw)).toBeNull();
  expect(unsupportedMarkdown('行内脚注^[说明]')).toBe('脚注');
});
