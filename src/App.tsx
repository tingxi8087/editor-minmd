import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App as InkApp, Button, ConfigProvider, Modal } from "paper-ink";
import { IconArrowBackUp, IconArrowForwardUp, IconArrowUpRight, IconBook2, IconCheck, IconChevronDown, IconCode, IconFolderOpen, IconLayoutSidebar, IconList, IconListCheck, IconListNumbers, IconMarkdown, IconMoon, IconPlus, IconQuote, IconDeviceFloppy, IconSun, IconTable, IconTypography, IconBold, IconItalic, IconStrikethrough } from "paper-ink/icons";
import { useEditor } from "@tiptap/react";
import { replaceEditorDocument } from "@/components/DocumentEditor/session";
import { getCurrentWindow } from "@tauri-apps/api/window";
import DocumentEditor from "@/components/DocumentEditor";
import { editorExtensions } from "@/components/DocumentEditor/extensions";
import { desktopAvailable, openDocument, saveDocument, type DocumentFile } from "@/lib/files";
import { packMarkdown, unpackMarkdown, unsupportedMarkdown, type MarkdownEnvelope } from "@/lib/markdown";
import { useSettings } from "@/store/settings";

const guide = `# 从一页空白开始。\n\n把想法写下来，让文字回到文字。\n\nMinMD 是一个本地 Markdown 编辑器。打开你的文档，直接编辑排版后的内容，再保存回原来的文件。\n\n## 像写文档一样，写 Markdown\n\n不必来回切换编辑与预览。标题、列表、引用和代码，都在纸面上自然呈现。\n\n- 用 **粗体** 标出重点，用 *斜体* 留一点语气。\n- 输入 \`#\` 再按空格，开始一个标题。\n- 输入 \`-\` 再按空格，整理一份清单。\n\n> 简单的工具，留出更多思考的空间。\n\n## 留在本地，随时继续\n\n你的文档仍是普通的 Markdown 文件。不需要账号，也不需要上传。\n\n| 操作 | 快捷键 |\n| --- | --- |\n| 打开 Markdown | ⌘ / Ctrl + O |\n| 保存文档 | ⌘ / Ctrl + S |\n| 新建文档 | ⌘ / Ctrl + N |\n\n---\n\n点击右上角的「打开文件」，或新建一页，开始写作。\n`;
interface Session { path: string | null; name: string; raw: string; envelope: MarkdownEnvelope; guide: boolean; unsupported: string | null }
const initial: Session = { path: null, name: "使用指南", raw: guide, envelope: unpackMarkdown(guide), guide: true, unsupported: null };
const iconProps = { size: 17, stroke: 1.65 };

function Workspace() {
  const { dark, sidebar, toggleDark, toggleSidebar } = useSettings();
  const [session, setSession] = useState<Session>(initial);
  const sessionRef = useRef(session);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const baseline = useRef("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [reading, setReading] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [pendingLeave, setPendingLeave] = useState<null | (() => void)>(null);
  const extensions = useMemo(editorExtensions, []);
  const editor = useEditor({
    extensions, content: guide, contentType: "markdown", editable: false,
    onCreate: ({ editor }) => { baseline.current = JSON.stringify(editor.getJSON()); setRevision((r) => r + 1); },
    onUpdate: ({ editor }) => {
      const changed = JSON.stringify(editor.getJSON()) !== baseline.current;
      dirtyRef.current = changed; setDirty(changed); setStatus(""); setError(""); setRevision((r) => r + 1);
    },
    onSelectionUpdate: () => setRevision((r) => r + 1),
  });

  const updateSession = (next: Session) => { sessionRef.current = next; setSession(next); };
  const setWorking = (value: boolean) => { busyRef.current = value; setBusy(value); };

  const load = useCallback((next: Session) => {
    if (!editor) return;
    replaceEditorDocument(editor, next.unsupported ? "" : next.envelope.body);
    baseline.current = JSON.stringify(editor.getJSON());
    updateSession(next); dirtyRef.current = false; setDirty(false); setReading(false); setError(""); setStatus(""); setRevision((r) => r + 1);
    document.querySelector(".document-scroll")?.scrollTo(0, 0);
  }, [editor]);

  const guard = useCallback((action: () => void) => {
    if (busyRef.current) return;
    if (dirtyRef.current) setPendingLeave(() => action);
    else action();
  }, []);

  const open = useCallback(async () => {
    if (!desktopAvailable) { setError("请使用 Tauri 桌面窗口打开本地文件。当前为浏览器界面预览。"); return; }
    setWorking(true); setError("");
    try {
      const file = await openDocument();
      if (file) {
        const envelope = unpackMarkdown(file.content);
        load({ ...file, raw: file.content, envelope, guide: false, unsupported: unsupportedMarkdown(envelope.body) });
      }
    } catch (e) { setError(String(e)); }
    finally { setWorking(false); }
  }, [load]);

  const create = useCallback(() => {
    load({ path: null, name: "未命名.md", raw: "", envelope: { ...unpackMarkdown(""), trailingNewline: true }, guide: false, unsupported: null });
    requestAnimationFrame(() => editor?.commands.focus("start"));
  }, [editor, load]);

  const save = useCallback(async (saveAs = false): Promise<boolean> => {
    const current = sessionRef.current;
    if (!editor || busyRef.current || current.guide || current.unsupported) return false;
    if (!desktopAvailable) { setError("请在 Tauri 桌面窗口中保存文件。"); return false; }
    if (!saveAs && current.path && !dirtyRef.current) { setStatus("已保存"); return true; }
    const restoreFocus = editor.isFocused;
    setWorking(true); setError("");
    try {
      const content = dirtyRef.current ? packMarkdown(editor.getMarkdown(), current.envelope) : current.raw;
      const file: DocumentFile | null = await saveDocument(current.path, content, current.path ? current.raw : null, saveAs);
      if (!file) return false;
      updateSession({ ...current, path: file.path, name: file.name, raw: file.content, envelope: unpackMarkdown(file.content) });
      baseline.current = JSON.stringify(editor.getJSON()); dirtyRef.current = false; setDirty(false); setStatus("已保存到本地");
      return true;
    } catch (e) { setError(String(e)); return false; }
    finally { setWorking(false); if (restoreFocus) requestAnimationFrame(() => editor.commands.focus()); }
  }, [editor]);

  const actions = useRef({ open, save, create, guard });
  actions.current = { open, save, create, guard };
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (!["o", "s", "n"].includes(key)) return;
      event.preventDefault();
      if (key === "s") void actions.current.save(event.shiftKey);
      if (key === "o") actions.current.guard(() => void actions.current.open());
      if (key === "n") actions.current.guard(actions.current.create);
    };
    window.addEventListener("keydown", handleKey);
    const unload = (event: BeforeUnloadEvent) => { if (dirtyRef.current || busyRef.current) event.preventDefault(); };
    window.addEventListener("beforeunload", unload);
    return () => { window.removeEventListener("keydown", handleKey); window.removeEventListener("beforeunload", unload); };
  }, []);

  useEffect(() => {
    if (!desktopAvailable) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onCloseRequested((event) => {
      if (busyRef.current) { event.preventDefault(); return; }
      if (dirtyRef.current) { event.preventDefault(); setPendingLeave(() => () => void getCurrentWindow().destroy()); }
    }).then((off) => { if (disposed) off(); else unlisten = off; });
    return () => { disposed = true; unlisten?.(); };
  }, []);

  useEffect(() => { editor?.setEditable(!busy && !reading && !session.guide && !session.unsupported, false); }, [editor, busy, reading, session.guide, session.unsupported]);
  useEffect(() => {
    if (desktopAvailable) void getCurrentWindow().setTitle(`${dirty ? "● " : ""}${session.name} — MinMD`).catch(() => {});
  }, [dirty, session.name]);

  const headings = useMemo(() => {
    const items: { text: string; level: number; position: number }[] = [];
    editor?.state.doc.descendants((node, position) => {
      if (node.type.name === "heading") items.push({ text: node.textContent || "未命名标题", level: node.attrs.level as number, position });
    });
    return items;
  }, [editor, revision]);
  const wordCount = editor?.getText().replace(/\s/g, "").length ?? 0;
  const editable = !session.guide && !session.unsupported && !reading && !busy;
  const tools = [
    { label: "撤销", icon: IconArrowBackUp, run: () => editor?.chain().focus().undo().run(), off: !editor?.can().undo() },
    { label: "重做", icon: IconArrowForwardUp, run: () => editor?.chain().focus().redo().run(), off: !editor?.can().redo() },
    { label: "粗体", icon: IconBold, run: () => editor?.chain().focus().toggleBold().run(), active: editor?.isActive("bold") },
    { label: "斜体", icon: IconItalic, run: () => editor?.chain().focus().toggleItalic().run(), active: editor?.isActive("italic") },
    { label: "删除线", icon: IconStrikethrough, run: () => editor?.chain().focus().toggleStrike().run(), active: editor?.isActive("strike") },
    { label: "无序列表", icon: IconList, run: () => editor?.chain().focus().toggleBulletList().run(), active: editor?.isActive("bulletList") },
    { label: "有序列表", icon: IconListNumbers, run: () => editor?.chain().focus().toggleOrderedList().run(), active: editor?.isActive("orderedList") },
    { label: "任务列表", icon: IconListCheck, run: () => editor?.chain().focus().toggleTaskList().run(), active: editor?.isActive("taskList") },
    { label: "引用", icon: IconQuote, run: () => editor?.chain().focus().toggleBlockquote().run(), active: editor?.isActive("blockquote") },
    { label: "代码块", icon: IconCode, run: () => editor?.chain().focus().toggleCodeBlock().run(), active: editor?.isActive("codeBlock") },
    { label: "插入表格", icon: IconTable, run: () => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  ];

  return <div className={`workspace ${dark ? "dark" : ""} ${desktopAvailable && /Mac/.test(navigator.userAgent) ? "window-overlay" : ""}`}>
    <header className="titlebar" data-tauri-drag-region>
      <div className="brand"><span className="brand-mark">m<span>·</span></span><span>MinMD</span></div>
      <span className="window-title">{session.name}{dirty ? " · 未保存" : ""}</span>
      <div className="top-actions">
        <Button type="text" size="small" title="新建文档 · ⌘/Ctrl N" icon={<IconPlus {...iconProps} />} onClick={() => guard(create)} disabled={busy}>新建</Button>
        <Button size="small" icon={<IconFolderOpen {...iconProps} />} onClick={() => guard(() => void open())} disabled={busy}>打开文件</Button>
        <Button type="primary" size="small" icon={<IconDeviceFloppy {...iconProps} />} onClick={() => void save()} disabled={busy || session.guide || !!session.unsupported}>{busy ? "处理中…" : "保存"}</Button>
      </div>
    </header>
    <div className="workbench">
      <nav className="activitybar" aria-label="工具栏">
        <button className={sidebar ? "rail-button selected" : "rail-button"} aria-label="切换侧栏" title="文档与大纲" onClick={toggleSidebar}><IconLayoutSidebar size={21} stroke={1.5} /></button>
        <button className="rail-button" aria-label="新建文档" title="新建文档" disabled={busy} onClick={() => guard(create)}><IconPlus size={21} stroke={1.5} /></button>
        <span className="rail-spacer" />
        <button className="rail-button" aria-label={dark ? "切换浅色" : "切换深色"} title={dark ? "浅色纸面" : "深色墨纸"} onClick={toggleDark}>{dark ? <IconSun size={20} stroke={1.5} /> : <IconMoon size={20} stroke={1.5} />}</button>
        <div className="rail-monogram">墨</div>
      </nav>
      {sidebar && <aside className="sidebar">
        <div className="sidebar-heading">文档<span>LOCAL</span></div>
        <button className="current-file" title={session.path ?? session.name}><IconMarkdown {...iconProps} /><span>{session.name}</span>{dirty && <i className="dirty-dot" />}</button>
        <div className="outline-heading"><IconList size={14} stroke={1.7} />文档大纲<span>{headings.length.toString().padStart(2, "0")}</span></div>
        <div className="outline">
          {headings.length ? headings.map((heading) => <button key={heading.position} style={{ paddingLeft: 12 + Math.max(0, heading.level - 1) * 10 }} onClick={() => {
            const element = editor?.view.nodeDOM(heading.position);
            if (element instanceof HTMLElement) element.scrollIntoView({ behavior: "smooth", block: "start" });
          }} title={heading.text}><span className="heading-level">{heading.level === 1 ? "#" : "·"}</span><span>{heading.text}</span></button>) : <p className="outline-empty">写下标题，梳理思路。</p>}
        </div>
        <div className="sidebar-foot"><span className="local-dot" />本地文件 · 自由书写<span>MIT OPEN SOURCE</span></div>
      </aside>}
      <main className="main">
        <div className="tabbar">
          <div className="document-tab" title={session.path ?? session.name}><IconMarkdown size={16} stroke={1.5} /><span>{session.name}</span>{dirty ? <i className="dirty-dot" /> : session.guide ? <span className="guide-badge">指南</span> : <IconCheck size={13} stroke={1.5} />}</div>
          <span className="tabbar-space" />
          <div className="view-switch" aria-label="文档模式"><button className={!reading ? "active" : ""} onClick={() => setReading(false)}><IconTypography size={13} />文档</button><button className={reading ? "active" : ""} onClick={() => setReading(true)}><IconBook2 size={13} />阅读</button><button onClick={() => setSourceOpen(true)} title="只读查看 Markdown 原文"><IconCode size={13} />原文</button></div>
          <button className="quiet-button" title="另存为 · ⌘/Ctrl Shift S" disabled={busy || session.guide || !!session.unsupported} onClick={() => void save(true)}>另存为<IconArrowUpRight size={13} /></button>
        </div>
        {!reading && !session.unsupported && <div className="formatbar" role="toolbar" aria-label="文档格式">
          <div className="heading-picker"><select aria-label="段落格式" disabled={!editable} value={editor?.isActive("heading") ? String(editor.getAttributes("heading").level) : "0"} onChange={(event) => {
            const level = Number(event.target.value);
            if (level === 0) editor?.chain().focus().setParagraph().run();
            else editor?.chain().focus().setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run();
          }}><option value="0">正文</option>{[1, 2, 3, 4, 5, 6].map((level) => <option key={level} value={level}>标题 {level}</option>)}</select><IconChevronDown size={12} /></div>
          <span className="tool-divider" />
          {tools.map((tool, index) => <span className="tool-wrap" key={tool.label}>{[2, 5, 8].includes(index) && <span className="tool-divider" />}<button type="button" aria-label={tool.label} aria-pressed={!!tool.active} disabled={!editable || tool.off} title={tool.label} className={tool.active ? "format-button active" : "format-button"} onMouseDown={(event) => event.preventDefault()} onClick={tool.run}><tool.icon {...iconProps} /></button></span>)}
          <span className="toolbar-note">{session.guide ? "内置使用指南 · 只读" : "所见即所得"}</span>
        </div>}
        {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError("")} aria-label="关闭提示">×</button></div>}
        {session.unsupported ? <><div className="notice-banner">此文件包含{session.unsupported}，当前保留原文只读，避免转换时丢失内容。</div><pre className="raw-document">{session.raw}</pre></> : <DocumentEditor editor={editor} />}
      </main>
    </div>
    <footer className="statusbar"><div><span className={`status-dot ${dirty ? "unsaved" : ""}`} />{busy ? "正在处理文件…" : error ? "操作未完成" : session.guide ? "欢迎来到 MinMD" : dirty ? "有未保存的修改" : status || (session.path ? "已保存" : "新文档，尚未保存")}</div><div>{!desktopAvailable && <span className="preview-label">浏览器预览</span>}<span>{wordCount.toLocaleString()} 字符</span><span>Markdown</span><span>UTF-8{session.envelope.bom && " BOM"}</span><span>{session.envelope.newline === "\r\n" ? "CRLF" : "LF"}</span></div></footer>
    <Modal open={sourceOpen} title="Markdown 原文 · 只读" width={800} footer={<Button onClick={() => setSourceOpen(false)}>关闭</Button>} onCancel={() => setSourceOpen(false)}><pre className="source-preview">{session.unsupported || !dirty ? session.raw : editor ? packMarkdown(editor.getMarkdown(), session.envelope) : session.raw}</pre></Modal>
    <Modal open={!!pendingLeave} title="保存这页的修改？" onCancel={() => setPendingLeave(null)} footer={<div className="leave-actions"><Button onClick={() => setPendingLeave(null)}>继续编辑</Button><Button danger onClick={() => { const next = pendingLeave; setPendingLeave(null); dirtyRef.current = false; setDirty(false); next?.(); }}>不保存</Button><Button type="primary" disabled={busy} onClick={async () => { if (await save()) { const next = pendingLeave; setPendingLeave(null); next?.(); } }}>保存并继续</Button></div>}><p>「{session.name}」有未保存的修改。保存后再继续，或放弃本次修改。</p>{error && <p role="alert" className="dialog-error">{error}</p>}</Modal>
  </div>;
}

export default function App() {
  const dark = useSettings((s) => s.dark);
  return <ConfigProvider theme={{ token: { color: { text: { primary: dark ? "#e4e4d9" : "#30322e", secondary: dark ? "#a3a69a" : "#777970" }, surface: { page: dark ? "#1f211d" : "#f5f3ee", container: dark ? "#252722" : "#fffefa", elevated: dark ? "#2e302a" : "#fffefa", muted: dark ? "#2e302a" : "#f4f3ef" }, border: { default: dark ? "#3d4036" : "#deded4", subtle: dark ? "#34372e" : "#e5e5dc" }, primary: { solid: dark ? "#e7e4db" : "#292a26", solidHover: dark ? "#f5f3ee" : "#44463f", solidActive: dark ? "#cecec1" : "#1e201b", onSolid: dark ? "#252622" : "#fffefa", subtle: dark ? "#3b4236" : "#e9ebe3", onSubtle: dark ? "#e4e4d9" : "#30322e", border: dark ? "#565b4c" : "#a2a398" } }, radius: { control: 5 } } }}><InkApp><Workspace /></InkApp></ConfigProvider>;
}
