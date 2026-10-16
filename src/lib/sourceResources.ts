import { parser, GFM } from '@lezer/markdown';
import { unpackMarkdown } from './markdown';
import { isLocalReference, rebaseReference } from './resources';
const markdownParser = parser.configure(GFM);
// Change only standard Markdown URL ranges. Code, frontmatter, labels and ordinary text stay byte-for-byte intact.
export function sourceReferenceTokens(content: string) {
  const prefix = unpackMarkdown(content); const start = prefix.bom.length + prefix.prefix.length;
  const body = content.slice(start);
  const references: { token: string; value: string }[] = [];
  const replacements: { from: number; to: number; text: string }[] = [];
  const tree = markdownParser.parse(body);
  tree.iterate({ enter(node) {
    if (node.name !== 'URL') return;
    const parent = node.node.parent;
    if (!parent || !['Link', 'Image', 'LinkReference'].includes(parent.name)) return;
    if (parent.name === 'LinkReference' && body.slice(parent.from, parent.to).startsWith('[^')) return;
    let from = node.from; let to = node.to;
    if (body[from] === '<' && body[to - 1] === '>') { from++; to--; }
    const value = body.slice(from, to).replace(/\\([\\()[\] <>])/g, '$1');
    if (!isLocalReference(value)) return;
    const token = `minmd-resource-${crypto.randomUUID()}`;
    references.push({ token, value }); replacements.push({ from: from + start, to: to + start, text: token });
  } });
  // Wiki destinations are not standard Markdown URL nodes. Preserve aliases and
  // heading spelling; only relocate the local filename on Save As.
  for (const match of body.matchAll(/!?\[\[([^\]\n|#]+)(?:#[^\]\n|]*)?(?:\|[^\]\n]*)?\]\]/g)) {
    const at = match.index!;
    let node = tree.resolveInner(at, 1); let excluded = false;
    for (;;) {
      if (['InlineCode', 'FencedCode', 'CodeBlock', 'HTMLBlock', 'HTMLTag', 'Comment'].includes(node.name)) excluded = true;
      if (!node.parent) break; node = node.parent;
    }
    if (excluded || (at > 0 && body[at - 1] === '\\')) continue;
    const target = match[1];
    if (!isLocalReference(target)) continue;
    const value = /\.[^/]+$/.test(target) ? target : `${target}.md`;
    const token = `minmd-resource-${crypto.randomUUID()}`;
    const offset = at + match[0].indexOf('[[') + 2;
    references.push({ token, value }); replacements.push({ from: start + offset, to: start + offset + target.length, text: token });
  }
  for (const replacement of replacements.sort((a, b) => b.from - a.from)) content = content.slice(0, replacement.from) + replacement.text + content.slice(replacement.to);
  return { content, references };
}

export function rebaseSourceContent(content: string, from: string, to: string) {
  if (from === to) return content;
  const prepared = sourceReferenceTokens(content);
  for (const reference of prepared.references) prepared.content = prepared.content.replace(reference.token, rebaseReference(reference.value, from, to));
  return prepared.content;
}
