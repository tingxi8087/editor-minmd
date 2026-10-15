import { Editor } from "@tiptap/core";
import { editorExtensions } from "@/components/DocumentEditor/extensions";
import { files, type DirectoryEntry, type DirectoryRoot, type DocumentFile, type FileGateway } from "@/lib/files";
import { packMarkdown, unpackMarkdown, unsupportedMarkdown, type MarkdownEnvelope } from "@/lib/markdown";

export interface DocumentTab {
  id: string; path: string | null; name: string; raw: string; envelope: MarkdownEnvelope;
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
  private revision = 0;
  private sequence = 0;
  private untitledSequence = 0;
  private treeGeneration = 0;
  private disposed = false;
  private listeners = new Set<() => void>();

  constructor(private gateway: FileGateway = files) {}
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; };
  snapshot = () => this.revision;
  get active() { return this.tabs.find((tab) => tab.id === this.activeId) ?? null; }
  get closeTarget() { return this.tabs.find((tab) => tab.id === this.closing?.remaining[0]) ?? null; }
  get hasDirty() { return this.tabs.some((tab) => tab.dirty); }
  private changed() {
    if (this.disposed) return;
    for (const tab of this.tabs) {
      const editable = tab.id === this.activeId && !this.busy && !tab.reading && !tab.guide;
      if (tab.editor && tab.editor.isEditable !== editable) tab.editor.setEditable(editable, false);
    }
    this.revision++;
    this.listeners.forEach((callback) => callback());
  }
  clearError() { this.error = ""; this.changed(); }
  reportError(error: unknown) { this.error = String(error); this.changed(); }

  private add(name: string, raw: string, path: string | null, guide: boolean) {
    const envelope = unpackMarkdown(raw);
    const tab: DocumentTab = {
      id: `document-${++this.sequence}`, name, path, raw, envelope, guide,
      unsupported: unsupportedMarkdown(envelope.body), editor: null, baseline: "",
      dirty: false, reading: false, scrollTop: 0, status: "",
    };
    if (!tab.unsupported) {
      tab.editor = new Editor({
        extensions: editorExtensions(), content: envelope.body, contentType: "markdown", editable: false,
        onUpdate: ({ editor }) => {
          tab.dirty = JSON.stringify(editor.getJSON()) !== tab.baseline;
          tab.status = "";
          this.changed();
        },
        onSelectionUpdate: () => this.changed(),
      });
      tab.baseline = JSON.stringify(tab.editor.getJSON());
    }
    this.tabs.push(tab); this.activeId = tab.id; this.error = ""; this.changed();
    return tab;
  }
  addGuide(markdown: string) { return this.add("使用指南", markdown, null, true); }
  create() {
    if (this.busy || this.closing) return null;
    const tab = this.add(`未命名${++this.untitledSequence}.md`, "", null, false);
    tab.envelope.trailingNewline = true;
    requestAnimationFrame(() => {
      if (!this.disposed && this.activeId === tab.id) tab.editor?.commands.focus(undefined, { scrollIntoView: false });
    });
    return tab;
  }
  openFile(file: DocumentFile) {
    const existing = this.tabs.find((tab) => tab.path === file.path);
    if (existing) { this.activate(existing.id); return existing; }
    return this.add(file.name, file.content, file.path, false);
  }
  activate(id: string) {
    if (this.busy || this.closing || !this.tabs.some((tab) => tab.id === id)) return;
    this.activeId = id; this.error = ""; this.changed();
  }
  setReading(reading: boolean) { if (this.active && !this.busy) { this.active.reading = reading; this.changed(); } }
  markdown(tab: DocumentTab) { return tab.dirty && tab.editor ? packMarkdown(tab.editor.getMarkdown(), tab.envelope) : tab.raw; }

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
    if (!this.root || this.busy || this.closing || !entry.isMarkdown || entry.isSymlink) return;
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
    if (!tab || this.busy || tab.guide || !tab.editor) return false;
    if (!saveAs && tab.path && !tab.dirty) { tab.status = "已保存"; this.changed(); return true; }
    const restoreFocus = tab.editor.isFocused;
    this.busy = true; this.error = ""; this.changed();
    try {
      const oldPath = tab.path;
      const protectedPaths = this.tabs.filter((item) => item.id !== id && item.path).map((item) => item.path!);
      const saved = await this.gateway.saveDocument(tab.path, this.markdown(tab), tab.path ? tab.raw : null, saveAs, protectedPaths);
      if (!saved || this.disposed) return false;
      tab.path = saved.path; tab.name = saved.name; tab.raw = saved.content; tab.envelope = unpackMarkdown(saved.content);
      tab.baseline = JSON.stringify(tab.editor.getJSON()); tab.dirty = false; tab.status = "已保存到本地";
      if (oldPath && oldPath !== saved.path) await this.gateway.releaseDocument(oldPath);
      const separator = Math.max(saved.path.lastIndexOf("/"), saved.path.lastIndexOf("\\"));
      const parent = saved.path.slice(0, separator);
      if (oldPath !== saved.path && this.children.has(parent)) await this.loadDirectory(parent);
      return true;
    } catch (error) { this.error = String(error); return false; }
    finally {
      this.busy = false; this.changed();
      if (restoreFocus && !this.disposed) requestAnimationFrame(() => { if (!this.disposed && this.activeId === id) tab.editor?.commands.focus(); });
    }
  }

  requestClose(ids: string[], window = false) {
    if (this.busy || this.closing) return;
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
      // Complete native cleanup before allowing a path to be reopened.
      await Promise.all(removed.filter((tab) => tab.path).map((tab) => this.gateway.releaseDocument(tab.path!)));
      removed.forEach((tab) => tab.editor?.destroy());
      this.tabs = this.tabs.filter((tab) => !plan.ids.includes(tab.id));
      if (this.tabs.some((tab) => tab.id === plan.previousActiveId)) this.activeId = plan.previousActiveId;
      else if (!this.tabs.some((tab) => tab.id === this.activeId)) this.activeId = this.tabs[Math.min(Math.max(oldIndex, 0), this.tabs.length - 1)]?.id ?? null;
      this.closing = null;
      return plan.window;
    } catch (error) { this.error = String(error); this.closing = null; return false; }
    finally { this.busy = false; this.changed(); }
  }

  async chooseDirectory() {
    if (this.busy || this.closing) return;
    this.busy = true; this.error = ""; this.changed();
    try {
      const root = await this.gateway.openDirectory();
      if (root && !this.disposed) {
        this.treeGeneration++; this.root = root;
        this.children = new Map([[root.path, root.entries]]); this.expanded = new Set([root.path]);
        this.loading.clear(); this.treeErrors.clear();
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
    this.disposed = true; this.treeGeneration++; this.listeners.clear();
    this.tabs.forEach((tab) => tab.editor?.destroy());
  }
}
