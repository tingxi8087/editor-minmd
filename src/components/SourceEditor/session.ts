import { Compartment, EditorSelection, EditorState, Text, type Transaction, type TransactionSpec } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo, undoDepth, redoDepth } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, indentOnInput, LanguageDescription, syntaxHighlighting } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
import { languages } from '@codemirror/language-data';
import { markdown } from '@codemirror/lang-markdown';
import { tags } from '@lezer/highlight';

const inkHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: 'var(--source-keyword)' },
  { tag: [tags.string, tags.regexp, tags.special(tags.string)], color: 'var(--source-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--source-number)' },
  { tag: tags.comment, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: [tags.typeName, tags.className, tags.definition(tags.variableName)], color: 'var(--source-type)' },
  { tag: [tags.tagName, tags.attributeName, tags.propertyName], color: 'var(--source-tag)' },
  { tag: tags.heading, fontWeight: '600', color: 'var(--ink)' },
  { tag: [tags.link, tags.url], color: 'var(--link)', textDecoration: 'underline' },
  { tag: tags.strong, fontWeight: '600' }, { tag: tags.emphasis, fontStyle: 'italic' },
]);
export const languageDescription = (name: string) => LanguageDescription.matchFilename(languages, name);

// Owns an immutable CodeMirror state even while its view is hidden or unmounted.
export class SourceSession {
  state: EditorState;
  view: EditorView | null = null;
  scrollTop = 0;
  scrollLeft = 0;
  language = 'Plain Text';
  languageError = '';
  languageReady: Promise<void> = Promise.resolve();
  private languageConfig = new Compartment();
  private editableConfig = new Compartment();
  private wrapConfig = new Compartment();
  private readOnly = true;
  private destroyed = false;
  private languageVersion = 0;
  private bom: string;
  private newline: string;

  constructor(raw: string, name: string, private onChange: () => void, private onCursor: () => void) {
    this.bom = raw.startsWith('\uFEFF') ? '\uFEFF' : '';
    this.newline = raw.includes('\r\n') ? '\r\n' : '\n';
    this.state = EditorState.create({
      doc: Text.of(raw.slice(this.bom.length).split(/\r\n?|\n/)),
      extensions: [
        EditorState.phrases.of({
          Find: '查找', Replace: '替换', next: '下一个', previous: '上一个', all: '全选匹配',
          'match case': '区分大小写', regexp: '正则表达式', 'by word': '全字匹配', replace: '替换', 'replace all': '全部替换', close: '关闭',
          'Go to line': '跳转到行', go: '跳转', 'current match': '当前匹配', 'on line': '所在行',
          'replaced match on line $': '已替换第 $ 行的匹配', 'replaced $ matches': '已替换 $ 个匹配',
          'Folded lines': '已折叠行', 'Unfolded lines': '已展开行', to: '至', 'folded code': '已折叠代码', unfold: '展开',
          'Fold line': '折叠此行', 'Unfold line': '展开此行', 'Control character': '控制字符',
        }),
        lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), foldGutter(), drawSelection(),
        history(), indentOnInput(), bracketMatching(), highlightSelectionMatches(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, indentWithTab]),
        syntaxHighlighting(inkHighlight), EditorState.tabSize.of(2),
        EditorView.contentAttributes.of({ 'aria-label': '源码编辑器', spellcheck: 'false' }),
        this.languageConfig.of([]), this.editableConfig.of([EditorState.readOnly.of(true), EditorView.editable.of(false)]),
        this.wrapConfig.of([]),
        EditorState.changeFilter.of(transaction => !transaction.docChanged || !this.readOnly),
        EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { overflow: 'auto' } }),
        EditorView.domEventHandlers({ scroll: (_event, view) => {
          if (view.dom.getClientRects().length) { this.scrollTop = view.scrollDOM.scrollTop; this.scrollLeft = view.scrollDOM.scrollLeft; }
        } }),
      ],
    });
    this.setFilename(name);
  }
  text() { return this.bom + this.state.doc.toString().replace(/\n/g, this.newline); }
  get cursor() { const head = this.state.selection.main.head; const line = this.state.doc.lineAt(head); return { line: line.number, column: head - line.from + 1 }; }
  get canUndo() { return undoDepth(this.state) > 0; }
  get canRedo() { return redoDepth(this.state) > 0; }
  dispatch = (...specs: TransactionSpec[]) => { if (!this.destroyed) this.apply(this.state.update(...specs)); };
  private apply(transaction: Transaction) {
    if (this.destroyed) return;
    this.state = transaction.state;
    this.view?.update([transaction]);
    if (transaction.docChanged) this.onChange();
    else if (transaction.selection) this.onCursor();
  }
  setEditable(editable: boolean) {
    if (this.readOnly === !editable || this.destroyed) return;
    this.readOnly = !editable;
    this.dispatch({ effects: this.editableConfig.reconfigure([EditorState.readOnly.of(!editable), EditorView.editable.of(editable)]) });
  }
  setWrap(wrap: boolean) { this.dispatch({ effects: this.wrapConfig.reconfigure(wrap ? EditorView.lineWrapping : []) }); }
  setFilename(name: string, override?: string) {
    const version = ++this.languageVersion;
    const description = override === 'Plain Text' ? null : override ? languages.find(language => language.name === override) : languageDescription(name);
    this.language = description?.name ?? 'Plain Text'; this.languageError = '';
    this.dispatch({ effects: this.languageConfig.reconfigure([]) });
    this.languageReady = description ? (description.name === 'Markdown' ? Promise.resolve(markdown({ codeLanguages: languages })) : description.load()).then(support => {
      if (!this.destroyed && version === this.languageVersion) this.dispatch({ effects: this.languageConfig.reconfigure(support) });
    }).catch(() => { if (!this.destroyed && version === this.languageVersion) { this.languageError = '语言高亮加载失败，当前仍可编辑'; this.onCursor(); } }) : Promise.resolve();
  }
  mount(parent: HTMLElement) {
    this.unmount();
    this.view = new EditorView({ state: this.state, parent, dispatchTransactions: transactions => { for (const transaction of transactions) this.apply(transaction); } });
    this.restoreScroll();
    return this.view;
  }
  restoreScroll() {
    if (!this.view) return;
    this.view.scrollDOM.scrollTop = this.scrollTop; this.view.scrollDOM.scrollLeft = this.scrollLeft;
    this.view.requestMeasure();
  }
  focus() { this.view?.focus(); }
  select(anchor: number, head = anchor) { this.dispatch({ selection: EditorSelection.single(Math.min(anchor, this.state.doc.length), Math.min(head, this.state.doc.length)) }); }
  undo() { if (!this.readOnly) undo({ state: this.state, dispatch: transaction => this.apply(transaction) }); }
  redo() { if (!this.readOnly) redo({ state: this.state, dispatch: transaction => this.apply(transaction) }); }
  search() { if (this.view) openSearchPanel(this.view); }
  unmount() {
    if (this.view) { if (this.view.dom.getClientRects().length) { this.scrollTop = this.view.scrollDOM.scrollTop; this.scrollLeft = this.view.scrollDOM.scrollLeft; } this.view.destroy(); this.view = null; }
  }
  destroy() { this.unmount(); this.destroyed = true; this.languageVersion++; }
}
