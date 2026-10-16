import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { CellSelection, cellAround, isInTable, selectedRect } from "@tiptap/pm/tables";
import { alignSelectedColumns, tableDeletePreview } from "../DocumentEditor/table";
import styles from "./index.module.less";

type Menu = { x: number; y: number; rows: number; columns: number };
export default function TableContextMenu({ editor }: { editor: Editor }) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const preview = (mode: "row" | "column" | "table" | null) => { if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(tableDeletePreview, mode)); };
  const close = () => { setMenu(null); preview(null); };
  useEffect(() => {
    let dom: HTMLElement | undefined;
    const context = (event: MouseEvent) => {
      const cell = event.target instanceof Element ? event.target.closest("td,th") : null;
      if (!cell || !dom?.contains(cell) || !editor.isEditable) return;
      const $cell = cellAround(editor.state.doc.resolve(editor.view.posAtDOM(cell, 0)));
      if (!$cell) return;
      event.preventDefault();
      let inside = false;
      if (editor.state.selection instanceof CellSelection) editor.state.selection.forEachCell((_node, pos) => { if (pos === $cell.pos) inside = true; });
      if (!inside) editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve($cell.pos + 1))));
      const rect = selectedRect(editor.state); preview(null);
      setMenu({ x: event.clientX, y: event.clientY, rows: rect.bottom - rect.top, columns: rect.right - rect.left });
    };
    const down = (event: MouseEvent) => { if (event.button === 2 && editor.isEditable && event.target instanceof Element && event.target.closest("td,th")) event.preventDefault(); };
    const hide = () => { setMenu(null); preview(null); };
    const bind = () => { dom = editor.view.dom; dom.addEventListener("mousedown", down); dom.addEventListener("contextmenu", context); };
    if (editor.isInitialized) bind(); else editor.on("create", bind);
    editor.on("update", hide); editor.on("selectionUpdate", hide);
    const observe = new MutationObserver(() => { if (!editor.isEditable) hide(); });
    if (dom) observe.observe(dom, { attributes: true, attributeFilter: ["contenteditable"] });
    return () => { editor.off("create", bind); dom?.removeEventListener("mousedown", down); dom?.removeEventListener("contextmenu", context); editor.off("update", hide); editor.off("selectionUpdate", hide); observe.disconnect(); };
  }, [editor]);
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const x = Math.max(6, Math.min(menu.x, window.innerWidth - rect.width - 6));
    const y = Math.max(6, Math.min(menu.y, window.innerHeight - rect.height - 6));
    if (x !== menu.x || y !== menu.y) setMenu({ ...menu, x, y });
    menuRef.current.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [menu?.x, menu?.y]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) close(); };
    const hide = () => close();
    document.addEventListener("pointerdown", outside, true); window.addEventListener("scroll", hide, true); window.addEventListener("resize", hide);
    return () => { document.removeEventListener("pointerdown", outside, true); window.removeEventListener("scroll", hide, true); window.removeEventListener("resize", hide); if (!editor.isDestroyed) preview(null); };
  }, [Boolean(menu), editor]);
  if (!menu) return null;
  const mutate = (command: "addRowBefore" | "addRowAfter" | "addColumnBefore" | "addColumnAfter" | "deleteRow" | "deleteColumn" | "deleteTable") => {
    if (!editor.isEditable || !isInTable(editor.state)) return;
    const rect = selectedRect(editor.state);
    const target = command === "deleteRow" && rect.top === 0 && rect.bottom === rect.map.height || command === "deleteColumn" && rect.left === 0 && rect.right === rect.map.width ? "deleteTable" : command;
    editor.chain().focus().command(({ tr }) => { closeHistory(tr); return true; })[target]().run();
  };
  const items: { label: string; run: () => unknown; preview?: "row" | "column" | "table"; separator?: boolean }[] = [
    { label: "在上方插入行", run: () => mutate("addRowBefore") },
    { label: "在下方插入行", run: () => mutate("addRowAfter") },
    { label: "在左侧插入列", run: () => mutate("addColumnBefore") },
    { label: "在右侧插入列", run: () => mutate("addColumnAfter") },
    { label: "列左对齐", separator: true, run: () => alignSelectedColumns(editor, "left") },
    { label: "列居中对齐", run: () => alignSelectedColumns(editor, "center") },
    { label: "列右对齐", run: () => alignSelectedColumns(editor, "right") },
    { label: menu.rows > 1 ? `删除选中 ${menu.rows} 行` : "删除当前行", separator: true, preview: "row", run: () => mutate("deleteRow") },
    { label: menu.columns > 1 ? `删除选中 ${menu.columns} 列` : "删除当前列", preview: "column", run: () => mutate("deleteColumn") },
    { label: "删除表格", preview: "table", run: () => mutate("deleteTable") },
  ];
  return createPortal(<div ref={menuRef} role="menu" aria-label="表格操作" className={styles.menu} style={{ left: menu.x, top: menu.y }} onContextMenu={event => event.preventDefault()} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); close(); editor.view.focus(); }
    if (event.key === "Tab") close();
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = Array.from(menuRef.current!.querySelectorAll<HTMLButtonElement>("button"));
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  }}>{items.map(item => <div key={item.label}>{item.separator && <div role="separator" className={styles.divider} />}<button type="button" role="menuitem" className={item.preview ? styles.danger : ""} onMouseDown={event => event.preventDefault()} onMouseEnter={() => preview(item.preview ?? null)} onMouseLeave={() => preview(null)} onFocus={() => preview(item.preview ?? null)} onBlur={() => preview(null)} onClick={() => { close(); item.run(); }}>{item.label}</button></div>)}</div>, editor.view.dom.closest(".workspace") ?? document.body);
}
