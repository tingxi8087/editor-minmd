// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SlashMenu from "../src/components/SlashMenu";
import { editorExtensions } from "../src/components/DocumentEditor/extensions";

Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect(40, 70, 1, 20);
window.scrollBy = vi.fn();
const editors: Editor[] = [];
afterEach(() => { cleanup(); editors.splice(0).forEach(editor => editor.destroy()); });
function setup(text = "/", attrs?: { type: string; attrs?: Record<string, unknown> }, workspace = false) {
  const editor = new Editor({ extensions: editorExtensions(), content: { type: "doc", content: [{ type: attrs?.type ?? "paragraph", attrs: attrs?.attrs, content: text ? [{ type: "text", text }] : [] }] } });
  editors.push(editor);
  vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({ left: 40, right: 41, top: 70, bottom: 90 });
  const onInsert = vi.fn();
  const content = <><EditorContent editor={editor} /><SlashMenu editor={editor} onInsert={onInsert} /></>;
  render(workspace ? <div className="workspace" data-theme="dark" style={{ "--paper": "#242422", "--ink": "#e9e6df" } as React.CSSProperties}>{content}</div> : content);
  act(() => { editor.commands.focus("end"); editor.view.focus(); editor.commands.setTextSelection(text.length + 1); });
  return { editor, onInsert };
}
const key = (editor: Editor, name: string, properties = {}) => fireEvent.keyDown(editor.view.dom, { key: name, ...properties });

describe("slash insertion menu", () => {
  it("portals inside the workspace so dark theme variables remain inherited", () => {
    setup("/", undefined, true);
    const menu = screen.getByRole("listbox");
    const workspace = menu.closest<HTMLElement>(".workspace");
    expect(menu.parentElement).toBe(workspace);
    expect(workspace?.dataset.theme).toBe("dark");
    expect(workspace?.style.getPropertyValue("--paper")).toBe("#242422");
    expect(workspace?.style.getPropertyValue("--ink")).toBe("#e9e6df");
  });
  it("offers all supported blocks without callouts or folds", () => {
    setup();
    expect(screen.getAllByRole("option")).toHaveLength(20);
    expect(screen.queryByText("高亮块")).toBeNull();
    expect(screen.queryByText("折叠块")).toBeNull();
  });
  it.each(["标题", "heading", "bt", "biaoti"])("filters Chinese, English and pinyin: %s", query => {
    setup(`/${query}`);
    expect(screen.getAllByRole("option")).toHaveLength(6);
    expect(screen.getByRole("option", { name: /标题 1/ })).toBeTruthy();
  });
  it("uses arrow navigation and inserts heading as one undoable transaction", () => {
    const { editor } = setup("/heading");
    key(editor, "ArrowDown");
    key(editor, "Enter");
    expect(editor.state.doc.firstChild?.type.name).toBe("heading");
    expect(editor.state.doc.firstChild?.attrs.level).toBe(2);
    expect(editor.state.doc.textContent).toBe("");
    act(() => { editor.commands.undo(); });
    expect(editor.getText()).toBe("/heading");
    expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
  });
  it("keeps freshly typed slash text separate from the insertion undo group", () => {
    const { editor } = setup("");
    act(() => { editor.commands.insertContent("/h2"); });
    key(editor, "Enter");
    expect(editor.state.doc.firstChild?.type.name).toBe("heading");
    expect(editor.state.doc.firstChild?.attrs.level).toBe(2);
    act(() => { editor.commands.undo(); });
    expect(editor.state.doc.textContent).toBe("/h2");
    expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
  });
  it.each([
    ["/wx", "bulletList"], ["/yx", "orderedList"], ["/rw", "taskList"], ["/quote", "blockquote"], ["/code", "codeBlock"], ["/fgx", "horizontalRule"], ["/bg", "table"],
  ])("inserts the requested structure: %s", (query, node) => {
    const { editor } = setup(query);
    key(editor, "Enter");
    expect(editor.state.doc.firstChild?.type.name).toBe(node);
    expect(editor.getText()).not.toContain(query);
    if (node === "table") {
      expect(editor.state.doc.firstChild?.childCount).toBe(3);
      expect(editor.state.doc.firstChild?.firstChild?.childCount).toBe(3);
    }
  });
  it("inserts Mermaid language and a renderable starter diagram", () => {
    const { editor } = setup("/mermaid");
    key(editor, "Enter");
    expect(editor.state.doc.firstChild?.attrs.language).toBe("mermaid");
    expect(editor.getText()).toContain("A[开始] --> B[结束]");
  });
  it.each(["image", "emoji", "date", "reference", "link"])("passes %s range without deleting text while opening a chooser", kind => {
    const { editor, onInsert } = setup(`/${kind}`);
    key(editor, "Enter");
    expect(onInsert).toHaveBeenCalledWith(kind, { from: 1, to: kind.length + 2 });
    expect(editor.getText()).toBe(`/${kind}`);
    act(() => { editor.view.dispatch(editor.state.tr.setMeta("selection", true)); });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
  it("limits inline operations and preserves the preceding text", () => {
    const { editor, onInsert } = setup("你好 /date");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    key(editor, "Enter");
    expect(onInsert).toHaveBeenCalledWith("date", { from: 4, to: 9 });
    expect(editor.getText()).toBe("你好 /date");
  });
  it("Escape stays dismissed on selection and metadata transactions, reopens when query changes", () => {
    const { editor } = setup();
    key(editor, "Escape");
    act(() => { editor.commands.setTextSelection(2); editor.view.dispatch(editor.state.tr.setMeta("foo", 1)); });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(editor.getText()).toBe("/");
    act(() => { editor.commands.insertContent("table"); });
    expect(screen.getByRole("option", { name: "表格" })).toBeTruthy();
  });
  it("does not intercept IME Enter", () => {
    const { editor, onInsert } = setup("/date");
    key(editor, "Enter", { isComposing: true, keyCode: 229 });
    expect(onInsert).not.toHaveBeenCalled();
    expect(editor.getText()).toContain("/date");
  });
  it("does not open in code blocks or read-only mode", () => {
    const { editor } = setup("/table", { type: "codeBlock", attrs: { language: "text" } });
    expect(screen.queryByRole("listbox")).toBeNull();
    act(() => { editor.commands.setContent("<p>/table</p>"); editor.setEditable(false); });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
  it("closes on nonempty selection and does not change document scrolling", () => {
    const { editor } = setup("/date");
    expect(document.body.style.overflow).toBe("");
    act(() => { editor.commands.setTextSelection({ from: 1, to: 3 }); });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
  it("places upward near the lower edge and clamps its horizontal position", () => {
    const { editor } = setup();
    vi.mocked(editor.view.coordsAtPos).mockReturnValue({ left: 9999, right: 10000, top: window.innerHeight - 50, bottom: window.innerHeight - 30 });
    act(() => { window.dispatchEvent(new Event("resize")); });
    const menu = screen.getByRole("listbox");
    expect(parseFloat(menu.style.top)).toBe(window.innerHeight - 55);
    expect(menu.style.transform).toBe("translateY(-100%)");
    expect(parseFloat(menu.style.left)).toBeLessThan(window.innerWidth);
  });
  it("anchors a single filtered result just above the caret instead of reserving a full menu height", () => {
    const { editor } = setup("/table");
    const caretTop = window.innerHeight - 50;
    vi.mocked(editor.view.coordsAtPos).mockReturnValue({ left: 40, right: 41, top: caretTop, bottom: caretTop + 20 });
    act(() => { window.dispatchEvent(new Event("resize")); });
    const menu = screen.getByRole("listbox");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(menu.style.top).toBe(`${caretTop - 5}px`);
    expect(menu.style.transform).toBe("translateY(-100%)");
    expect(parseFloat(menu.style.maxHeight)).toBeLessThanOrEqual(caretTop - 8);
  });
  it("follows document scrolling and hides once the caret leaves the viewport", () => {
    const { editor } = setup();
    vi.mocked(editor.view.coordsAtPos).mockReturnValue({ left: 40, right: 41, top: -50, bottom: -30 });
    act(() => { window.dispatchEvent(new Event("scroll")); });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });
  it("shows no-match feedback without deleting the query", () => {
    const { editor } = setup("/不存在");
    expect(screen.getByText("没有匹配的操作")).toBeTruthy();
    key(editor, "Enter");
    expect(editor.getText()).toBe("/不存在");
  });
});
