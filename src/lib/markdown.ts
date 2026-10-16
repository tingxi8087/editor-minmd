import MarkdownIt from "markdown-it";

export interface MarkdownEnvelope {
  body: string;
  prefix: string;
  newline: "\n" | "\r\n";
  bom: string;
  trailingNewline: boolean;
}

// YAML metadata is kept byte-for-byte outside the editable document schema.
export function unpackMarkdown(raw: string): MarkdownEnvelope {
  const bom = raw.startsWith("\uFEFF") ? "\uFEFF" : "";
  const text = raw.slice(bom.length);
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const frontmatter = text.match(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/)?.[0] ?? "";
  return { body: text.slice(frontmatter.length).replace(/\r\n/g, "\n"), prefix: frontmatter, newline, bom, trailingNewline: /\n$/.test(text) };
}

export function packMarkdown(body: string, envelope: MarkdownEnvelope): string {
  const normalized = body.replace(/\r\n/g, "\n").replace(/\n+$/, "");
  return envelope.bom + envelope.prefix + normalized.replace(/\n/g, envelope.newline) + (envelope.trailingNewline ? envelope.newline : "");
}

// This first version deliberately limits rich editing to representable Markdown.
// Keep unfamiliar constructs available as original source, rather than silently dropping them.
const syntaxParser = new MarkdownIt({ html: true });
syntaxParser.block.ruler.disable('reference');
export function unsupportedMarkdown(body: string): string | null {
  const protectedBody = body.replace(/\\([\\`*{}\[\]()#+.!<>$:-])/g, '＿');
  const tokens = syntaxParser.parse(protectedBody, {});
  for (const token of tokens) {
    if (token.type === 'html_block') return '内嵌 HTML';
    if (token.type === 'fence') {
      const end = token.map?.[1] ?? 0;
      const last = (body.split('\n')[end - 1] ?? '').replace(/^\s*(?:>\s*)+/, '');
      const closing = last.trim().match(/^(`{3,}|~{3,})$/)?.[1];
      if (!closing || closing[0] !== token.markup[0] || closing.length < token.markup.length || (token.map && end - token.map[0] < 2)) return '未闭合代码块';
    }
    if (token.type !== 'inline') continue;
    for (const child of token.children ?? []) {
      if (child.type === 'html_inline') return '内嵌 HTML';
      if (child.type !== 'text') continue;
      const text = child.content;
      if (/\[\^[^\]]+\]|\^\[/.test(text)) return '脚注';
      if (/\$\$|\$[^$\n]+\$/.test(text)) return '数学公式';
      if (/(?:^|\n)\s*:::+|!?\[\[[^\]]+\]\]/.test(text)) return '自定义 Markdown 语法';
      if (/^\[![A-Za-z]+\]/.test(text)) return '提示块扩展';
    }
  }
  return null;
}
