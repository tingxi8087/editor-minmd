import type { Editor, JSONContent } from '@tiptap/core';

export function fileURL(path: string) {
  const normalized = path.replace(/\\/g, '/');
  return new URL(`file://${normalized.startsWith('/') ? '' : '/'}${normalized.split('/').map((part, index) => index === 0 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part)).join('/')}`);
}
export function isLocalReference(value: string) {
  return !!value && !value.startsWith('#') && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value);
}
// URL segments stay encoded, including Chinese names, spaces, parentheses and # in filenames.
export function rebaseReference(value: string, from: string, to: string) {
  if (!isLocalReference(value) || from === to) return value;
  const target = new URL(value, fileURL(from));
  const base = new URL('.', fileURL(to));
  if (target.host !== base.host || target.pathname.slice(0, 3).match(/^\/[A-Z]:/i)?.[0] !== base.pathname.slice(0, 3).match(/^\/[A-Z]:/i)?.[0]) return target.href;
  const a = base.pathname.split('/').filter(Boolean); const b = target.pathname.split('/').filter(Boolean);
  while (a.length && b.length && a[0] === b[0]) { a.shift(); b.shift(); }
  return `${'../'.repeat(a.length)}${b.join('/')}${target.search}${target.hash}`.replace(/\(/g, '%28').replace(/\)/g, '%29');
}
export function mapReferences(json: JSONContent, map: (value: string) => string): JSONContent {
  return {
    ...json,
    ...(json.attrs && { attrs: { ...json.attrs, ...(json.type === 'image' && { src: map(String(json.attrs.src ?? '')) }) } }),
    ...(json.marks && { marks: json.marks.map(mark => mark.type === 'link' ? { ...mark, attrs: { ...mark.attrs, href: map(String(mark.attrs?.href ?? '')) } } : mark) }),
    ...(json.content && { content: json.content.map(node => mapReferences(node, map)) }),
  };
}
export function referenceMarkdown(editor: Editor, map: (value: string) => string) {
  return editor.storage.markdown.manager.serialize(mapReferences(editor.getJSON(), map));
}
export function validLink(value: string) {
  return !!value.trim() && !/[\u0000-\u001f]/.test(value) && !value.startsWith('//') && (!/^[a-z][a-z\d+.-]*:/i.test(value) || /^(https?:|file:)/i.test(value));
}
