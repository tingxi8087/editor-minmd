import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { closeHistory } from "@tiptap/pm/history";
import { IconTypography, IconHeading, IconList, IconListNumbers, IconCheckbox, IconQuote, IconCode, IconChartDots, IconTable, IconPhoto, IconMinus, IconMoodSmile, IconCalendar, IconFileText, IconLink } from "paper-ink/icons";
import styles from "./index.module.less";

export type InsertKind = "image" | "emoji" | "date" | "reference" | "link";
export type SlashRange = { from: number; to: number };
type Item = { id: string; label: string; keywords: string; icon: typeof IconTypography; inline?: boolean; insert?: InsertKind };
const items: Item[] = [
  { id: "paragraph", label: "正文", keywords: "text paragraph zw zhengwen", icon: IconTypography },
  ...[1, 2, 3, 4, 5, 6].map(level => ({ id: `h${level}`, label: `标题 ${level}`, keywords: `heading h${level} bt biaoti`, icon: IconHeading })),
  { id: "bullet", label: "无序列表", keywords: "list bullet wxlb wuxuliebiao", icon: IconList },
  { id: "ordered", label: "有序列表", keywords: "list ordered yxlb youxuliebiao", icon: IconListNumbers },
  { id: "task", label: "任务列表", keywords: "todo task rwlb renwuliebiao daiban", icon: IconCheckbox },
  { id: "quote", label: "引用", keywords: "quote yy yinyong", icon: IconQuote },
  { id: "code", label: "代码块", keywords: "code dmk daimakuai", icon: IconCode },
  { id: "mermaid", label: "Mermaid 图表", keywords: "mermaid diagram flowchart tb tubiao lct", icon: IconChartDots },
  { id: "table", label: "表格", keywords: "table bg biaoge", icon: IconTable },
  { id: "image", label: "图片", keywords: "image photo tp tupian", icon: IconPhoto, insert: "image" },
  { id: "divider", label: "分割线", keywords: "divider horizontal line fgx fengexian", icon: IconMinus },
  { id: "emoji", label: "表情", keywords: "emoji smile bq biaoqing", icon: IconMoodSmile, inline: true, insert: "emoji" },
  { id: "date", label: "日期", keywords: "date calendar rq riqi", icon: IconCalendar, inline: true, insert: "date" },
  { id: "reference", label: "引用文档", keywords: "reference document docs yywd wendang", icon: IconFileText, inline: true, insert: "reference" },
  { id: "link", label: "插入链接", keywords: "link url lj lianjie", icon: IconLink, inline: true, insert: "link" },
];
type Menu = SlashRange & { query: string; inline: boolean; x: number; y: number; maxHeight: number; upward: boolean };

export default function SlashMenu({ editor, onInsert }: { editor: Editor | null; onInsert: (kind: InsertKind, range: SlashRange) => void }) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [selected, setSelected] = useState(0);
  const current = useRef<Menu | null>(null);
  const selectedRef = useRef(0);
  const dismissed = useRef<string | null>(null);
  const insert = useRef(onInsert);
  const element = useRef<HTMLDivElement>(null);
  insert.current = onInsert;
  const filtered = (value: Menu) => items.filter(item => (!value.inline || item.inline) && `${item.label} ${item.keywords}`.toLowerCase().includes(value.query.toLowerCase()));
  const close = () => { current.current = null; setMenu(null); };
  const choose = (index: number) => {
    const value = current.current;
    if (!editor || !value) return;
    const item = filtered(value)[index];
    if (!item) return;
    dismissed.current = `${value.from}:${value.to}:${value.query}`;
    close();
    if (item.insert) { insert.current(item.insert, { from: value.from, to: value.to }); return; }
    // Chain deletion and transformation so one undo restores the slash query.
    const chain = editor.chain().focus().command(({ tr }) => { closeHistory(tr); return true; }).deleteRange({ from: value.from, to: value.to });
    if (item.id === "paragraph") chain.setParagraph().run();
    else if (/^h[1-6]$/.test(item.id)) chain.setHeading({ level: Number(item.id[1]) as 1 | 2 | 3 | 4 | 5 | 6 }).run();
    else if (item.id === "bullet") chain.toggleBulletList().run();
    else if (item.id === "ordered") chain.toggleOrderedList().run();
    else if (item.id === "task") chain.toggleTaskList().run();
    else if (item.id === "quote") chain.toggleBlockquote().run();
    else if (item.id === "code") chain.setCodeBlock({ language: "plaintext" }).run();
    else if (item.id === "mermaid") chain.setCodeBlock({ language: "mermaid" }).insertContent("graph TD\n  A[开始] --> B[结束]").run();
    else if (item.id === "table") chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    else if (item.id === "divider") chain.setHorizontalRule().run();
  };
  const chooseRef = useRef(choose);
  chooseRef.current = choose;

  useEffect(() => {
    if (!editor) return;
    dismissed.current = null;
    const sync = () => {
      const { $from, empty, from } = editor.state.selection;
      if (!editor.isEditable || !editor.isFocused || !empty || !["paragraph", "heading"].includes($from.parent.type.name) || editor.isActive("codeBlock")) { close(); return; }
      const text = $from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc");
      const match = /(?:^|\s)\/([^/\n]{0,24})$/.exec(text);
      if (!match) { dismissed.current = null; close(); return; }
      const query = match[1];
      const start = from - query.length - 1;
      const key = `${start}:${from}:${query}`;
      if (dismissed.current === key) { close(); return; }
      dismissed.current = null;
      const rect = editor.view.coordsAtPos(from);
      const roomBelow = window.innerHeight - rect.bottom - 8;
      const roomAbove = rect.top - 8;
      const upward = roomBelow < 260 && roomAbove > roomBelow;
      const maxHeight = Math.max(0, Math.min(330, upward ? roomAbove : roomBelow));
      if (maxHeight < 64 || rect.bottom < 0 || rect.top > window.innerHeight) { close(); return; }
      if (current.current?.query !== query || current.current?.from !== start) { selectedRef.current = 0; setSelected(0); }
      const value = { from: start, to: from, query, inline: start !== $from.start() || $from.parent.type.name !== "paragraph", x: Math.max(8, Math.min(rect.left, window.innerWidth - 268)), y: upward ? rect.top - 5 : rect.bottom + 5, maxHeight, upward };
      current.current = value;
      setMenu(value);
    };
    const keydown = (event: KeyboardEvent) => {
      const value = current.current;
      if (!value || !editor.isEditable || event.isComposing || event.keyCode === 229 || editor.view.composing) return;
      if (!["Escape", "ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") { dismissed.current = `${value.from}:${value.to}:${value.query}`; close(); }
      else if (event.key === "Enter") chooseRef.current(selectedRef.current);
      else {
        const count = filtered(value).length;
        const next = count ? (selectedRef.current + (event.key === "ArrowDown" ? 1 : -1) + count) % count : 0;
        selectedRef.current = next;
        setSelected(next);
      }
    };
    const blur = () => close();
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !element.current?.contains(event.target)) sync(); };
    const dom = editor.view.dom;
    dom.addEventListener("keydown", keydown, true);
    editor.on("transaction", sync);
    editor.on("update", sync);
    editor.on("focus", sync);
    editor.on("blur", blur);
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", scroll, true);
    return () => {
      dom.removeEventListener("keydown", keydown, true);
      editor.off("transaction", sync);
      editor.off("update", sync);
      editor.off("focus", sync);
      editor.off("blur", blur);
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", scroll, true);
      current.current = null;
    };
  }, [editor]);
  useEffect(() => { element.current?.querySelector<HTMLElement>(`[data-selected="true"]`)?.scrollIntoView?.({ block: "nearest" }); }, [selected]);
  if (!editor || !menu) return null;
  const visible = filtered(menu);
  return createPortal(<div ref={element} role="listbox" aria-label="插入内容" className={styles.menu} style={{ left: menu.x, top: menu.y, maxHeight: menu.maxHeight, transform: menu.upward ? "translateY(-100%)" : undefined }} onMouseDown={event => event.preventDefault()}>
    <div className={styles.caption}>插入内容 <span>↑↓ 选择 · ↵ 插入</span></div>
    {visible.map((item, index) => <button type="button" role="option" aria-selected={index === selected} data-selected={index === selected} key={item.id} onMouseMove={() => { selectedRef.current = index; setSelected(index); }} onClick={() => choose(index)}><item.icon size={16} stroke={1.6} /><span>{item.label}</span>{/^h[1-6]$/.test(item.id) && <small>H{item.id[1]}</small>}</button>)}
    {!visible.length && <p className={styles.empty}>没有匹配的操作</p>}
  </div>, editor.view.dom.closest(".workspace") ?? document.body);
}
