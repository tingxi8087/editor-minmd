import { Extension, type Editor } from "@tiptap/core";
import { Table, TableView } from "@tiptap/extension-table";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { addColumnAfter, addRowAfter, columnResizing, isInTable, selectedRect, TableMap } from "@tiptap/pm/tables";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import "./table.less";

type Preview = "row" | "column" | "table" | null;
export const tableDeletePreview = new PluginKey<Preview>("tableDeletePreview");
export const TableDeletePreview = Extension.create({
  name: "tableDeletePreview",
  addProseMirrorPlugins() {
    return [new Plugin<Preview>({
      key: tableDeletePreview,
      state: {
        init: () => null,
        apply: (tr, previous) => tr.getMeta(tableDeletePreview) !== undefined ? tr.getMeta(tableDeletePreview) : tr.docChanged || tr.selectionSet ? null : previous,
      },
      props: {
        decorations(state) {
          const mode = tableDeletePreview.getState(state);
          if (!mode || !isInTable(state)) return DecorationSet.empty;
          const rect = selectedRect(state);
          const range = { ...rect, ...(mode !== "column" ? { left: 0, right: rect.map.width } : {}), ...(mode !== "row" ? { top: 0, bottom: rect.map.height } : {}) };
          return DecorationSet.create(state.doc, rect.map.cellsInRect(range).map(offset => {
            const pos = rect.tableStart + offset;
            return Decoration.node(pos, pos + state.doc.nodeAt(pos)!.nodeSize, { class: "table-delete-preview" });
          }));
        },
      },
    })];
  },
});

// Apply alignment to every row, including the header; Markdown represents it per column.
export function alignSelectedColumns(editor: Editor, align: "left" | "center" | "right") {
  if (!editor.isEditable || !isInTable(editor.state)) return false;
  const rect = selectedRect(editor.state);
  const tr = closeHistory(editor.state.tr);
  for (const offset of rect.map.cellsInRect({ left: rect.left, right: rect.right, top: 0, bottom: rect.map.height })) {
    const pos = rect.tableStart + offset;
    const node = tr.doc.nodeAt(pos)!;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, align });
  }
  editor.view.dispatch(tr); editor.view.focus(); return true;
}

export class QuickTableView extends TableView {
  private observer: MutationObserver;
  constructor(node: ProseMirrorNode, cellMinWidth: number, view: EditorView, attributes: Record<string, unknown> = {}) {
    super(node, cellMinWidth, view, attributes);
    const scroll = this.dom;
    this.dom = document.createElement("div"); this.dom.className = "table-quick-wrapper"; this.dom.append(scroll);
    for (const kind of ["row", "column"] as const) {
      const button = document.createElement("button");
      button.type = "button"; button.contentEditable = "false"; button.className = `table-append table-append-${kind}`;
      button.setAttribute("aria-label", kind === "row" ? "在表格末尾添加行" : "在表格末尾添加列");
      button.title = kind === "row" ? "在表格末尾添加行" : "在表格末尾添加列"; button.textContent = "+";
      button.onmousedown = event => event.preventDefault();
      button.onclick = () => {
        if (!view.editable) return;
        let tablePos: number | undefined;
        view.state.doc.descendants((current, pos) => {
          if (current.type.spec.tableRole === "table" && view.nodeDOM(pos) === this.dom) { tablePos = pos; return false; }
          return tablePos === undefined;
        });
        const cell = TableMap.get(this.node).map.at(-1);
        if (tablePos === undefined || cell === undefined) return;
        const tr = view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(tablePos + 1 + cell + 1)));
        view.dispatch(closeHistory(tr));
        (kind === "row" ? addRowAfter : addColumnAfter)(view.state, view.dispatch);
        view.focus();
      };
      this.dom.append(button);
    }
    const syncEditable = () => { this.dom.dataset.editable = String(view.editable); this.dom.querySelectorAll("button").forEach(button => { button.hidden = !view.editable; }); };
    this.observer = new MutationObserver(syncEditable); this.observer.observe(view.dom, { attributes: true, attributeFilter: ["contenteditable"] }); syncEditable();
  }
  stopEvent(event: Event) { return event.target instanceof Element && Boolean(event.target.closest(".table-append")); }
  destroy() { this.observer.disconnect(); }
}

// Native row insertion leaves align empty. Normalize columns using the same
// first explicit alignment rule as Markdown serialization. appendTransaction
// joins the originating history event, so adding a row remains one undo step.
const columnAlignment = () => new Plugin({
  appendTransaction(transactions, _oldState, state) {
    if (!transactions.some(transaction => transaction.docChanged)) return null;
    const tr = state.tr;
    state.doc.descendants((table, tablePos) => {
      if (table.type.spec.tableRole !== "table") return;
      const map = TableMap.get(table);
      for (let column = 0; column < map.width; column++) {
        const offsets = [...new Set(Array.from({ length: map.height }, (_, row) => map.map[row * map.width + column]))];
        const align = offsets.map(offset => table.nodeAt(offset)?.attrs.align).find(value => value === "left" || value === "center" || value === "right");
        if (!align) continue;
        for (const offset of offsets) {
          const pos = tablePos + 1 + offset;
          const cell = tr.doc.nodeAt(pos)!;
          if (cell.attrs.align !== align) tr.setNodeMarkup(pos, undefined, { ...cell.attrs, align });
        }
      }
      return false;
    });
    return tr.docChanged ? tr : null;
  },
});

// Sessions are constructed read-only before React attaches their editor content.
// Register resizing at creation regardless of that transient state; its handlers
// check view.editable. Always supply the same NodeView for subsequent React mounts.
export const InteractiveTable = Table.extend({
  addProseMirrorPlugins() {
    const plugins = [...(this.parent?.() ?? []), columnAlignment()];
    if (!this.options.resizable || this.editor.isEditable) return plugins;
    return [columnResizing({ handleWidth: this.options.handleWidth, cellMinWidth: this.options.cellMinWidth, defaultCellMinWidth: this.options.cellMinWidth, View: this.options.View, lastColumnResizable: this.options.lastColumnResizable }), ...plugins];
  },
  addNodeView() {
    return ({ node, view, HTMLAttributes }) => new QuickTableView(node, this.options.cellMinWidth, view, HTMLAttributes);
  },
});
