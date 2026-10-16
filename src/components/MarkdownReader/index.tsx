import escapeRegExp from 'lodash/escapeRegExp';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fileURL } from '@/lib/resources';
import type { DocumentFile } from '@/lib/files';
import { renderMermaid } from '../DocumentEditor/mermaidRenderer';
import { renderReading, type ReaderHeading } from './render';
import editorStyles from '../DocumentEditor/index.module.less';
import searchStyles from '../DocumentSearch/index.module.less';
import './reader.less';
import 'katex/dist/katex.min.css';

export function ReadingSearch({ root, openRequest, onClose }: { root: HTMLElement | null; openRequest: number; onClose: () => void }) {
  const [query, setQuery] = useState(''); const [sensitive, setSensitive] = useState(false);
  const [matches, setMatches] = useState<Range[]>([]); const [current, setCurrent] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, [openRequest]);
  useEffect(() => {
    if (!root) return;
    const update = () => {
      const nodes: Text[] = []; let text = ''; const offsets: number[] = []; let previousBlock: Element | null = null;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode(node) {
        const parent = node.parentElement;
        if (parent?.closest('.katex-mathml, script, style, [hidden]')) return NodeFilter.FILTER_REJECT;
        if (parent?.closest('details:not([open])') && !parent.closest('summary')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      } });
      let node; while ((node = walker.nextNode())) {
        const block = node.parentElement?.closest('p,li,h1,h2,h3,h4,h5,h6,pre,td,th,summary') ?? null;
        if (previousBlock && block !== previousBlock) text += '\n';
        previousBlock = block; offsets.push(text.length); nodes.push(node as Text); text += node.textContent;
      }
      const ranges: Range[] = [];
      if (query) for (const match of text.matchAll(new RegExp(escapeRegExp(query), sensitive ? 'gu' : 'giu'))) {
        if (ranges.length >= 10000) break;
        const at = match.index!; const length = match[0].length;
        const first = lastOffset(offsets, at); const last = lastOffset(offsets, at + length - 1);
        const range = document.createRange(); range.setStart(nodes[first], at - offsets[first]); range.setEnd(nodes[last], at + length - offsets[last]); ranges.push(range);
      }
      setMatches(ranges); setCurrent(0);
    };
    update(); const observer = new MutationObserver(update); observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
    return () => observer.disconnect();
  }, [root, query, sensitive]);
  useEffect(() => {
    // CSS Highlights do not mutate the rendered Markdown DOM or underlying file.
    const api = (globalThis.CSS ?? {}) as typeof CSS & { highlights?: Map<string, unknown> };
    const HighlightClass = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (api.highlights && HighlightClass) { api.highlights.set('reader-search', new HighlightClass(...matches)); api.highlights.set('reader-current', new HighlightClass(...(matches[current] ? [matches[current]] : []))); }
    matches[current]?.startContainer.parentElement?.scrollIntoView?.({ block: 'center' });
    return () => { api.highlights?.delete('reader-search'); api.highlights?.delete('reader-current'); };
  }, [matches, current]);
  const navigate = (step: number) => setCurrent(value => matches.length ? (value + step + matches.length) % matches.length : 0);
  return <section className={searchStyles.search} aria-label="文档查找" onKeyDown={event => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    if (event.key === 'Enter') { event.preventDefault(); navigate(event.shiftKey ? -1 : 1); }
  }}><div className={searchStyles.row}>
    <input ref={input} aria-label="查找内容" placeholder="查找内容" value={query} onChange={event => setQuery(event.target.value)} />
    <span role="status" className={searchStyles.count}>{query ? `${matches.length ? current + 1 : 0} / ${matches.length}` : '查找'}</span>
    <button aria-label="区分大小写" aria-pressed={sensitive} onClick={() => setSensitive(!sensitive)}>Aa</button>
    <button aria-label="上一处" disabled={!matches.length} onClick={() => navigate(-1)}>↑</button>
    <button aria-label="下一处" disabled={!matches.length} onClick={() => navigate(1)}>↓</button>
    <button aria-label="关闭查找" onClick={onClose}>×</button>
  </div></section>;
}

export default function MarkdownReader({ markdown, id, base, active, dark, scrollTop, onScroll, onLink, loadImage, loadEmbed, onHeadings, findOpen, findRequest, onCloseFind }: {
  markdown: string; id: string; base: string | null; active: boolean; dark: boolean; scrollTop: number;
  onScroll: (top: number) => void; onLink: (reference: string) => void;
  loadImage: (reference: string) => Promise<string>; loadEmbed: (reference: string) => Promise<DocumentFile>;
  onHeadings: (headings: ReaderHeading[]) => void; findOpen: boolean; findRequest: number; onCloseFind: () => void;
}) {
  const rendered = useMemo(() => renderReading(markdown, `${id}-`), [markdown, id]);
  const container = useRef<HTMLDivElement>(null); const [article, setArticle] = useState<HTMLElement | null>(null);
  const callbacks = useRef({ onLink, loadImage, loadEmbed, onHeadings }); callbacks.current = { onLink, loadImage, loadEmbed, onHeadings };
  useLayoutEffect(() => { if (active && container.current) container.current.scrollTop = scrollTop; }, [active, markdown]);
  useEffect(() => { if (active) callbacks.current.onHeadings(rendered.headings); }, [active, rendered]);
  useEffect(() => {
    if (!article || !active) return;
    let cancelled = false; let count = 0; let characters = 0;
    const absolute = (reference: string, documentBase: string | null) => documentBase ? new URL(reference, fileURL(documentBase)).href : reference;
    const message = (element: Element, text: string) => { if (!cancelled) { const span = document.createElement('span'); span.className = 'reader-resource-error'; span.textContent = text; element.append(span); } };
    const hydrate = async (root: HTMLElement, documentBase: string | null, seen: Set<string>, depth: number) => {
      root.dataset.readerBase = documentBase ?? '';
      await Promise.all(Array.from(root.querySelectorAll<HTMLImageElement>('img')).map(async image => {
        const src = image.getAttribute('src') ?? '';
        if (/^https?:/i.test(src)) return;
        image.removeAttribute('src');
        try { const url = await callbacks.current.loadImage(absolute(src, documentBase)); if (!cancelled) image.src = url; }
        catch { if (!cancelled) { image.alt = `${image.alt || src}（图片无法读取）`; image.classList.add('reader-resource-error'); } }
      }));
      await Promise.all(Array.from(root.querySelectorAll<HTMLElement>('[data-reader-mermaid]')).map(async element => {
        try { const url = await renderMermaid(decodeURIComponent(element.dataset.readerMermaid!), dark); if (!cancelled) { const image = document.createElement('img'); image.src = url; image.alt = 'Mermaid 图表'; element.replaceChildren(image); } }
        catch (error) { message(element, `图表无法渲染，已保留源码：${String(error)}`); }
      }));
      for (const element of root.querySelectorAll<HTMLElement>('[data-reader-embed]')) {
        if (cancelled) return;
        const reference = element.dataset.readerEmbed!;
        try {
          if (depth >= 3 || ++count > 12) throw new Error('嵌入层级或数量超过限制，请点击链接单独打开');
          const resolved = absolute(reference, documentBase); const key = resolved.split('#')[0];
          if (seen.has(key)) throw new Error('循环引用，已停止展开');
          const file = await callbacks.current.loadEmbed(resolved);
          const canonical = fileURL(file.path).href;
          if (seen.has(canonical)) throw new Error('循环引用，已停止展开');
          characters += file.content.length;
          if (characters > 1_000_000) throw new Error('嵌入总内容过大，请单独打开');
          if (cancelled) return;
          const next = renderReading(file.content, `${id}-embed-${count}-`);
          const body = document.createElement('section'); body.className = 'reader-embed-body'; body.innerHTML = next.html;
          const hash = resolved.indexOf('#');
          if (hash >= 0) {
            const anchor = decodeURIComponent(resolved.slice(hash + 1));
            const heading = next.headings.find(h => h.id.endsWith(`-${anchor}`));
            if (!heading) throw new Error('嵌入标题不存在');
            const start = Array.from(body.querySelectorAll<HTMLElement>('[id]')).find(element => element.id === heading.id)!;
            let current: ChildNode | null = body.firstChild; let keeping = false;
            while (current) { const following: ChildNode | null = current.nextSibling; if (current === start) keeping = true; else if (keeping && current instanceof HTMLElement && /^H[1-6]$/.test(current.tagName) && Number(current.tagName[1]) <= heading.level) keeping = false; if (!keeping) current.remove(); current = following; }
          }
          element.append(body);
          await hydrate(body, file.path, new Set([...seen, key, canonical]), depth + 1);
        } catch (error) { message(element, String(error)); }
      }
    };
    article.innerHTML = rendered.html;
    void hydrate(article, base, new Set(base ? [fileURL(base).href] : []), 0);
    return () => { cancelled = true; };
  }, [article, active, rendered, base, dark, id]);
  return <>
    {active && findOpen && <ReadingSearch root={article} openRequest={findRequest} onClose={onCloseFind} />}
    <div ref={container} className={`${editorStyles.editor} document-scroll reader-scroll`} onScroll={event => { if (active) onScroll(event.currentTarget.scrollTop); }}>
      <article ref={setArticle} className="tiptap markdown-reading" aria-label="Markdown 阅读内容" onClick={event => {
        const target = event.target instanceof Element ? event.target : null;
        const copy = target?.closest<HTMLButtonElement>('button[data-reader-copy]');
        if (copy) {
          void Promise.resolve().then(() => navigator.clipboard.writeText(decodeURIComponent(copy.dataset.readerCopy ?? ''))).then(() => { copy.textContent = '已复制'; }, () => { copy.textContent = '复制失败'; }); return;
        }
        const anchor = target?.closest('a'); if (!anchor) return;
        event.preventDefault(); const href = anchor.getAttribute('href') ?? '';
        if (href.startsWith('#')) {
          let name: string; try { name = decodeURIComponent(href.slice(1)); } catch { return; }
          const scope = anchor.closest('.reader-embed-body') ?? article;
          const found = Array.from(scope?.querySelectorAll<HTMLElement>('[id]') ?? []).find(el => el.id === name || el.id === `${id}-${name}` || el.id.endsWith(`-${name}`));
          found?.scrollIntoView?.({ block: 'start' }); return;
        }
        const localBase = anchor.closest<HTMLElement>('[data-reader-base]')?.dataset.readerBase;
        callbacks.current.onLink(localBase && localBase !== base ? absoluteLink(href, localBase) : href);
      }} />
    </div>
  </>;
}
function absoluteLink(href: string, base: string) { try { return new URL(href, fileURL(base)).href; } catch { return href; } }

function lastOffset(offsets: number[], position: number) { let i = offsets.length - 1; while (i > 0 && offsets[i] > position) i--; return i; }
