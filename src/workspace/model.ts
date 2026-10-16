import { preferredMarkdownMode, useSettings, type MarkdownMode } from "@/store/settings";
import type { SavedWorkspace, WorkspaceSessionGateway } from "@/lib/workspaceSession";
import type { RecentModel } from "@/lib/recents";
import { isLocalReference, mapReferences, rebaseReference, referenceMarkdown, validLink } from "@/lib/resources";
import { SourceSession } from "@/components/SourceEditor/session";
import { documentKind, type DocumentKind } from "@/lib/documentType";
import { rebaseSourceContent, sourceReferenceTokens } from "@/lib/sourceResources";
import debounce from "lodash/debounce";
import { reliability, type Draft, type DiskSnapshot, type ReliabilityGateway } from "@/lib/reliability";
import { closeHistory } from "@tiptap/pm/history";
import { Editor, type JSONContent } from "@tiptap/core";
import { editorExtensions } from "@/components/DocumentEditor/extensions";
import { files, type DirectoryEntry, type DirectoryRoot, type DocumentFile, type FileGateway } from "@/lib/files";
import { packMarkdown, unpackMarkdown, unsupportedMarkdown, type MarkdownEnvelope } from "@/lib/markdown";

export interface DocumentTab {
  // References keep their original base in memory so Save As does not rewrite undo history.
  id: string; draftId: string; draftVersion: number; protectedDraftVersion: number; updatedAt: number; external: DiskSnapshot | null; retainedPaths: string[]; resourceBase: string | null; path: string | null; name: string; raw: string; envelope: MarkdownEnvelope;
  kind: DocumentKind; mode: 'document' | 'source'; authority: 'rich' | 'source';
  source: SourceSession | null; sourceText: string; richSource: string; richBasis: string; richBasisText: string; wrap: boolean; languageOverride?: string;
  guide: boolean; unsupported: string | null; editor: Editor | null;
  baseline: string; dirty: boolean; reading: boolean; scrollTop: number; status: string;
}
interface ClosePlan { ids: string[]; remaining: string[]; window: boolean; previousActiveId: string | null }

// Each open document owns a live editor and its history. Switching tabs never serializes
// or recreates another document, so content, selection and undo remain independent.
export class WorkspaceModel {
  tabs: DocumentTab[] = [];
  activeId: string | null = null;
  root: DirectoryRoot | null = null;
  children = new Map<string, DirectoryEntry[]>();
  expanded = new Set<string>();
  loading = new Set<string>();
  treeErrors = new Map<string, string>();
  busy = false;
  error = "";
  closing: ClosePlan | null = null;
  pendingDrafts: Draft[] = [];
  recoveryReady = false;
  recoveryError = "";
  watchError = "";
  listenerError = "";
  checkError = "";
  private subscribing = false;
  draftSavedAt = 0;
  private reliabilityStarted = false;
  private checkingDisk = false;
  private checkAgain = false;
  private diskGeneration = 0;
  private writeChain: Promise<boolean> = Promise.resolve(true);
  private lastQueuedDrafts = "";
  private lastWrittenDrafts = "";
  private watchPaths = "";
  private offDisk?: () => void;
  private pollTimer?: ReturnType<typeof setInterval>;
  private persistLater = debounce(() => { void this.flushDrafts(); }, 650, { maxWait: 3000 });
  private checkLater = debounce(() => { void this.checkDisk(); }, 300, { maxWait: 1000 });
  private watchLater = debounce(() => { void this.syncWatches(); }, 100);
  private focusCheck = () => { if (this.sessionReady) void this.flushSession(); void this.flushDrafts(); void this.checkDisk(); };
  private revision = 0;
  private sequence = 0;
  private untitledSequence = { markdown: 0, text: 0 };
  private treeGeneration = 0;
  private disposed = false;
  sessionReady = false;
  sessionError = '';
  sessionWarnings: string[] = [];
  private sessionStarting = false;
  private sessionWritten = '';
  private sessionQueued = '';
  private sessionChain: Promise<boolean> = Promise.resolve(true);
  private sessionLater = debounce(() => { void this.flushSession(); }, 200, { maxWait: 1000 });
  private listeners = new Set<() => void>();

  constructor(private gateway: FileGateway = files, private storage: ReliabilityGateway = reliability, readonly recents?: RecentModel, private sessionStorage?: WorkspaceSessionGateway) {}
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; };
  snapshot = () => this.revision;
  get active() { return this.tabs.find((tab) => tab.id === this.activeId) ?? null; }
  get closeTarget() { return this.tabs.find((tab) => tab.id === this.closing?.remaining[0]) ?? null; }
  get hasDirty() { return this.tabs.some((tab) => tab.dirty); }
  private changed() {
    if (this.disposed) return;
    for (const tab of this.tabs) {
      const editable = tab.mode === "document" && tab.id === this.activeId && !this.busy && !this.closing && !tab.reading && !tab.guide;
      if (tab.editor && tab.editor.isEditable !== editable) tab.editor.setEditable(editable, false);
      tab.source?.setEditable(tab.mode === "source" && tab.id === this.activeId && !this.busy && !this.closing && !tab.guide);
    }
    if (this.reliabilityStarted && this.recoveryReady && !this.closing) this.persistLater();
    if (this.checkAgain && !this.busy && !this.closing) this.checkLater();
    if (this.reliabilityStarted) this.watchLater();
    if (this.sessionStorage && this.sessionReady && !this.sessionStarting && !this.closing) {
      const signature = JSON.stringify(this.sessionSnapshot());
      if (signature !== this.sessionQueued) { this.sessionQueued = signature; this.sessionLater(); }
    }
    this.revision++;
    this.listeners.forEach((callback) => callback());
  }
  private sessionSnapshot(): SavedWorkspace {
    const tabs = this.tabs.filter(tab => tab.path && !tab.guide).map(tab => ({ path: tab.path!, mode: tab.mode, reading: tab.reading }));
    const active = this.tabs.find(tab => tab.id === (this.closing?.previousActiveId ?? this.activeId));
    return { version: 1, directory: this.root?.path ?? null, tabs, activePath: active?.path && tabs.some(tab => tab.path === active.path) ? active.path : tabs[0]?.path ?? null };
  }
  async restoreSession() {
    if (!this.sessionStorage || this.sessionStarting || this.busy || this.closing || this.disposed) return;
    this.sessionStarting = true; this.busy = true; this.changed();
    try {
      // A retry must not race a pending activation/tab write or resurrect a just-closed tab.
      if (this.sessionReady && !await this.flushSession()) return;
      const restored = await this.sessionStorage.restore(this.root === null);
      if (this.disposed) return;
      if (restored.exists) {
        const guides = this.tabs.filter(tab => tab.guide); guides.forEach(tab => tab.editor?.destroy());
        this.tabs = this.tabs.filter(tab => !tab.guide);
        if (restored.root && !this.root) {
          this.treeGeneration++; this.root = restored.root;
          this.children = new Map([[restored.root.path, restored.root.entries]]); this.expanded = new Set([restored.root.path]);
        }
        for (const saved of restored.tabs) {
          if (this.tabs.some(tab => tab.path === saved.file.path)) continue;
          this.add(saved.file.name, saved.file.content, saved.file.path, false);
        }
        this.activeId = this.tabs.find(tab => tab.path === restored.session.activePath)?.id ?? this.tabs[0]?.id ?? null;
      }
      this.sessionWarnings = restored.errors;
      this.sessionReady = true; this.sessionError = '';
      // Keep failed paths on disk until a deliberate workspace change, so a retry remains possible.
      this.sessionWritten = this.sessionQueued = JSON.stringify(this.sessionSnapshot());
    } catch (error) { this.sessionError = String(error); }
    finally { this.sessionStarting = false; this.busy = false; this.changed(); }
  }
  async flushSession(snapshot = this.sessionSnapshot(), reset = false) {
    this.sessionLater.cancel();
    if (!this.sessionStorage) return true;
    if (this.disposed || !this.sessionReady && !reset) return false;
    const signature = JSON.stringify(snapshot);
    this.sessionQueued = signature;
    const write = this.sessionChain.then(async () => {
      if (signature === this.sessionWritten && !reset) return true;
      try {
        await this.sessionStorage!.write(snapshot, reset);
        this.sessionWritten = signature; this.sessionReady = true; this.sessionError = ''; return true;
      } catch (error) { this.sessionError = String(error); return false; }
      finally { if (!this.disposed) { this.revision++; this.listeners.forEach(callback => callback()); } }
    });
    this.sessionChain = write; return write;
  }
  dismissSessionWarnings() { this.sessionWarnings = []; this.changed(); }
  clearError() { this.error = ""; this.changed(); }
  reportError(error: unknown) { this.error = String(error); this.changed(); }

  private add(name: string, raw: string, path: string | null, guide: boolean, kind = documentKind(name), initialMode: MarkdownMode = preferredMarkdownMode()) {
    const envelope = unpackMarkdown(raw);
    const unsupported = kind === "markdown" ? unsupportedMarkdown(envelope.body) : null;
    const tab: DocumentTab = {
      id: `document-${++this.sequence}`, draftId: crypto.randomUUID(), draftVersion: 0, protectedDraftVersion: -1, updatedAt: Date.now(), external: null, retainedPaths: [], name, path, resourceBase: path, raw, envelope, guide,
      kind, mode: kind === 'text' || unsupported || initialMode === 'source' ? 'source' : 'document', authority: 'source',
      source: null, sourceText: raw, richSource: raw, richBasis: '', richBasisText: raw, wrap: false,
      unsupported, editor: null, baseline: "",
      dirty: false, reading: kind === "markdown" && !unsupported && initialMode === "reading", scrollTop: 0, status: "",
    };
    this.attachEditor(tab);
    if (tab.mode === "source") this.attachSource(tab);
    this.tabs.push(tab); this.activeId = tab.id; this.error = ""; this.changed();
    return tab;
  }
  private attachEditor(tab: DocumentTab, body: string | JSONContent = tab.envelope.body) {
    if (tab.kind === "markdown" && !tab.unsupported) {
      tab.editor = new Editor({
        extensions: editorExtensions({
          image: async (src) => {
            if (/^https?:\/\//i.test(src)) return src;
            if (!tab.resourceBase) throw new Error("请先保存文档");
            return this.gateway.loadImage(tab.resourceBase, src);
          },
        }),
        editorProps: {
          handlePaste: (_view, event) => {
            const images = Array.from(event.clipboardData?.files ?? []).filter(file => file.type.startsWith("image/"));
            if (!images.length || !tab.editor?.isEditable) return false;
            event.preventDefault(); void this.insertImages(tab.id, images); return true;
          },
          handleDOMEvents: { click: (_view, event) => {
            const anchor = (event.target as Element)?.closest("a");
            if (!anchor) return false;
            event.preventDefault();
            if (tab.reading || event.metaKey || event.ctrlKey) void this.openLink(tab.id, anchor.getAttribute("href") ?? "");
            return true;
          } },
        }, content: body, contentType: typeof body === "string" ? "markdown" : "json", editable: false,
        onUpdate: ({ editor }) => {
          if (tab.mode !== 'document' || tab.guide) return;
          const json = JSON.stringify(editor.getJSON());
          if (json === tab.richBasis) { tab.authority = 'source'; tab.sourceText = tab.path && tab.resourceBase ? rebaseSourceContent(tab.richBasisText, tab.resourceBase, tab.path) : tab.richBasisText; tab.dirty = tab.sourceText !== tab.raw; }
          else { tab.authority = 'rich'; tab.dirty = json !== tab.baseline; }
          tab.draftVersion++;
          tab.updatedAt = Date.now();
          tab.status = "";
          this.changed();
        },
        onSelectionUpdate: () => this.changed(),
      });
      // Normalize structural plugins before taking the clean snapshot. Otherwise
      // opening a table menu can append the trailing paragraph and dirty a saved file.
      tab.editor.view.dispatch(tab.editor.state.tr.setMeta("preventUpdate", true).setMeta("addToHistory", false));
      tab.baseline = JSON.stringify(tab.editor.getJSON());
      tab.richBasis = tab.baseline; tab.richBasisText = tab.sourceText; tab.richSource = tab.sourceText;
    }
    return tab.editor;
  }
  addGuide(markdown: string) { return this.add("使用指南", markdown, null, true, "markdown"); }
  create(kind: DocumentKind = "markdown") {
    if (this.busy || this.closing) return null;
    let name: string;
    do {
      const number = ++this.untitledSequence[kind];
      name = `未命名${number === 1 ? "" : ` ${number}`}${kind === "markdown" ? ".md" : ""}`;
    } while (this.tabs.some(tab => tab.name === name));
    const tab = this.add(name, "", null, false, kind);
    tab.envelope.trailingNewline = true;
    requestAnimationFrame(() => {
      if (!this.disposed && this.activeId === tab.id) tab.mode === "source" ? tab.source?.focus() : tab.editor?.commands.focus(undefined, { scrollIntoView: false });
    });
    return tab;
  }
  openFile(file: DocumentFile) {
    void this.recents?.record(file.path, false);
    const existing = this.tabs.find((tab) => tab.path === file.path);
    if (existing) { this.activate(existing.id); return existing; }
    return this.add(file.name, file.content, file.path, false);
  }
  activate(id: string) {
    if (this.busy || this.closing || !this.tabs.some((tab) => tab.id === id)) return;
    this.activeId = id; this.error = ""; this.changed();
  }
  private attachSource(tab: DocumentTab) {
    tab.source?.destroy();
    tab.source = new SourceSession(tab.sourceText, tab.kind === 'markdown' ? 'document.md' : tab.name.replace(/ · 恢复副本$/, ''), () => {
      if (tab.mode !== 'source' || tab.guide) return;
      tab.sourceText = tab.source!.text(); tab.authority = 'source'; tab.dirty = tab.sourceText !== tab.raw;
      tab.updatedAt = Date.now(); tab.draftVersion++; tab.status = '';
      if (tab.kind === 'markdown') tab.unsupported = unsupportedMarkdown(unpackMarkdown(tab.sourceText).body);
      this.changed();
    }, () => this.changed());
    if (tab.languageOverride) tab.source.setFilename(tab.name, tab.languageOverride);
    tab.source.setWrap(tab.wrap);
    return tab.source;
  }
  setMode(mode: 'document' | 'source', reading = false) {
    if (this.busy || this.closing) return false;
    return this.applyMode(this.active, mode, reading);
  }
  private applyMode(tab: DocumentTab | null, mode: 'document' | 'source', reading = false) {
    if (!tab || (tab.kind !== 'markdown' && mode !== 'source')) return false;
    if (mode === 'document' && tab.mode === 'document' && tab.editor) { tab.reading = reading; this.changed(); return true; }
    if (mode === 'source') {
      const content = this.markdown(tab);
      if (tab.mode === 'document') tab.richSource = content;
      tab.sourceText = content; tab.authority = 'source';
      if (!tab.source || tab.source.text() !== content) this.attachSource(tab);
      tab.mode = mode; tab.reading = false;
    } else {
      const content = this.markdown(tab); const envelope = unpackMarkdown(content);
      const unsupported = unsupportedMarkdown(envelope.body);
      if (unsupported) { tab.unsupported = unsupported; this.reportError(`正文包含${unsupported}，请继续在源码模式编辑；保存会保留源码。`); return false; }
      if (!tab.editor || tab.richSource !== content) {
        let baseline = tab.baseline;
        if (baseline && tab.path && tab.resourceBase) baseline = JSON.stringify(mapReferences(JSON.parse(baseline), value => rebaseReference(value, tab.resourceBase!, tab.path!)));
        if (tab.resourceBase && tab.resourceBase !== tab.path) tab.retainedPaths.push(tab.resourceBase);
        tab.resourceBase = tab.path ?? tab.resourceBase; tab.envelope = envelope; tab.unsupported = null;
        tab.editor?.destroy(); tab.editor = null;
        this.attachEditor(tab, envelope.body);
        if (content !== tab.raw) tab.baseline = baseline;
        tab.authority = 'source'; tab.richSource = content;
      }
      tab.mode = mode; tab.reading = reading;
    }
    this.error = ''; this.changed();
    requestAnimationFrame(() => { if (!this.disposed && this.activeId === tab.id && tab.mode === mode) { if (mode === 'source') tab.source?.focus(); else tab.editor?.commands.focus(undefined, { scrollIntoView: false }); } });
    return true;
  }
  // One Markdown view preference applies to every tab. Unsupported syntax remains
  // in source so a global view change cannot silently lose file contents.
  selectMode(mode: MarkdownMode) {
    if (this.active?.kind !== "markdown" || !this.setMode(mode === "source" ? "source" : "document", mode === "reading")) return false;
    useSettings.getState().setMarkdownMode(mode);
    for (const tab of this.tabs) {
      if (tab === this.active || tab.kind !== "markdown") continue;
      if (mode !== "source" && unsupportedMarkdown(unpackMarkdown(this.markdown(tab)).body)) continue;
      this.applyMode(tab, mode === "source" ? "source" : "document", mode === "reading");
    }
    return true;
  }
  setReading(reading: boolean) { this.setMode('document', reading); }
  setSourceLanguage(name: string) { const tab = this.active; if (!tab?.source || this.busy) return; tab.languageOverride = name || undefined; tab.source.setFilename(tab.kind === 'markdown' ? 'document.md' : tab.name.replace(/ · 恢复副本$/, ''), name || undefined); this.changed(); }
  setSourceWrap(wrap: boolean) { if (this.active?.source) { this.active.wrap = wrap; this.active.source.setWrap(wrap); this.changed(); } }
  markdown(tab: DocumentTab) {
    if (!tab.dirty) return tab.raw;
    return tab.authority === 'source' || !tab.editor ? tab.sourceText : packMarkdown(referenceMarkdown(tab.editor, value => tab.resourceBase && tab.path ? rebaseReference(value, tab.resourceBase, tab.path) : value), tab.envelope);
  }

  async insertImages(id: string, images?: File[], paths?: string[], replace?: { from: number; to: number }) {
    const tab = this.tabs.find(item => item.id === id);
    if (tab?.mode !== "document" || !tab?.editor?.isEditable || this.busy || this.closing) return;
    const originalEditor = tab.editor;
    const originalRangeText = replace ? originalEditor.state.doc.textBetween(replace.from, replace.to) : null;
    if (!tab.path) {
      tab.status = "插入图片前，请先保存文档"; this.changed();
      if (!await this.save(id)) return;
    }
    if (this.disposed || !this.tabs.includes(tab) || this.activeId !== id || tab.mode !== 'document' || tab.editor !== originalEditor || originalEditor.isDestroyed) return;
    const position = replace ?? originalEditor.state.selection.from;
    this.busy = true; this.error = ""; this.changed();
    try {
      const inputs = images?.length ? images : paths?.length ? paths : [undefined];
      const content = [];
      for (const input of inputs) {
        if (input instanceof File && input.size > 20 * 1024 * 1024) throw new Error("图片不能超过 20 MB");
        const result = await this.gateway.importImage(tab.path!, typeof input === "string" ? input : undefined, input instanceof File ? Array.from(new Uint8Array(await input.arrayBuffer())) : undefined, input instanceof File ? input.name : undefined);
        if (!result) continue;
        const src = rebaseReference(result.reference, tab.path!, tab.resourceBase ?? tab.path!);
        content.push({ type: "image", attrs: { src, alt: result.name } });
      }
      if (content.length && !this.disposed && tab.editor === originalEditor) {
        if (replace && originalEditor.state.doc.textBetween(replace.from, replace.to) !== originalRangeText) throw new Error("插入位置已改变，请重新选择图片");
        originalEditor.chain().focus().command(({ tr }) => { if (replace) closeHistory(tr); return true; }).insertContentAt(position, content).run(); tab.status = "图片已存入文档旁的 assets/，请保存文档"; }
    } catch (error) { this.error = String(error); }
    finally { this.busy = false; this.changed(); }
  }
  async openLink(id: string, href: string) {
    const tab = this.tabs.find(item => item.id === id);
    if (!tab || this.busy || this.closing || !validLink(href)) { if (!validLink(href)) this.reportError("链接地址不可用"); return; }
    if (href.startsWith("#")) { this.jumpToAnchor(tab, href.slice(1)); return; }
    if (!tab.resourceBase && !/^https?:/i.test(href)) { this.reportError("请先保存文档，再打开相对链接"); return; }
    this.busy = true; this.error = ""; this.changed();
    try {
      const file = await this.gateway.openLink(tab.resourceBase ?? "", href);
      if (file && !this.disposed) {
        this.busy = false; const opened = this.openFile(file);
        const hash = href.indexOf("#"); if (hash >= 0) requestAnimationFrame(() => this.jumpToAnchor(opened, href.slice(hash + 1)));
      }
    } catch (error) { this.error = String(error); }
    finally { this.busy = false; this.changed(); }
  }
  private jumpToAnchor(tab: DocumentTab, anchor: string) {
    let decoded: string; try { decoded = decodeURIComponent(anchor); } catch { this.reportError("无效的标题锚点"); return; }
    const slug = (text: string) => text.trim().toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, "").replace(/\s/g, "-");
    let found = false; const counts = new Map<string, number>();
    tab.editor?.state.doc.descendants((node, position) => {
      if (node.type.name !== "heading") return;
      const base = slug(node.textContent); const count = counts.get(base) ?? 0; counts.set(base, count + 1);
      if (!found && (count ? `${base}-${count}` : base) === decoded) {
        found = true; const element = tab.editor?.view.nodeDOM(position);
        if (element instanceof HTMLElement) element.scrollIntoView({ block: "start" });
      }
    });
    if (!found) this.reportError("未找到链接对应的标题");
  }

  async chooseFile() {
    if (this.busy || this.closing) return;
    this.busy = true; this.error = ""; this.changed();
    try {
      const file = await this.gateway.openDocument();
      if (file && !this.disposed) {
        this.busy = false;
        this.openFile(file);
      }
    } catch (error) { this.error = String(error); }
    finally { this.busy = false; this.changed(); }
  }
  async openTreeFile(entry: DirectoryEntry) {
    if (!this.root || this.busy || this.closing || entry.isDirectory || entry.isFile === false || entry.isSymlink) return;
    const existing = this.tabs.find((tab) => tab.path === entry.path);
    if (existing) { this.activate(existing.id); return; }
    this.busy = true; this.error = ""; this.changed();
    try {
      const file = await this.gateway.readWorkspaceDocument(this.root.path, entry.path);
      if (!this.disposed) { this.busy = false; this.openFile(file); }
    } catch (error) { this.error = String(error); }
    finally { this.busy = false; this.changed(); }
  }
  async save(id: string, saveAs = false) {
    const tab = this.tabs.find((item) => item.id === id);
    if (!tab || this.busy || tab.guide || (!tab.editor && !tab.source)) return false;
    if (!saveAs && tab.external) { this.reportError("磁盘文件已变化，请先对比、重新载入或另存为；本地修改已保留。"); return false; }
    if (!saveAs && tab.path && !tab.dirty) { tab.status = "已保存"; this.changed(); return true; }
    const restoreFocus = tab.mode === "source" ? !!tab.source?.view?.hasFocus : !!tab.editor?.isFocused;
    this.busy = true; this.error = ""; this.changed();
    try {
      const oldPath = tab.path;
      const protectedPaths = this.tabs.filter((item) => item.id !== id && item.path).map((item) => item.path!);
      let content = this.markdown(tab);
      let resources: import("@/lib/files").ResourceSaveContext | undefined;
      if (saveAs && tab.kind === "markdown" && (tab.path || tab.resourceBase)) {
        if (tab.mode === "source" || !tab.editor) {
          const prepared = sourceReferenceTokens(content);
          if (prepared.references.length) { content = prepared.content; resources = { basePath: tab.path ?? tab.resourceBase!, references: prepared.references }; }
        } else if (tab.editor) {
        const references: { token: string; value: string }[] = [];
        const body = referenceMarkdown(tab.editor, value => {
          if (!isLocalReference(value)) return value;
          const token = `minmd-resource-${crypto.randomUUID()}`; references.push({ token, value }); return token;
        });
        if (references.length) { content = packMarkdown(body, tab.envelope); resources = { basePath: tab.resourceBase!, references }; }
        }
      }
      const saved = await this.gateway.saveDocument(tab.path, content, tab.path ? tab.raw : null, saveAs, protectedPaths, resources, tab.name.replace(/ · 恢复副本$/, ""));
      if (!saved || this.disposed) return false;
      tab.resourceBase ??= saved.path;
      this.diskGeneration++;
      tab.external = null;
      tab.path = saved.path; tab.name = saved.name; tab.raw = saved.content; tab.envelope = unpackMarkdown(saved.content);
      if (tab.mode === 'source') {
        if (tab.resourceBase && tab.resourceBase !== saved.path) tab.retainedPaths.push(tab.resourceBase);
        tab.resourceBase = saved.path;
        if (tab.sourceText !== saved.content) { tab.sourceText = saved.content; this.attachSource(tab); tab.richSource = ''; }
        if (tab.richSource === saved.content && tab.editor) tab.baseline = JSON.stringify(tab.editor.getJSON());
      } else if (tab.editor) tab.baseline = JSON.stringify(tab.editor.getJSON());
      const kind = documentKind(saved.name);
      if (kind !== tab.kind) {
        tab.kind = kind; tab.editor?.destroy(); tab.editor = null; tab.baseline = '';
        tab.sourceText = saved.content; tab.authority = 'source'; tab.richSource = ''; tab.mode = 'source'; this.attachSource(tab);
      }
      if (tab.source && !tab.languageOverride) tab.source.setFilename(kind === 'markdown' ? 'document.md' : saved.name);
      tab.dirty = false; tab.status = "已保存到本地";
      void this.recents?.record(saved.path, false);
      if (oldPath && oldPath !== saved.path && oldPath !== tab.resourceBase && !this.tabs.some(item => item.id !== id && (item.path === oldPath || item.resourceBase === oldPath))) await this.gateway.releaseDocument(oldPath);
      const separator = Math.max(saved.path.lastIndexOf("/"), saved.path.lastIndexOf("\\"));
      const parent = saved.path.slice(0, separator);
      if (oldPath !== saved.path && this.children.has(parent)) await this.loadDirectory(parent);
      await this.flushDrafts();
      return true;
    } catch (error) { this.error = String(error); return false; }
    finally {
      this.busy = false; this.changed();
      if (restoreFocus && !this.disposed) requestAnimationFrame(() => { if (!this.disposed && this.activeId === id) tab.mode === "source" ? tab.source?.focus() : tab.editor?.commands.focus(); });
    }
  }

  requestClose(ids: string[], window = false) {
    if (this.busy || this.closing) return;
    void this.flushDrafts();
    const targets = this.tabs.filter((tab) => ids.includes(tab.id));
    this.closing = { ids: targets.map((tab) => tab.id), remaining: targets.filter((tab) => tab.dirty).map((tab) => tab.id), window, previousActiveId: this.activeId };
    if (this.closing.remaining.length) this.activeId = this.closing.remaining[0];
    this.changed();
  }
  cancelClose() { if (!this.busy) { this.closing = null; this.changed(); } }
  approveClose() {
    if (!this.closing || this.busy) return;
    this.closing.remaining.shift();
    if (this.closing.remaining.length) this.activeId = this.closing.remaining[0];
    this.changed();
  }
  async completeClose() {
    const plan = this.closing;
    if (!plan || plan.remaining.length || this.busy) return false;
    this.busy = true; this.changed();
    const removed = this.tabs.filter((tab) => plan.ids.includes(tab.id));
    const oldIndex = this.tabs.findIndex((tab) => tab.id === this.activeId);
    try {
      const session = this.sessionSnapshot();
      if (!plan.window) {
        session.tabs = session.tabs.filter(item => !removed.some(tab => tab.path === item.path));
        if (!session.tabs.some(tab => tab.path === session.activePath)) session.activePath = session.tabs[0]?.path ?? null;
      }
      if (!await this.flushSession(session)) { this.error = '工作区记录保存失败，请重试后关闭'; this.closing = null; return false; }
      // Complete native cleanup before allowing a path to be reopened.
      if (!await this.flushDrafts(plan.ids)) { this.closing = null; return false; }
      this.diskGeneration++;
      const kept = this.tabs.filter(tab => !plan.ids.includes(tab.id));
      const paths = new Set(removed.flatMap(tab => [tab.path, tab.resourceBase, ...tab.retainedPaths]).filter((path): path is string => !!path));
      await Promise.all([...paths].filter(path => !kept.some(tab => tab.path === path || tab.resourceBase === path || tab.retainedPaths.includes(path))).map(path => this.gateway.releaseDocument(path)));
      removed.forEach((tab) => { tab.editor?.destroy(); tab.source?.destroy(); });
      this.tabs = this.tabs.filter((tab) => !plan.ids.includes(tab.id));
      if (this.tabs.some((tab) => tab.id === plan.previousActiveId)) this.activeId = plan.previousActiveId;
      else if (!this.tabs.some((tab) => tab.id === this.activeId)) this.activeId = this.tabs[Math.min(Math.max(oldIndex, 0), this.tabs.length - 1)]?.id ?? null;
      if (plan.window) this.sessionReady = false;
      this.closing = null;
      return plan.window;
    } catch (error) { this.error = String(error); this.closing = null; return false; }
    finally { this.busy = false; this.changed(); }
  }

  async startReliability() {
    if (this.reliabilityStarted || this.disposed) return;
    this.reliabilityStarted = true;
    window.addEventListener("focus", this.focusCheck);
    window.addEventListener("blur", this.focusCheck);
    this.pollTimer = setInterval(() => { void this.checkDisk(); }, 15000);
    void this.listenDiskChanges();
    await this.loadRecovery();
    if (!this.disposed) { await this.syncWatches(); await this.checkDisk(); }
  }
  private async listenDiskChanges() {
    if (this.offDisk || this.subscribing || this.disposed) return;
    this.subscribing = true;
    try {
      const off = await this.storage.onDiskChange(() => this.checkLater());
      if (this.disposed) off(); else { this.offDisk = off; this.listenerError = ""; }
    } catch (error) { if (!this.disposed) this.listenerError = String(error); }
    finally { this.subscribing = false; if (!this.disposed) this.changed(); }
  }
  async loadRecovery() {
    if (this.recoveryReady || this.busy || this.disposed) return;
    try {
      const drafts = await this.storage.loadDrafts();
      if (this.disposed) return;
      this.pendingDrafts = drafts; this.recoveryReady = true; this.recoveryError = "";
    } catch (error) { if (!this.disposed) this.recoveryError = String(error); }
    this.changed();
  }
  private draftSnapshot(omit: string[] = []) {
    const current = this.tabs.filter(tab => !tab.guide && tab.dirty && (tab.editor || tab.source) && !omit.includes(tab.id)).map((tab): Draft => ({
      id: tab.draftId, name: tab.name, path: tab.path, resourceBase: tab.path ?? tab.resourceBase,
      raw: tab.raw, content: this.markdown(tab),
      kind: tab.kind, mode: tab.mode, authority: tab.authority, sourceScrollTop: tab.source?.scrollTop ?? 0,
      document: tab.authority === "rich" && tab.editor ? mapReferences(tab.editor.getJSON(), value => tab.path && tab.resourceBase ? rebaseReference(value, tab.resourceBase, tab.path) : value) : null,
      baseline: tab.baseline ? mapReferences(JSON.parse(tab.baseline), value => tab.path && tab.resourceBase ? rebaseReference(value, tab.resourceBase, tab.path) : value) : null,
      updatedAt: tab.updatedAt, scrollTop: tab.scrollTop,
      selection: tab.mode === "source" ? tab.source?.state.selection.main.head ?? 0 : tab.editor?.state.selection.from ?? 1,
    }));
    return [...this.pendingDrafts.filter(draft => !current.some(tab => tab.id === draft.id)), ...current];
  }
  async flushDrafts(omit: string[] = []) {
    this.persistLater.cancel();
    if (!this.reliabilityStarted || !this.recoveryReady || this.disposed) return true;
    const drafts = this.draftSnapshot(omit); const signature = JSON.stringify(drafts);
    const versions = new Map(this.tabs.map(tab => [tab.draftId, tab.draftVersion]));
    const protectedVersions = () => {
      for (const tab of this.tabs) if (drafts.some(draft => draft.id === tab.draftId)) tab.protectedDraftVersion = versions.get(tab.draftId) ?? -1;
      this.recoveryError = "";
      if (!this.disposed) { this.revision++; this.listeners.forEach(callback => callback()); }
    };
    if (signature === this.lastQueuedDrafts) {
      const success = await this.writeChain;
      if (success && signature === this.lastWrittenDrafts) protectedVersions();
      return success;
    }
    this.lastQueuedDrafts = signature;
    const write = this.writeChain.then(async () => {
      if (signature === this.lastWrittenDrafts) { protectedVersions(); return true; }
      try {
        await this.storage.writeDrafts(drafts);
        this.lastWrittenDrafts = signature; protectedVersions(); this.recoveryError = ""; this.draftSavedAt = Date.now();
        if (!this.disposed) { this.revision++; this.listeners.forEach(callback => callback()); }
        return true;
      } catch (error) {
        if (this.lastQueuedDrafts === signature) this.lastQueuedDrafts = "";
        this.recoveryError = String(error);
        if (!this.disposed) { this.revision++; this.listeners.forEach(callback => callback()); }
        return false;
      }
    });
    this.writeChain = write; return write;
  }
  async discardDraft(id: string) {
    if (this.busy || !this.recoveryReady) return;
    const previous = this.pendingDrafts; this.pendingDrafts = previous.filter(draft => draft.id !== id);
    this.busy = true; this.changed();
    if (!await this.flushDrafts()) this.pendingDrafts = previous;
    this.busy = false; this.changed();
  }
  async recoverDraft(id: string) {
    const draft = this.pendingDrafts.find(item => item.id === id);
    if (!draft || this.busy || this.closing) return;
    this.busy = true; this.changed();
    try {
      const disk = await this.storage.authorizeDraft(id);
      if (this.disposed) return;
      const duplicate = draft.path && this.tabs.some(tab => tab.path === draft.path);
      const tab = this.add(duplicate ? `${draft.name} · 恢复副本` : draft.name, draft.raw, duplicate ? null : draft.path, false, draft.kind ?? documentKind(draft.path ?? draft.name), draft.mode === "source" ? "source" : "document");
      tab.resourceBase = draft.resourceBase ?? draft.path; tab.envelope = unpackMarkdown(draft.content);
      tab.draftId = draft.id; tab.updatedAt = draft.updatedAt;
      tab.sourceText = draft.content; tab.authority = draft.authority ?? (draft.document ? 'rich' : 'source');
      tab.unsupported = tab.kind === 'markdown' ? unsupportedMarkdown(tab.envelope.body) : null;
      const baseline = tab.baseline; tab.editor?.destroy(); tab.editor = null;
      if (tab.kind === 'markdown' && !tab.unsupported) {
        this.attachEditor(tab, draft.document ?? tab.envelope.body);
        tab.baseline = draft.baseline ? JSON.stringify(draft.baseline) : baseline;
      }
      tab.mode = tab.kind === 'text' || tab.unsupported || draft.mode === 'source' ? 'source' : 'document';
      if (tab.mode === 'source') { this.attachSource(tab); tab.source!.select(draft.selection); tab.source!.scrollTop = draft.sourceScrollTop ?? draft.scrollTop; }
      else { const editor = tab.editor as Editor | null; editor?.commands.setTextSelection(Math.min(Math.max(1, draft.selection), Math.max(1, editor.state.doc.content.size - 1))); }
      tab.draftVersion++; tab.dirty = true; tab.scrollTop = draft.scrollTop;
      const preferred = preferredMarkdownMode();
      if (tab.kind === "markdown" && (preferred === "source" || !tab.unsupported)) this.applyMode(tab, preferred === "source" ? "source" : "document", preferred === "reading");
      tab.status = "已恢复草稿，请检查后保存";
      if (!duplicate && disk && (disk.kind !== "present" || disk.content !== draft.raw)) tab.external = disk;
      this.pendingDrafts = this.pendingDrafts.filter(item => item.id !== id);
      this.diskGeneration++;
      await this.flushDrafts();
    } catch (error) { this.recoveryError = String(error); }
    finally { this.busy = false; this.changed(); }
  }
  private async syncWatches() {
    if (this.disposed) return;
    const paths = this.tabs.flatMap(tab => tab.path ? [tab.path] : []); const key = JSON.stringify(paths);
    if (key === this.watchPaths) return;
    this.watchPaths = key;
    try { await this.storage.watchDocuments(paths); if (!this.disposed) { this.watchError = ""; this.revision++; this.listeners.forEach(callback => callback()); } }
    catch (error) { if (!this.disposed) { this.watchPaths = ""; this.watchError = String(error); this.revision++; this.listeners.forEach(callback => callback()); } }
  }
  async checkDisk() {
    if (!this.reliabilityStarted || this.disposed) return;
    if (this.busy || this.closing || this.checkingDisk) { this.checkAgain = true; return; }
    this.checkAgain = false;
    if (this.listenerError) await this.listenDiskChanges();
    if (this.watchError) await this.syncWatches();
    const tabs = this.tabs.filter(tab => tab.path && !tab.guide);
    if (!tabs.length) return;
    const generation = this.diskGeneration;
    this.checkingDisk = true;
    try {
      const snapshots = await this.storage.checkDocuments(tabs.map(tab => tab.path!));
      if (this.disposed || this.busy || this.closing || generation !== this.diskGeneration) { this.checkAgain = true; return; }
      this.checkError = "";
      for (const snapshot of snapshots) {
        const tab = this.tabs.find(item => item.path === snapshot.path);
        if (!tab) continue;
        if (snapshot.kind === "present" && snapshot.content === tab.raw) tab.external = null;
        else if (!tab.dirty && snapshot.kind === "present") this.replaceFromDisk(tab, snapshot.content!);
        else tab.external = snapshot;
      }
      this.changed();
    } catch (error) { if (!this.disposed && generation === this.diskGeneration) { this.checkError = String(error); this.changed(); } }
    finally { this.checkingDisk = false; if (this.checkAgain && !this.disposed) { this.checkAgain = false; this.checkLater(); } }
  }
  private replaceFromDisk(tab: DocumentTab, content: string) {
    const selection = tab.mode === 'source' ? tab.source?.state.selection.main.head ?? 0 : tab.editor?.state.selection.from ?? 1;
    const sourceScroll = tab.source?.scrollTop ?? 0;
    tab.editor?.destroy(); tab.editor = null; tab.source?.destroy(); tab.source = null;
    if (tab.resourceBase && tab.resourceBase !== tab.path) tab.retainedPaths.push(tab.resourceBase);
    tab.resourceBase = tab.path; tab.raw = content; tab.sourceText = content; tab.authority = 'source'; tab.envelope = unpackMarkdown(content);
    tab.unsupported = tab.kind === 'markdown' ? unsupportedMarkdown(tab.envelope.body) : null; tab.external = null; tab.dirty = false;
    const editor = this.attachEditor(tab);
    if (tab.kind === 'text' || tab.unsupported) tab.mode = 'source';
    if (tab.mode === 'source') { this.attachSource(tab); tab.source!.select(selection); tab.source!.scrollTop = sourceScroll; }
    else editor?.commands.setTextSelection(Math.min(selection, Math.max(1, editor.state.doc.content.size - 1)));
    if (editor) { tab.baseline = JSON.stringify(editor.getJSON()); tab.richBasis = tab.baseline; }
    tab.dirty = false;
    tab.status = "已载入外部更新";
  }
  async reloadDisk(id: string) {
    const tab = this.tabs.find(item => item.id === id);
    if (!tab?.path || this.busy || this.closing) return false;
    this.busy = true; this.changed();
    try {
      // Re-read after confirmation: a comparison shown earlier can already be out of date.
      const disk = (await this.storage.checkDocuments([tab.path]))[0];
      if (this.disposed) return false;
      if (!disk || disk.kind !== "present") { tab.external = disk ?? tab.external; return false; }
      if (!await this.flushDrafts([tab.id])) return false;
      this.diskGeneration++; this.replaceFromDisk(tab, disk.content!);
      return true;
    } catch (error) { this.error = String(error); return false; }
    finally { this.busy = false; this.changed(); }
  }

  private pathWithin(path: string | null, parent: string) { return !!path && (path === parent || path.startsWith(parent.replace(/[\\/]$/, '') + (parent.includes('\\') ? '\\' : '/'))); }
  private parentPath(path: string) { const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')); return path.slice(0, index === 0 || (index === 2 && /^[a-z]:/i.test(path)) ? index + 1 : index); }
  private mutationAllowed(path: string, protectDrafts = true) {
    if (!this.root || this.busy || this.closing || !this.pathWithin(path, this.root.path)) return false;
    if (protectDrafts && this.pendingDrafts.some(draft => this.pathWithin(draft.path, path) || this.pathWithin(draft.resourceBase, path))) { this.reportError('此位置有待恢复草稿，请先恢复或丢弃草稿再操作'); return false; }
    return true;
  }
  async createEntry(parent: string, name: string, directory: boolean) {
    if (!this.root || !this.mutationAllowed(parent, false)) return false;
    this.busy = true; this.error = ''; this.changed();
    try {
      const path = await this.gateway.createEntry(this.root.path, parent, name, directory);
      this.treeGeneration++; this.loading.clear(); this.treeErrors.clear();
      this.expanded.add(parent); await this.loadDirectory(parent);
      if (directory) { this.expanded.add(path); await this.loadDirectory(path); }
      else { const file = await this.gateway.readWorkspaceDocument(this.root.path, path); this.openFile(file); }
      return true;
    } catch (error) { this.error = String(error); return false; }
    finally { this.busy = false; this.changed(); }
  }
  async renameEntry(path: string, name: string) {
    if (!this.root || !this.mutationAllowed(path)) return false;
    if (path === this.root.path) { this.reportError('不能重命名工作目录本身'); return false; }
    if (name === path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)) return true;
    const affected = this.tabs.filter(tab => this.pathWithin(tab.path, path));
    this.busy = true; this.error = ''; this.diskGeneration++; this.changed();
    try {
      if (!await this.flushDrafts()) { this.error = '草稿尚未保护，重命名已取消，请先重试草稿保存'; return false; }
      const target = await this.gateway.renameEntry(this.root.path, path, name, affected.map(tab => ({ path: tab.path!, content: tab.raw })));
      const mapped = (value: string) => this.pathWithin(value, path) ? target + value.slice(path.length) : value;
      for (const tab of this.tabs) {
        if (tab.path && this.pathWithin(tab.path, path)) {
          const content = this.markdown(tab); const previousKind = tab.kind;
          tab.path = mapped(tab.path); tab.name = tab.path.slice(Math.max(tab.path.lastIndexOf('/'), tab.path.lastIndexOf('\\')) + 1);
          tab.kind = documentKind(tab.name);
          if (previousKind !== tab.kind) { tab.sourceText = content; tab.authority = 'source'; tab.mode = 'source'; tab.reading = false; tab.editor?.destroy(); tab.editor = null; tab.baseline = ''; tab.richSource = ''; tab.unsupported = tab.kind === 'markdown' ? unsupportedMarkdown(unpackMarkdown(content).body) : null; this.attachSource(tab); }
          else tab.source?.setFilename(tab.kind === 'markdown' ? 'document.md' : tab.name, tab.languageOverride);
          tab.external = null; tab.status = '路径已更新'; tab.draftVersion++;
        }
        if (tab.resourceBase) tab.resourceBase = mapped(tab.resourceBase);
        tab.retainedPaths = tab.retainedPaths.map(mapped);
      }
      this.treeGeneration++; this.loading.clear(); this.treeErrors.clear();
      this.children = new Map([...this.children].map(([key, entries]) => [mapped(key), entries.map(entry => ({ ...entry, path: mapped(entry.path), name: entry.path === path ? name : entry.name }))]));
      this.expanded = new Set([...this.expanded].map(mapped));
      this.diskGeneration++; await this.loadDirectory(this.parentPath(target)); await this.flushDrafts();
      void this.recents?.load();
      return true;
    } catch (error) { this.error = String(error); return false; }
    finally { this.busy = false; this.changed(); }
  }
  async trashEntry(path: string) {
    if (!this.root || !this.mutationAllowed(path)) return false;
    if (path === this.root.path) { this.reportError('不能删除工作目录本身'); return false; }
    const affected = this.tabs.filter(tab => this.pathWithin(tab.path, path));
    if (affected.some(tab => tab.dirty)) { this.reportError('此位置包含未保存文档，请先保存或关闭这些标签，再移到回收站'); return false; }
    if (this.tabs.some(tab => !affected.includes(tab) && this.pathWithin(tab.resourceBase, path))) { this.reportError('此位置仍被其他标签用作资源基准，请先关闭相关标签'); return false; }
    this.busy = true; this.error = ''; this.diskGeneration++; this.changed();
    try {
      const ids = affected.map(tab => tab.id);
      if (!await this.flushDrafts()) { this.error = '草稿尚未保护，删除已取消，请先重试草稿保存'; return false; }
      await this.gateway.trashEntry(this.root.path, path, affected.map(tab => ({ path: tab.path!, content: tab.raw })));
      affected.forEach(tab => { tab.editor?.destroy(); tab.source?.destroy(); });
      this.tabs = this.tabs.filter(tab => !ids.includes(tab.id));
      for (const tab of this.tabs) tab.retainedPaths = tab.retainedPaths.filter(value => !this.pathWithin(value, path));
      if (ids.includes(this.activeId ?? '')) this.activeId = this.tabs[0]?.id ?? null;
      this.treeGeneration++; this.loading.clear(); this.treeErrors.clear();
      this.children = new Map([...this.children].filter(([key]) => !this.pathWithin(key, path)).map(([key, entries]) => [key, entries.filter(entry => !this.pathWithin(entry.path, path))]));
      this.expanded = new Set([...this.expanded].filter(key => !this.pathWithin(key, path)));
      this.diskGeneration++; await this.loadDirectory(this.parentPath(path)); await this.flushDrafts();
      void this.recents?.load();
      return true;
    } catch (error) { this.error = String(error); return false; }
    finally { this.busy = false; this.changed(); }
  }
  private acceptRoot(root: DirectoryRoot) {
    this.treeGeneration++; this.root = root;
    this.children = new Map([[root.path, root.entries]]); this.expanded = new Set([root.path]);
    this.loading.clear(); this.treeErrors.clear();
    void this.recents?.record(root.path, true);
  }
  async openRecent(path: string, directory: boolean) {
    if (!this.recents || this.busy || this.closing || this.disposed) return false;
    const existing = !directory && this.tabs.find(tab => tab.path === path);
    if (existing) { this.activate(existing.id); void this.recents.record(path, false); return true; }
    this.busy = true; this.changed();
    try {
      if (directory) {
        const root = await this.recents.gateway.openDirectory(path);
        if (this.disposed) return false;
        this.acceptRoot(root);
      } else {
        const file = await this.recents.gateway.openFile(path);
        if (this.disposed) return false;
        this.busy = false; this.openFile(file);
      }
      return true;
    } catch (error) { this.recents.reportError(error); return false; }
    finally { this.busy = false; this.changed(); }
  }
  async chooseDirectory() {
    if (this.busy || this.closing) return;
    this.busy = true; this.error = ""; this.changed();
    try {
      const root = await this.gateway.openDirectory();
      if (root && !this.disposed) {
        this.acceptRoot(root);
      }
    } catch (error) { this.error = String(error); }
    finally { this.busy = false; this.changed(); }
  }
  async toggleDirectory(path: string) {
    if (!this.root || this.busy || this.closing) return;
    if (this.expanded.has(path)) { this.expanded.delete(path); this.changed(); return; }
    this.expanded.add(path); this.changed();
    if (!this.children.has(path)) await this.loadDirectory(path);
  }
  async loadDirectory(path: string) {
    if (!this.root || this.loading.has(path)) return;
    const root = this.root.path; const generation = this.treeGeneration;
    this.loading.add(path); this.treeErrors.delete(path); this.changed();
    try {
      const entries = await this.gateway.listDirectory(root, path);
      if (!this.disposed && generation === this.treeGeneration) this.children.set(path, entries);
    } catch (error) { if (generation === this.treeGeneration) this.treeErrors.set(path, String(error)); }
    finally { if (generation === this.treeGeneration) { this.loading.delete(path); this.changed(); } }
  }
  async refreshTree() {
    if (!this.root || this.busy || this.closing) return;
    const root = this.root.path;
    this.treeGeneration++; this.children.clear(); this.loading.clear(); this.treeErrors.clear(); this.expanded = new Set([root]);
    await this.loadDirectory(root);
  }
  async closeDirectory() {
    if (this.busy || this.closing) return;
    this.busy = true; this.changed();
    try {
      await this.gateway.closeDirectory(); this.treeGeneration++; this.root = null;
      this.children.clear(); this.expanded.clear(); this.loading.clear(); this.treeErrors.clear();
    } catch (error) { this.error = String(error); }
    finally { this.busy = false; this.changed(); }
  }
  dispose() {
    this.persistLater.cancel(); this.checkLater.cancel(); this.watchLater.cancel(); this.sessionLater.cancel();
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.offDisk?.(); window.removeEventListener("focus", this.focusCheck); window.removeEventListener("blur", this.focusCheck);
    this.disposed = true; this.treeGeneration++; this.listeners.clear();
    this.tabs.forEach((tab) => { tab.editor?.destroy(); tab.source?.destroy(); });
  }
}
