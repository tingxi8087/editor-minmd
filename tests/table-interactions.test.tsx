// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import { fireEvent, render, screen, cleanup, act } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CellSelection, TableMap } from "@tiptap/pm/tables";
import { editorExtensions } from "../src/components/DocumentEditor/extensions";
import { alignSelectedColumns, tableDeletePreview } from "../src/components/DocumentEditor/table";
import { EditorContent } from "@tiptap/react";
import { columnResizingPluginKey } from "@tiptap/pm/tables";
import TableContextMenu from "../src/components/TableContextMenu";
const editors: Editor[] = [];
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
async function setup() {
  const wrapper = document.createElement("div"); wrapper.className = "workspace"; document.body.append(wrapper);
  const element = document.createElement("div"); wrapper.append(element);
  const editor = new Editor({ element, extensions: editorExtensions(), editable: false, content: "| A | B | C |\n| --- | --- | --- |\n| a | b | c |\n| d | e | f |", contentType: "markdown" });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  act(() => { editor.setEditable(true, false); });
  editors.push(editor); render(<><EditorContent editor={editor} /><TableContextMenu editor={editor} /></>, { container: wrapper.appendChild(document.createElement("div")) });
  return { editor, element: wrapper };
}
function open(element: HTMLElement, cellIndex = 0, x = 100, y = 100) {
  fireEvent.contextMenu(element.querySelectorAll("th,td")[cellIndex], { clientX: x, clientY: y });
  return screen.getByRole("menu", { name: "表格操作" });
}
afterEach(() => { cleanup(); editors.splice(0).forEach(editor => editor.destroy()); document.body.replaceChildren(); });
describe("table interactions", () => {
  it("appends at table edges, retains content and undoes one operation", async () => {
    const { editor, element } = await setup(); const before = editor.getMarkdown();
    expect(columnResizingPluginKey.getState(editor.state)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "在表格末尾添加列" }));
    expect(element.querySelectorAll("th")).toHaveLength(4); expect(element.querySelector("th")?.textContent).toBe("A");
    act(() => { editor.commands.undo(); }); expect(editor.getMarkdown().trim()).toBe(before.trim());
    fireEvent.click(screen.getByRole("button", { name: "在表格末尾添加行" })); expect(element.querySelectorAll("tr")).toHaveLength(4);
    act(() => { editor.commands.undo(); }); expect(editor.getMarkdown().trim()).toBe(before.trim());
  });
  it.each([ ["在上方插入行", 4, 3], ["在下方插入行", 4, 3], ["在左侧插入列", 3, 4], ["在右侧插入列", 3, 4] ])("%s supports undo", async (label, rows, cols) => {
    const { editor, element } = await setup(); const before = editor.getMarkdown(); open(element, 4);
    fireEvent.click(screen.getByRole("menuitem", { name: String(label) }));
    expect(element.querySelectorAll("tr")).toHaveLength(Number(rows)); expect(element.querySelector("tr")?.children).toHaveLength(Number(cols));
    act(() => { editor.commands.undo(); }); expect(editor.getMarkdown().trim()).toBe(before.trim());
  });
  it.each(["left", "center", "right"] as const)("aligns entire selected column %s and preserves Markdown roundtrip", async align => {
    const { editor } = await setup();
    act(() => { const table = editor.state.doc.firstChild!; const map = TableMap.get(table); editor.commands.setTextSelection(1 + map.map[4] + 2); alignSelectedColumns(editor, align); });
    const json = (editor.getJSON() as JSONContent).content![0];
    expect(json.content!.map(row => row.content![1].attrs?.align)).toEqual([align, align, align]);
    expect(json.content!.map(row => row.content![0].attrs?.align)).toEqual([null, null, null]);
    const markdown = editor.getMarkdown(); const other = new Editor({ extensions: editorExtensions(), content: markdown, contentType: "markdown" }); editors.push(other);
    expect((other.getJSON() as JSONContent).content![0].content!.map(row => row.content![1].attrs?.align)).toEqual([align, align, align]);
    act(() => { editor.commands.undo(); }); expect((editor.getJSON() as JSONContent).content![0].content![0].content![1].attrs?.align).toBeNull();
  });
  it("previews deletion range without editing and removes selected rows in one undo", async () => {
    const { editor, element } = await setup(); const before = editor.getMarkdown();
    const map = TableMap.get(editor.state.doc.firstChild!);
    act(() => { editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, 1 + map.map[3], 1 + map.map[6]))); });
    open(element, 3);
    const remove = screen.getByRole("menuitem", { name: "删除选中 2 行" }); fireEvent.mouseEnter(remove);
    expect(element.querySelectorAll(".table-delete-preview")).toHaveLength(6); expect(editor.getMarkdown().trim()).toBe(before.trim());
    fireEvent.click(remove); expect(element.querySelectorAll("tr")).toHaveLength(1);
    act(() => { editor.commands.undo(); }); expect(editor.getMarkdown().trim()).toBe(before.trim());
  });
  it("previews columns and deletes the whole table when every column is selected", async () => {
    const { editor, element } = await setup(); const before = editor.getMarkdown(); const map = TableMap.get(editor.state.doc.firstChild!);
    act(() => { editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, 1 + map.map[0], 1 + map.map[2]))); });
    open(element, 1); const remove = screen.getByRole("menuitem", { name: "删除选中 3 列" }); fireEvent.focus(remove);
    expect(element.querySelectorAll(".table-delete-preview")).toHaveLength(9);
    fireEvent.click(remove); expect(element.querySelector("table")).toBeNull();
    act(() => { editor.commands.undo(); }); expect(editor.getMarkdown().trim()).toBe(before.trim());
  });
  it("provides whole-table delete preview, keyboard movement and Escape clears preview", async () => {
    const { editor, element } = await setup(); const menu = open(element, 4);
    const first = screen.getByRole("menuitem", { name: "在上方插入行" }); expect(document.activeElement).toBe(first);
    fireEvent.keyDown(menu, { key: "End" }); expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "删除表格" }));
    expect(element.querySelectorAll(".table-delete-preview")).toHaveLength(9);
    fireEvent.keyDown(menu, { key: "Escape" }); expect(screen.queryByRole("menu")).toBeNull(); expect(tableDeletePreview.getState(editor.state)).toBeNull();
    open(element); fireEvent.click(screen.getByRole("menuitem", { name: "删除表格" })); expect(element.querySelector("table")).toBeNull();
  });
  it("closes in read mode, hides controls and rejects mutations even with emitUpdate false", async () => {
    const { editor, element } = await setup(); const before = editor.getMarkdown(); open(element);
    await act(async () => { editor.setEditable(false, false); await Promise.resolve(); });
    expect(screen.queryByRole("menu")).toBeNull(); expect(screen.queryByRole("button", { name: "在表格末尾添加行" })).toBeNull();
    fireEvent.contextMenu(element.querySelector("td")!); expect(screen.queryByRole("menu")).toBeNull();
    expect(alignSelectedColumns(editor, "right")).toBe(false); expect(editor.getMarkdown().trim()).toBe(before.trim());
    await act(async () => { editor.setEditable(true, false); await Promise.resolve(); });
    expect(screen.getByRole("button", { name: "在表格末尾添加行" })).toBeTruthy();
  });
  it("deletes a single column without affecting the others and undoes it", async () => {
    const { editor, element } = await setup(); const before = editor.getMarkdown(); open(element, 4);
    fireEvent.click(screen.getByRole("menuitem", { name: "删除当前列" }));
    expect(element.querySelector("tr")?.children).toHaveLength(2); expect(element.querySelector("tr")?.textContent).toBe("AC");
    act(() => { editor.commands.undo(); }); expect(editor.getMarkdown().trim()).toBe(before.trim());
  });
  it("aligns all selected columns through the context menu without changing the remaining column", async () => {
    const { editor, element } = await setup(); const map = TableMap.get(editor.state.doc.firstChild!);
    act(() => { editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, 1 + map.map[4], 1 + map.map[5]))); });
    open(element, 4); fireEvent.click(screen.getByRole("menuitem", { name: "列居中对齐" }));
    expect(Array.from(element.querySelectorAll("tr"), row => Array.from(row.children, cell => (cell as HTMLElement).style.textAlign))).toEqual([["", "center", "center"], ["", "center", "center"], ["", "center", "center"]]);
    const source = editor.getMarkdown(); expect(source).toContain(":---:");
  });
  it("keeps the menu inside viewport and closes on scroll and outside pointer", async () => {
    const { element } = await setup(); const menu = open(element, 0, window.innerWidth + 50, window.innerHeight + 50);
    expect(Number.parseFloat(menu.style.left)).toBeLessThan(window.innerWidth);
    expect(Number.parseFloat(menu.style.top)).toBeLessThan(window.innerHeight);
    fireEvent.scroll(window); expect(screen.queryByRole("menu")).toBeNull();
    open(element); fireEvent.pointerDown(document.body); expect(screen.queryByRole("menu")).toBeNull();
  });
  it.each(["上方", "下方", "末尾"])("new row at %s inherits column alignment in the same undo step", async position => {
    const { editor, element } = await setup();
    act(() => { editor.commands.setTextSelection(4); alignSelectedColumns(editor, "center"); });
    const before = editor.getMarkdown();
    if (position === "末尾") fireEvent.click(screen.getByRole("button", { name: "在表格末尾添加行" }));
    else { open(element, position === "上方" ? 0 : 3); fireEvent.click(screen.getByRole("menuitem", { name: `在${position}插入行` })); }
    expect(Array.from(element.querySelectorAll("tr"), row => (row.firstElementChild as HTMLElement).style.textAlign)).toEqual(["center", "center", "center", "center"]);
    expect(Array.from(element.querySelectorAll("tr"), row => (row.children[1] as HTMLElement).style.textAlign)).toEqual(["", "", "", ""]);
    const after = editor.getMarkdown();
    act(() => { editor.commands.undo(); }); expect(editor.getMarkdown().trim()).toBe(before.trim());
    expect(element.querySelectorAll("tr")).toHaveLength(3);
    act(() => { editor.commands.redo(); }); expect(editor.getMarkdown().trim()).toBe(after.trim());
    expect(Array.from(element.querySelectorAll("tr"), row => (row.firstElementChild as HTMLElement).style.textAlign)).toEqual(["center", "center", "center", "center"]);
  });
  it("stores temporary column width in session only, not Markdown", async () => {
    const { editor, element } = await setup(); const before = editor.getMarkdown();
    act(() => { editor.commands.setTextSelection(4); editor.commands.setCellAttribute("colwidth", [180]); });
    expect(element.querySelector("col")?.style.width).toBe("180px"); expect(editor.getMarkdown().trim()).toBe(before.trim());
    const reload = new Editor({ extensions: editorExtensions(), content: before, contentType: "markdown" }); editors.push(reload);
    expect((reload.getJSON() as JSONContent).content![0].content![0].content![0].attrs?.colwidth).toBeNull();
  });
});
