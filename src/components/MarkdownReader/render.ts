import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import container from 'markdown-it-container';
import katex from 'katex';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { unpackMarkdown } from '@/lib/markdown';

export type ReaderHeading = { text: string; level: number; position: number; id: string };
export const headingSlug = (text: string) => text.trim().toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
export function wikiTarget(value: string) {
  const [target, alias] = value.split('|');
  const hash = target.indexOf('#');
  const path = (hash < 0 ? target : target.slice(0, hash)).trim();
  const anchor = hash < 0 ? '' : target.slice(hash + 1).trim();
  const filename = path && !/\.[^/]+$/.test(path) ? `${path}.md` : path;
  return { href: filename.split('/').map(part => { try { return encodeURIComponent(decodeURIComponent(part)); } catch { return encodeURIComponent(part); } }).join('/') + (anchor ? `#${headingSlug(anchor)}` : ''), label: alias?.trim() || target.trim(), image: /\.(?:png|jpe?g|gif|webp)$/i.test(path) };
}
const md = new MarkdownIt({ html: true, linkify: false, breaks: false, highlight(code, lang) {
  return lang && hljs.getLanguage(lang) ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value : '';
} }).use(footnote).use(container, 'extension', {
  validate: (params: string) => /^[\w-]+(?:\s.*)?$/.test(params.trim()),
  render(tokens: { nesting: number; info: string }[], index: number) {
    if (tokens[index].nesting < 0) return '</aside>\n';
    const info = tokens[index].info.trim();
    return `<aside class="reader-container"><div class="reader-label">${md.utils.escapeHtml(info)}</div>\n`;
  },
});
function formula(source: string, displayMode: boolean) {
  try { return katex.renderToString(source, { displayMode, throwOnError: true, trust: false, strict: 'ignore', maxExpand: 200, output: 'htmlAndMathml' }); }
  catch { return `<code class="reader-formula-error" title="公式无法渲染，保留原文">${md.utils.escapeHtml(displayMode ? `$$\n${source}\n$$` : `$${source}$`)}</code>`; }
}
md.inline.ruler.before('escape', 'reader_math', (state, silent) => {
  if (state.src[state.pos] !== '$' || state.src[state.pos + 1] === '$' || /\s/.test(state.src[state.pos + 1] ?? '')) return false;
  let end = state.pos + 1;
  while ((end = state.src.indexOf('$', end)) >= 0) { if (state.src[end - 1] !== '\\') break; end++; }
  if (end < 0 || /\s/.test(state.src[end - 1]) || /\d/.test(state.src[end + 1] ?? '')) return false;
  const content = state.src.slice(state.pos + 1, end);
  if (!content || content.includes('\n')) return false;
  if (!silent) { const token = state.push('reader_math', '', 0); token.content = content; }
  state.pos = end + 1; return true;
});
md.renderer.rules.reader_math = (tokens, index) => formula(tokens[index].content, false);
md.block.ruler.before('fence', 'reader_math_block', (state, start, end, silent) => {
  const line = state.getLines(start, start + 1, 0, false).trim();
  if (!line.startsWith('$$')) return false;
  if (silent) return true;
  let content = line.slice(2); let next = start + 1; let closed = false;
  if (content.endsWith('$$')) { content = content.slice(0, -2); closed = true; }
  else for (; next < end; next++) {
    const text = state.getLines(next, next + 1, 0, false);
    if (text.trimEnd().endsWith('$$')) { content += `\n${text.trimEnd().slice(0, -2)}`; next++; closed = true; break; }
    content += `\n${text}`;
  }
  const token = state.push('reader_math_block', '', 0); token.content = content.trim(); token.meta = { closed }; token.map = [start, next];
  state.line = next; return true;
}, { alt: ['paragraph', 'blockquote', 'list'] });
md.renderer.rules.reader_math_block = (tokens, index) => tokens[index].meta?.closed ? `<div class="reader-math">${formula(tokens[index].content, true)}</div>` : `<pre><code>${md.utils.escapeHtml(`$$\n${tokens[index].content}`)}</code></pre>`;
md.inline.ruler.before('link', 'reader_wiki', (state, silent) => {
  if (state.linkLevel > 0) return false;
  const match = state.src.slice(state.pos).match(/^(!?)\[\[([^\]\n]+)\]\]/);
  if (!match) return false;
  if (!silent) {
    const token = state.push(match[1] ? 'reader_embed' : 'reader_wiki', '', 0); token.content = match[2];
  }
  state.pos += match[0].length; return true;
});
md.renderer.rules.reader_wiki = (tokens, index) => {
  const target = wikiTarget(tokens[index].content);
  return `<a href="${md.utils.escapeHtml(target.href)}">${md.utils.escapeHtml(target.label)}</a>`;
};
md.renderer.rules.reader_embed = (tokens, index) => {
  const target = wikiTarget(tokens[index].content);
  return target.image ? `<img src="${md.utils.escapeHtml(target.href)}" alt="${md.utils.escapeHtml(target.label)}">` : `<span class="reader-embed" data-reader-embed="${md.utils.escapeHtml(target.href)}"><a href="${md.utils.escapeHtml(target.href)}">嵌入文档：${md.utils.escapeHtml(target.label)}</a></span>`;
};
const rawHTML = (source: string) => DOMPurify.sanitize(source, { USE_PROFILES: { html: true }, ALLOW_DATA_ATTR: false, FORBID_ATTR: ['style', 'id', 'name', 'srcset', 'class'], FORBID_TAGS: ['input', 'form', 'button', 'textarea', 'select', 'style', 'iframe', 'object', 'embed'] });
md.renderer.rules.html_inline = (tokens, index) => {
  const source = tokens[index].content;
  const tag = source.match(/^<\/?([a-z][a-z0-9-]*)\b/i)?.[1]?.toLowerCase();
  if (!tag) return rawHTML(source);
  // Inline tokens contain individual tags. Keep their boundaries while sanitizing
  // attributes, so <kbd>text</kbd> does not become <kbd></kbd>text.
  if (/^<\//.test(source)) return rawHTML(`<${tag}>x</${tag}>`).startsWith(`<${tag}`) ? `</${tag}>` : '';
  const safe = rawHTML(source);
  return safe.endsWith(`</${tag}>`) ? safe.slice(0, -tag.length - 3) : safe;
};
md.renderer.rules.html_block = (tokens, index) => rawHTML(tokens[index].content);
const fence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, index, options, env, self) => {
  const token = tokens[index];
  if (token.info.trim().toLowerCase() === 'mermaid') return `<div class="reader-mermaid" data-reader-mermaid="${md.utils.escapeHtml(encodeURIComponent(token.content))}"><pre><code>${md.utils.escapeHtml(token.content)}</code></pre></div>`;
  return `<figure class="reader-code"><button type="button" data-reader-copy="${md.utils.escapeHtml(encodeURIComponent(token.content))}" aria-label="复制代码">复制</button>${fence(tokens, index, options, env, self)}</figure>`;
};
md.core.ruler.after('inline', 'reader_alerts', state => {
  for (let i = 0; i < state.tokens.length; i++) {
    if (state.tokens[i].type !== 'blockquote_open') continue;
    const inline = state.tokens[i + 2];
    const first = inline?.children?.[0];
    const match = first?.type === 'text' && first.content.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s|$)/i);
    if (!match) continue;
    state.tokens[i].attrSet('class', 'reader-alert');
    first!.content = first!.content.slice(match[0].length);
    const label = new state.Token('html_inline', '', 0);
    // Use a dedicated renderer, never pass generated labels through raw HTML.
    label.type = 'reader_alert_label'; label.content = match[1].toUpperCase();
    inline.children!.unshift(label);
  }
});
md.core.ruler.after('reader_alerts', 'reader_tasks', state => {
  for (let i = 0; i < state.tokens.length; i++) {
    const token = state.tokens[i]; const first = token.children?.[0];
    if (token.type !== 'inline' || first?.type !== 'text' || state.tokens[i - 2]?.type !== 'list_item_open') continue;
    const task = first.content.match(/^\[([ xX])\]\s+/); if (!task) continue;
    first.content = first.content.slice(task[0].length);
    state.tokens[i - 2].attrSet('class', 'reader-task');
    const check = new state.Token('reader_task', '', 0); check.content = task[1]; token.children!.unshift(check);
  }
});
md.renderer.rules.reader_task = (tokens, index) => `<input type="checkbox" disabled aria-label="任务状态" ${tokens[index].content.toLowerCase() === 'x' ? 'checked' : ''}> `;
md.renderer.rules.reader_alert_label = (tokens, index) => `<strong class="reader-label">${tokens[index].content}</strong>`;

export function renderReading(markdown: string, prefix = 'read-') {
  const tokens = md.parse(unpackMarkdown(markdown).body, {});
  const headings: ReaderHeading[] = []; const counts = new Map<string, number>();
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'heading_open') continue;
    const inline = tokens[i + 1];
    const text = inline.children?.filter(t => t.type !== 'html_inline').map(t => t.content).join('') || inline.content;
    const slug = headingSlug(text); const count = counts.get(slug) ?? 0; counts.set(slug, count + 1);
    const id = `${prefix}${slug}${count ? `-${count}` : ''}`;
    tokens[i].attrSet('id', id); headings.push({ text, level: Number(tokens[i].tag.slice(1)), position: headings.length, id });
  }
  const html = md.renderer.render(tokens, md.options, {});
  const safe = DOMPurify.sanitize(html, { ADD_ATTR: ['data-reader-embed', 'data-reader-mermaid'], FORBID_TAGS: ['style', 'form', 'iframe', 'object', 'embed'], FORBID_ATTR: ['srcset'] });
  const template = document.createElement('template'); template.innerHTML = safe;
  for (const element of template.content.querySelectorAll('[id]')) {
    if (!element.id.startsWith(prefix)) element.id = prefix + element.id;
  }
  for (const link of template.content.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
    const href = link.getAttribute('href')!.slice(1);
    if (template.content.getElementById(prefix + href)) link.setAttribute('href', '#' + prefix + href);
  }
  return { html: template.innerHTML, headings };
}
