import { describe, expect, it } from "vitest";
import { MarkdownManager } from "@tiptap/markdown";
import { editorExtensions } from "../src/components/DocumentEditor/extensions";
import { packMarkdown, unpackMarkdown, unsupportedMarkdown } from "../src/lib/markdown";

describe("Markdown file fidelity", () => {
  it("keeps BOM, CRLF and YAML while serializing edited body", () => {
    const source = "\uFEFF---\r\ntitle: 测试\r\n---\r\n# 原标题\r\n";
    expect(packMarkdown("# 新标题\n", unpackMarkdown(source))).toBe("\uFEFF---\r\ntitle: 测试\r\n---\r\n# 新标题\r\n");
  });
  it("does not introduce a final newline into a file without one", () => {
    expect(packMarkdown("新内容\n", unpackMarkdown("旧内容"))).toBe("新内容");
  });
  it("protects unsupported constructs and does not flag HTML in code fences", () => {
    expect(unsupportedMarkdown("正文[^1]\n\n[^1]: 脚注")).toBe("脚注");
    expect(unsupportedMarkdown("<!-- keep -->")).toBe("内嵌 HTML");
    expect(unsupportedMarkdown("````html\n<div>hello</div>\n```\n````")).toBeNull();
    expect(unsupportedMarkdown("~~~\n<div>hello</div>\n~~~")).toBeNull();
  });
  it("roundtrips common document structures through the actual editor schema", () => {
    const manager = new MarkdownManager({ extensions: editorExtensions() });
    const input = "# 中文标题\n\n**粗体**和*斜体*以及~~删除~~\n\n- [x] 完成\n- [ ] 待办\n\n> 引用\n\n| 名称 | 值 |\n| --- | --- |\n| 测试 | 123 |\n\n```ts\nconst a = 1;\n```\n";
    const parsed = manager.parse(input);
    const output = manager.serialize(parsed);
    const types = parsed.content?.map((node) => node.type);
    expect(types).toEqual(expect.arrayContaining(["heading", "paragraph", "taskList", "blockquote", "table", "codeBlock"]));
    expect(manager.parse(output)).toEqual(parsed);
    expect(output).toContain("中文标题");
    expect(output).toContain("const a = 1;");
  });
});
