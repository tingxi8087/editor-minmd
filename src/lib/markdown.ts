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
export function unsupportedMarkdown(body: string): string | null {
  let fence: { char: string; length: number } | null = null;
  for (const line of body.split("\n")) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (marker) {
      if (!fence) fence = { char: marker[1][0], length: marker[1].length };
      else if (marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (fence || /^(?: {4}|\t)/.test(line)) continue;
    if (/^ {0,3}\[\^[^\]]+\]:/.test(line) || /\[\^[^\]]+\]/.test(line)) return "脚注";
    if (/^\s*\$\$/.test(line)) return "数学公式";
    if (/<\/?[A-Za-z][^>]*>|<!--/.test(line)) return "内嵌 HTML";
    if (/^\s*:::+/.test(line) || /!?(?:\[\[[^\]]+\]\])/.test(line)) return "自定义 Markdown 语法";
    if (/^ {0,3}>\s*\[![A-Za-z]+\]/.test(line)) return "提示块扩展";
  }
  if (fence) return "未闭合代码块";
  return null;
}
