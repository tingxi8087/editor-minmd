// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { editorExtensions } from "../src/components/DocumentEditor/extensions";
import { replaceEditorDocument } from "../src/components/DocumentEditor/session";

const editors: Editor[] = [];
afterEach(() => { editors.forEach((editor) => editor.destroy()); editors.length = 0; });
describe("document editing sessions", () => {
  it("starts a fresh undo history on file open, and supports edit / undo / redo", () => {
    const editor = new Editor({ extensions: editorExtensions(), content: "# Previous file", contentType: "markdown" });
    editors.push(editor);
    replaceEditorDocument(editor, "# 中文文件\n\n正文");
    expect(editor.can().undo()).toBe(false);
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, "实际编辑");
    expect(editor.getMarkdown()).toContain("实际编辑");
    expect(editor.can().undo()).toBe(true);
    editor.commands.undo();
    expect(editor.getMarkdown()).not.toContain("实际编辑");
    expect(editor.getMarkdown()).toContain("中文文件");
    editor.commands.redo();
    expect(editor.getMarkdown()).toContain("实际编辑");
    replaceEditorDocument(editor, "# Second file");
    expect(editor.can().undo()).toBe(false);
    const secondFile = editor.getJSON();
    editor.commands.undo();
    expect(editor.getJSON()).toEqual(secondFile);
    expect(editor.getText()).toContain("Second file");
    expect(editor.getText()).not.toContain("中文文件");
  });
  it("view-only changes must not emit content updates or change Markdown", () => {
    let updates = 0;
    const editor = new Editor({ extensions: editorExtensions(), content: "# 原文\n\n正文", contentType: "markdown", onUpdate: () => { updates++; } });
    editors.push(editor);
    const original = editor.getMarkdown();
    editor.setEditable(false, false);
    editor.setEditable(true, false);
    expect(updates).toBe(0);
    expect(editor.getMarkdown()).toBe(original);
  });
});
