import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { App as InkApp, Button, ConfigProvider, Modal } from "paper-ink";
import { IconArrowBackUp, IconArrowForwardUp, IconArrowUpRight, IconBook2, IconChevronDown, IconCode, IconFolderOpen, IconLayoutSidebar, IconList, IconListCheck, IconListNumbers, IconMoon, IconPlus, IconQuote, IconFileText, IconSun, IconTable, IconTypography, IconBold, IconItalic, IconStrikethrough, IconRefresh, IconPhoto, IconX, IconSettings, IconSearch, IconHistory } from "paper-ink/icons";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import RecentEntries from "@/components/RecentEntries";
import { workspaceSession } from "@/lib/workspaceSession";
import { RecentModel } from "@/lib/recents";
import Settings from "@/components/Settings";
import { connectExternalFiles } from "@/lib/externalFiles";
import BackgroundSettings from "@/components/BackgroundSettings";
import { BackgroundModel } from "@/lib/background";
import SourceEditor from "@/components/SourceEditor";
import SourceToolbar from "@/components/SourceToolbar";
import DocumentEditor from "@/components/DocumentEditor";
import DocumentSearch from "@/components/DocumentSearch";
import DocumentTabs from "@/components/DocumentTabs";
import ReliabilityPanel from "@/components/ReliabilityPanel";
import SlashMenu from "@/components/SlashMenu";
import SlashInsert from "@/components/SlashInsert";
import ResourceTools from "@/components/ResourceTools";
import FileTree from "@/components/FileTree";
import { desktopAvailable } from "@/lib/files";
import { WorkspaceModel } from "@/workspace/model";
import { useSettings } from "@/store/settings";

const guide = `# 从一页空白开始。\n\n把想法写下来，让文字回到文字。\n\neditor-minmd 是一个本地 Markdown 编辑器。打开你的文档，直接编辑排版后的内容，再保存回原来的文件。\n\n## 像写文档一样，写 Markdown\n\n不必来回切换编辑与预览。标题、列表、引用和代码，都在纸面上自然呈现。\n\n- 用 **粗体** 标出重点，用 *斜体* 留一点语气。\n- 输入 \`#\` 再按空格，开始一个标题。\n- 输入 \`-\` 再按空格，整理一份清单。\n\n> 简单的工具，留出更多思考的空间。\n\n## 留在本地，随时继续\n\n你的文档仍是普通的 Markdown 文件。不需要账号，也不需要上传。\n\n| 操作 | 快捷键 |\n| --- | --- |\n| 打开 Markdown | ⌘ / Ctrl + O |\n| 保存文档 | ⌘ / Ctrl + S |\n| 新建 MD | ⌘ / Ctrl + N |\n\n---\n\n点击右上角的「打开文件」，或新建一页，开始写作。\n`;
const noopSubscribe = () => () => {};
const zeroSnapshot = () => 0;
const iconProps = { size: 17, stroke: 1.65 };

export function Workspace({ workspace, background: suppliedBackground }: { workspace: WorkspaceModel; background?: BackgroundModel }) {
  const [background] = useState(() => suppliedBackground ?? new BackgroundModel());
  useSyncExternalStore(background.subscribe, background.snapshot);
  const recent = workspace.recents;
  useSyncExternalStore(recent?.subscribe ?? noopSubscribe, recent?.snapshot ?? zeroSnapshot);
  const [recentOpen, setRecentOpen] = useState(false);
  useEffect(() => { void recent?.load(); }, [recent]);
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const [associationsOpen, setAssociationsOpen] = useState(false);
  const [associationBusy, setAssociationBusy] = useState(false);
  const [slashInsert, setSlashInsert] = useState<{ id: string; kind: "emoji" | "date" | "reference" | "link"; from: number; to: number } | null>(null);
  useEffect(() => { void background.load(); }, [background]);
  useSyncExternalStore(workspace.subscribe, workspace.snapshot);
  const { dark, sidebar, toggleDark, toggleSidebar } = useSettings();
  const [findOpen, setFindOpen] = useState(false);
  const [findRequest, setFindRequest] = useState(0);
  const [pane, setPane] = useState<"files" | "outline">("outline");
  const session = workspace.active;
  const editor = session?.mode === "document" ? session.editor : null;
  const dirty = session?.dirty ?? false;
  const reading = session?.reading ?? false;
  const busy = workspace.busy || background.busy || associationBusy;
  const target = workspace.closeTarget;
  const editable = !!editor && !session?.guide && !reading && !busy;
  const ensureDesktop = () => {
    if (desktopAvailable) return true;
    workspace.reportError("请在 Tauri 桌面窗口中打开和保存本地文件。当前为浏览器界面预览。"); return false;
  };
  const save = (id = workspace.activeId, as = false) => ensureDesktop() && id ? workspace.save(id, as) : Promise.resolve(false);
  const chooseDirectory = async () => { if (ensureDesktop()) { await workspace.chooseDirectory(); setPane("files"); if (!useSettings.getState().sidebar) useSettings.getState().toggleSidebar(); } };
  const completeClose = async () => { await background.flush(); if (await workspace.completeClose()) await getCurrentWindow().destroy(); };
  const closeTabs = async (ids: string[], window = false) => { workspace.requestClose(ids, window); if (workspace.closing && !workspace.closeTarget) await completeClose(); };
  const openSearch = () => {
    const tab = workspace.active;
    if (!tab || busy || workspace.closing) return;
    if (tab.mode === 'source') tab.source?.search();
    else { setFindOpen(true); setFindRequest(value => value + 1); }
  };
  const commands = useRef({ save, chooseDirectory, closeTabs, openSearch });
  commands.current = { save, chooseDirectory, closeTabs, openSearch };
  useEffect(() => { setFindOpen(false); }, [session?.id]);
  useEffect(() => { if (session?.mode === 'source') setFindOpen(false); }, [session?.mode]);
  useEffect(() => {
    // Run workbench shortcuts before editor formatting and browser defaults.
    const sidebarKeydown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.isComposing) return;
      const key = event.key.toLowerCase();
      if (!['b', '1', '2', '3', 'f'].includes(key)) return;
      if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return;
      event.preventDefault(); event.stopPropagation();
      if (event.repeat) return;
      if (key === 'b') { useSettings.getState().toggleSidebar(); return; }
      if (workspace.busy || workspace.closing || background.busy || associationBusy) return;
      if (key === 'f') { commands.current.openSearch(); return; }
      const tab = workspace.active;
      if (!tab || tab.kind !== 'markdown') return;
      const changed = key === '3' ? workspace.setMode('source') : workspace.setMode('document', key === '2');
      if (changed) requestAnimationFrame(() => {
        if (workspace.active?.id !== tab.id) return;
        if (tab.mode === 'source') tab.source?.focus(); else tab.editor?.view.focus();
      });
    };
    const keydown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (!["n", "o", "s", "w", "tab"].includes(key)) return;
      if (desktopAvailable && key !== "tab") return;
      event.preventDefault();
      if (workspace.busy || workspace.closing || background.busy || associationBusy) return;
      if (key === "n") workspace.create(event.shiftKey ? "text" : "markdown");
      if (key === "o") { if (event.shiftKey) void commands.current.chooseDirectory(); else if (desktopAvailable) void workspace.chooseFile(); else workspace.reportError("请在桌面窗口中打开文件。"); }
      if (key === "s") void commands.current.save(workspace.activeId, event.shiftKey);
      if (key === "w" && workspace.activeId) void commands.current.closeTabs([workspace.activeId]);
      if (key === "tab" && workspace.tabs.length) {
        const index = workspace.tabs.findIndex((tab) => tab.id === workspace.activeId);
        workspace.activate(workspace.tabs[(index + (event.shiftKey ? -1 : 1) + workspace.tabs.length) % workspace.tabs.length].id);
      }
    };
    const unload = (event: BeforeUnloadEvent) => { if (workspace.hasDirty || workspace.busy) event.preventDefault(); };
    window.addEventListener("keydown", sidebarKeydown, true);
    window.addEventListener("keydown", keydown); window.addEventListener("beforeunload", unload);
    let off: (() => void) | undefined; let menuOff: (() => void) | undefined; let dropOff: (() => void) | undefined; let disposed = false;
    if (desktopAvailable) void listen<string>("workspace-command", ({ payload }) => {
      if (workspace.busy || workspace.closing || background.busy || associationBusy) return;
      if (payload === "associations") setAssociationsOpen(true);
      if (payload === "new") workspace.create();
      if (payload === "new-text") workspace.create("text");
      if (payload === "open") void workspace.chooseFile();
      if (payload === "directory") void commands.current.chooseDirectory();
      if (payload === "save" || payload === "save-as") void commands.current.save(workspace.activeId, payload === "save-as");
      if (payload === "close-tab" && workspace.activeId) void commands.current.closeTabs([workspace.activeId]);
      if (payload === "close-others") void commands.current.closeTabs(workspace.tabs.filter((tab) => tab.id !== workspace.activeId).map((tab) => tab.id));
      if (payload === "close-window" || payload === "quit") void commands.current.closeTabs(workspace.tabs.map((tab) => tab.id), true);
    }).then((unlisten) => { if (disposed) unlisten(); else menuOff = unlisten; });
    if (desktopAvailable) void getCurrentWindow().onDragDropEvent(({ payload }) => {
      if (payload.type !== "drop" || !workspace.active?.editor?.isEditable) return;
      const panel = document.getElementById(`panel-${workspace.activeId}`)?.getBoundingClientRect();
      const x = payload.position.x / window.devicePixelRatio; const y = payload.position.y / window.devicePixelRatio;
      if (!panel || x < panel.left || x > panel.right || y < panel.top || y > panel.bottom) return;
      const position = workspace.active.editor.view.posAtCoords({ left: x, top: y });
      if (position) workspace.active.editor.commands.setTextSelection(position.pos);
      void workspace.insertImages(workspace.activeId!, undefined, payload.paths);
    }).then(unlisten => { if (disposed) unlisten(); else dropOff = unlisten; });
    if (desktopAvailable) void getCurrentWindow().onCloseRequested((event) => {
      if (workspace.busy || workspace.closing || background.busy || associationBusy) { event.preventDefault(); return; }
      event.preventDefault();
      void commands.current.closeTabs(workspace.tabs.map((tab) => tab.id), true);
    }).then((unlisten) => { if (disposed) unlisten(); else off = unlisten; });
    return () => { disposed = true; off?.(); menuOff?.(); dropOff?.(); window.removeEventListener("keydown", sidebarKeydown, true); window.removeEventListener("keydown", keydown); window.removeEventListener("beforeunload", unload); };
  }, [workspace, background, associationBusy]);
  useEffect(() => {
    if (desktopAvailable) void getCurrentWindow().setTitle(`${dirty ? "● " : ""}${session?.name ?? "editor-minmd"} — editor-minmd`).catch(() => {});
  }, [dirty, session?.name]);
  const headings: { text: string; level: number; position: number }[] = [];
  editor?.state.doc.descendants((node, position) => { if (node.type.name === "heading") headings.push({ text: node.textContent || "未命名标题", level: node.attrs.level as number, position }); });
  const wordCount = (session?.mode === "source" ? session.source?.state.doc.toString() : editor?.getText())?.replace(/\s/g, "").length ?? 0;
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

  return <div className={`workspace ${background.image ? "has-background" : ""} ${dark ? "dark" : ""} ${desktopAvailable && /Mac/.test(navigator.userAgent) ? "window-overlay" : ""}`}>
    {background.image && <div className="workspace-background" aria-hidden="true"><img src={background.image.dataUrl} alt="" style={{ filter: `blur(${background.blur}px)` }} onError={() => { if (background.image) background.imageFailed(background.image.dataUrl); }} /><div style={{ opacity: background.mask / 100 }} /></div>}
    {backgroundOpen && <BackgroundSettings model={background} onClose={() => { void background.flush(); setBackgroundOpen(false); }} />}
    <header className="titlebar" data-tauri-drag-region>
      <span className="window-title">{workspace.root?.name}{workspace.root && session && " / "}{session?.name}{dirty ? " · 未保存" : ""}</span>
      <div className="top-actions">
        <Button size="small" onClick={() => { if (ensureDesktop()) void workspace.chooseFile(); }} disabled={busy}>打开文件</Button>
        <Button size="small" title="打开目录 · ⌘/Ctrl Shift O" icon={<IconFolderOpen {...iconProps} />} onClick={() => void chooseDirectory()} disabled={busy}>打开目录</Button>
        {recent && <div className="recent-action"><Button size="small" aria-label="最近打开" aria-expanded={recentOpen} title={recent.error ? '最近打开 · 记录需要处理' : '最近文件和目录'} icon={<IconHistory size={16} />} onClick={() => { if (!recentOpen) void recent.load(); setRecentOpen(!recentOpen); }} />{recentOpen && <RecentEntries files={recent.files} directories={recent.directories} error={recent.error} busy={busy || recent.busy || !!workspace.closing} onClose={() => setRecentOpen(false)} onOpen={async (entry, directory) => { if (await workspace.openRecent(entry.path, directory)) { setRecentOpen(false); if (directory) { setPane('files'); if (!useSettings.getState().sidebar) useSettings.getState().toggleSidebar(); } } }} onRemove={(entry, directory) => void recent.remove(entry.path, directory)} onClear={() => void recent.clear()} />}</div>}
      </div>
    </header>
    <div className="workbench">
      <nav className="activitybar" aria-label="工具栏">
        <button className={sidebar ? "rail-button selected" : "rail-button"} aria-label="切换侧栏" aria-expanded={sidebar} title="文件与大纲 · ⌘/Ctrl B" onClick={toggleSidebar}><IconLayoutSidebar size={21} stroke={1.5} /></button>
        <button className="rail-button" aria-label="新建 Markdown" title="新建 Markdown" disabled={busy} onClick={() => workspace.create()}><IconPlus size={21} stroke={1.5} /></button>
        <button className="rail-button" aria-label="新建文本" title="新建无后缀文本 · ⌘/Ctrl Shift N" disabled={busy} onClick={() => workspace.create("text")}><IconFileText size={21} stroke={1.5} /></button>
        <span className="rail-spacer" />
        <button className="rail-button" aria-label="设置" title="设置" onClick={() => setAssociationsOpen(true)}><IconSettings size={20} stroke={1.5} /></button>
        <button className={`rail-button ${backgroundOpen ? 'selected' : ''}`} aria-label="背景设置" aria-expanded={backgroundOpen} title={background.error ? '背景设置 · 需要处理' : '背景设置'} onClick={() => { if (backgroundOpen) void background.flush(); setBackgroundOpen(!backgroundOpen); }}><IconPhoto size={20} stroke={1.5} />{background.error && <i className="appearance-warning" />}</button>
        <button className="rail-button" aria-label={dark ? "切换浅色" : "切换深色"} title={dark ? "浅色纸面" : "深色墨纸"} onClick={toggleDark}>{dark ? <IconSun size={20} stroke={1.5} /> : <IconMoon size={20} stroke={1.5} />}</button>
      </nav>
      {sidebar && <aside className="sidebar">
        <div className="sidebar-heading sidebar-switch"><button className={pane === "files" ? "active" : ""} onClick={() => setPane("files")}>文件</button><button className={pane === "outline" ? "active" : ""} onClick={() => setPane("outline")}>大纲</button><span />{workspace.root && pane === "files" && <><button aria-label="刷新文件树" title="刷新文件树" disabled={busy} onClick={() => void workspace.refreshTree()}><IconRefresh size={13} /></button><button aria-label="关闭目录" title="关闭目录（保留已打开标签）" disabled={busy} onClick={() => void workspace.closeDirectory()}><IconX size={13} /></button></>}</div>
        {pane === "files" ? <div className="sidebar-scroll"><FileTree workspace={workspace} />
        </div> : <div className="outline">{headings.length ? headings.map((heading) => <button key={heading.position} style={{ paddingLeft: 12 + Math.max(0, heading.level - 1) * 10 }} onClick={() => {
          const element = editor?.view.nodeDOM(heading.position); if (element instanceof HTMLElement) element.scrollIntoView({ behavior: "smooth", block: "start" });
        }} title={heading.text}><span className="heading-level">{heading.level === 1 ? "#" : "·"}</span><span>{heading.text}</span></button>) : <p className="outline-empty">写下标题，梳理思路。</p>}</div>}
      </aside>}
      <main className="main">
        <div className="tabbar"><DocumentTabs workspace={workspace} onClose={(ids) => void closeTabs(ids)} />
          {session && <>{session.mode === 'document' && <button className="quiet-button" aria-label="查找文档" title="查找 · ⌘/Ctrl F" disabled={busy || !!workspace.closing} onMouseDown={event => event.preventDefault()} onClick={openSearch}><IconSearch size={14} />查找</button>}{session.kind === 'markdown' && <div className="view-switch" aria-label="文档模式"><button className={session.mode === 'document' && !reading ? "active" : ""} onClick={() => workspace.setReading(false)} title="文档 · ⌘/Ctrl 1"><IconTypography size={13} />文档</button><button className={session.mode === 'document' && reading ? "active" : ""} onClick={() => workspace.setReading(true)} title="阅读 · ⌘/Ctrl 2"><IconBook2 size={13} />阅读</button><button className={session.mode === 'source' ? "active" : ""} onClick={() => workspace.setMode('source')} title="源码 · ⌘/Ctrl 3"><IconCode size={13} />源码</button></div>}<button className="quiet-button" title="另存为 · ⌘/Ctrl Shift S" disabled={busy || session.guide} onClick={() => void save(workspace.activeId, true)}>另存为<IconArrowUpRight size={13} /></button></>}

          {workspace.tabs.length > 1 && <button className="quiet-button close-others" disabled={busy} title="关闭其他标签（未保存的会逐一确认）" onClick={() => void closeTabs(workspace.tabs.filter((tab) => tab.id !== workspace.activeId).map((tab) => tab.id))}>关闭其他</button>}
        </div>
        {session && !reading && editor && <div className="formatbar" role="toolbar" aria-label="文档格式">
          <div className="heading-picker"><select aria-label="段落格式" disabled={!editable} value={editor.isActive("heading") ? String(editor.getAttributes("heading").level) : "0"} onChange={(event) => {
            const level = Number(event.target.value); if (level === 0) editor.chain().focus().setParagraph().run(); else editor.chain().focus().setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run();
          }}><option value="0">正文</option>{[1, 2, 3, 4, 5, 6].map((level) => <option key={level} value={level}>标题 {level}</option>)}</select><IconChevronDown size={12} /></div><span className="tool-divider" />
          {tools.map((tool, index) => <span className="tool-wrap" key={tool.label}>{[2, 5, 8].includes(index) && <span className="tool-divider" />}<button type="button" aria-label={tool.label} aria-pressed={!!tool.active} disabled={!editable || tool.off} title={tool.label} className={tool.active ? "format-button active" : "format-button"} onMouseDown={(event) => event.preventDefault()} onClick={tool.run}><tool.icon {...iconProps} /></button></span>)}
          <ResourceTools workspace={workspace} />
          <span className="toolbar-note">{session.guide ? "内置使用指南 · 只读" : "所见即所得"}</span>
        </div>}
        <SourceToolbar workspace={workspace} />
        {findOpen && session?.mode === 'document' && <DocumentSearch key={session.id} editor={editor} readOnly={!editable || !!workspace.closing} openRequest={findRequest} onClose={() => setFindOpen(false)} />}
        <ReliabilityPanel workspace={workspace} />
        {workspace.error && <div className="error-banner" role="alert"><span>{workspace.error}</span><button onClick={() => workspace.clearError()} aria-label="关闭提示">×</button></div>}
        {workspace.tabs.map((tab) => <section key={tab.id} className="tab-panel" role="tabpanel" id={`panel-${tab.id}`} aria-labelledby={`tab-${tab.id}`} hidden={tab.id !== workspace.activeId}>
          {tab.mode === 'source' && tab.unsupported && <div className="notice-banner">包含{tab.unsupported}，可在源码模式完整编辑和保存。</div>}
          <div className="editor-surface" hidden={tab.mode !== 'document'}><DocumentEditor editor={tab.editor} active={tab.id === workspace.activeId && tab.mode === 'document'} scrollTop={tab.scrollTop} onScroll={(position) => { tab.scrollTop = position; }} /></div>
          {tab.source && <div className="editor-surface" hidden={tab.mode !== 'source'}><SourceEditor source={tab.source} active={tab.id === workspace.activeId && tab.mode === 'source'} /></div>}

        </section>)}
        {!session && <div className="empty-workbench"><IconBook2 size={32} stroke={1} /><p>留一页，给新的想法。</p><Button onClick={() => workspace.create()}>新建 MD</Button></div>}
      </main>
    </div>
    <footer className="statusbar"><div>{!desktopAvailable && <span className="preview-label">浏览器预览</span>}<span>{wordCount.toLocaleString()} 字符</span><span>{session?.mode === "source" ? (session.source?.language && session.source.language !== "Plain Text" ? session.source.language : "纯文本") : "Markdown"}</span>{session?.mode === "source" && session.source && <span>行 {session.source.cursor.line}，列 {session.source.cursor.column}</span>}{workspace.recoveryReady && dirty && <span>{workspace.recoveryError ? "草稿保护失败" : session?.protectedDraftVersion === session?.draftVersion ? "草稿已保护" : "草稿保护中…"}</span>}<span>UTF-8{session?.envelope.bom && " BOM"}</span><span>{session?.envelope.newline === "\r\n" ? "CRLF" : "LF"}</span></div></footer>

    {session?.mode === 'document' && <SlashMenu key={session.id} editor={editor} onInsert={(kind, range) => {
      if (kind === 'image') void workspace.insertImages(session.id, undefined, undefined, range);
      else setSlashInsert({ id: session.id, kind, ...range });
    }} />}
    <SlashInsert workspace={workspace} request={slashInsert} onClose={() => setSlashInsert(null)} />
    {associationsOpen && <Settings onBusyChange={setAssociationBusy} onClose={() => setAssociationsOpen(false)} />}
    <Modal open={!!target} title="保存这页的修改？" onCancel={() => workspace.cancelClose()} footer={<div className="leave-actions"><Button disabled={busy} onClick={() => workspace.cancelClose()}>继续编辑</Button><Button disabled={busy} danger onClick={async () => { workspace.approveClose(); if (!workspace.closeTarget) await completeClose(); }}>不保存</Button><Button type="primary" disabled={busy} onClick={async () => { if (target && await save(target.id)) { workspace.approveClose(); if (!workspace.closeTarget) await completeClose(); } }}>保存并继续</Button></div>}><p>「{target?.name}」有未保存的修改。保存后再关闭，或放弃本次修改。</p>{(workspace.closing?.remaining.length ?? 0) > 1 && <p>还有 {workspace.closing!.remaining.length} 份文档需要确认。</p>}{workspace.error && <p role="alert" className="dialog-error">{workspace.error}</p>}</Modal>
  </div>;
}

function WorkspaceRoot() {
  const [workspace, setWorkspace] = useState<WorkspaceModel | null>(null);
  useEffect(() => { const model = new WorkspaceModel(undefined, undefined, new RecentModel(), desktopAvailable ? workspaceSession : undefined); model.addGuide(guide); setWorkspace(model); if (desktopAvailable) void (async () => { await model.restoreSession(); await model.startReliability(); })(); return () => model.dispose(); }, []);
  useEffect(() => { if (workspace && desktopAvailable) return connectExternalFiles(workspace); }, [workspace]);
  return workspace ? <Workspace workspace={workspace} /> : null;
}

export default function App() {
  const dark = useSettings((s) => s.dark);
  return <ConfigProvider theme={{ token: { color: { text: { primary: dark ? "#e4e4d9" : "#30322e", secondary: dark ? "#a3a69a" : "#777970" }, surface: { page: dark ? "#1f211d" : "#f5f3ee", container: dark ? "#252722" : "#fffefa", elevated: dark ? "#2e302a" : "#fffefa", muted: dark ? "#2e302a" : "#f4f3ef" }, border: { default: dark ? "#3d4036" : "#deded4", subtle: dark ? "#34372e" : "#e5e5dc" }, primary: { solid: dark ? "#e7e4db" : "#292a26", solidHover: dark ? "#f5f3ee" : "#44463f", solidActive: dark ? "#cecec1" : "#1e201b", onSolid: dark ? "#252622" : "#fffefa", subtle: dark ? "#3b4236" : "#e9ebe3", onSubtle: dark ? "#e4e4d9" : "#30322e", border: dark ? "#565b4c" : "#a2a398" } }, radius: { control: 5 } } }}><InkApp><WorkspaceRoot /></InkApp></ConfigProvider>;
}
