// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { SourceSession } from '../src/components/SourceEditor/session';
import { WorkspaceModel } from '../src/workspace/model';
import { rebaseReference } from '../src/lib/resources';
import { useSettings } from '../src/store/settings';
import { files } from '../src/lib/files';
import type { Draft, ReliabilityGateway } from '../src/lib/reliability';
import { sourceReferenceTokens, rebaseSourceContent } from '../src/lib/sourceResources';
const models: WorkspaceModel[] = []; const sources: SourceSession[] = [];
const file = (name: string, content: string) => ({ path: `/notes/${name}`, name, content });
function setup() {
  let drafts: Draft[] = [];
  const gateway = { ...files,
    saveDocument: vi.fn<typeof files.saveDocument>().mockImplementation(async (path, content, _expected, as, _protected, resources, name) => {
      const destination = as ? '/other/copy.md' : path ?? `/notes/${name}`;
      if (resources) for (const reference of resources.references) content = content.replace(reference.token, rebaseReference(reference.value, resources.basePath, destination));
      return { path: destination, name: destination.split('/').pop()!, content };
    }),
    releaseDocument: vi.fn<typeof files.releaseDocument>().mockResolvedValue(undefined),
    loadImage: vi.fn<typeof files.loadImage>().mockResolvedValue('data:image/png;base64,x'),
    readWorkspaceDocument: vi.fn<typeof files.readWorkspaceDocument>().mockImplementation(async (_, path) => ({ path, name: path.split('/').pop()!, content: 'const n = 1;\n' })),
  };
  const storage = {
    loadDrafts: vi.fn<ReliabilityGateway['loadDrafts']>().mockImplementation(async () => structuredClone(drafts)),
    writeDrafts: vi.fn<ReliabilityGateway['writeDrafts']>().mockImplementation(async values => { drafts = structuredClone(values); }),
    authorizeDraft: vi.fn<ReliabilityGateway['authorizeDraft']>().mockResolvedValue(null),
    checkDocuments: vi.fn<ReliabilityGateway['checkDocuments']>().mockResolvedValue([]),
    watchDocuments: vi.fn<ReliabilityGateway['watchDocuments']>().mockResolvedValue(undefined),
    onDiskChange: vi.fn<ReliabilityGateway['onDiskChange']>().mockResolvedValue(() => {}),
  };
  const make = () => { const model = new WorkspaceModel(gateway, storage); models.push(model); return model; };
  return { model: make(), make, gateway, storage, drafts: () => drafts };
}
const insert = (model: WorkspaceModel, text: string) => { const source = model.active!.source!; source.dispatch({ changes: { from: source.state.doc.length, insert: text }, userEvent: 'input.type' }); };
afterEach(() => { models.forEach(model => model.dispose()); models.length = 0; sources.forEach(source => source.destroy()); sources.length = 0; });

describe('CodeMirror state and syntax', () => {
  it('retains an independent undo history, selection and CRLF/BOM when edited', () => {
    const change = vi.fn(); const source = new SourceSession('\uFEFFa\r\n\r\n', 'a.txt', change, () => {}); sources.push(source); source.setEditable(true);
    source.select(1); source.dispatch({ changes: { from: 1, insert: '中文' }, selection: { anchor: 3 } });
    expect(source.text()).toBe('\uFEFFa中文\r\n\r\n'); expect(source.cursor).toEqual({ line: 1, column: 4 });
    source.undo(); expect(source.text()).toBe('\uFEFFa\r\n\r\n'); source.redo(); expect(source.text()).toContain('中文'); expect(change).toHaveBeenCalledTimes(3);
  });
  it('blocks source transactions while read-only and allows display-only options without dirtying', () => {
    const change = vi.fn(); const source = new SourceSession('abc', 'x.ts', change, () => {}); sources.push(source);
    source.dispatch({ changes: { from: 0, insert: 'blocked' } }); expect(source.text()).toBe('abc');
    source.setWrap(true); source.setEditable(true); source.setFilename('file.json'); expect(change).not.toHaveBeenCalled();
    source.dispatch({ changes: { from: 0, insert: 'ok' } }); expect(source.text()).toBe('okabc');
  });
  it.each([
    ['test.ts', 'const n: number = 1;', 'TypeScript'], ['view.tsx', 'const A = () => <div />;', 'TSX'],
    ['file.js', 'const n = 1;', 'JavaScript'], ['file.json', '{"n": 1}', 'JSON'],
    ['style.css', '.a { color: red; }', 'CSS'], ['index.html', '<h1>Hello</h1>', 'HTML'],
    ['main.rs', 'fn main() { let n = 1; }', 'Rust'], ['main.py', 'def f():\n  return 1', 'Python'],
    ['run.sh', '#!/bin/sh\necho hello', 'Shell'], ['config.yaml', 'name: hello\n', 'YAML'], ['A.md', '# Title\n\n**bold**', 'Markdown'],
  ])('loads the actual syntax parser for %s', async (name, content, language) => {
    const source = new SourceSession(content, name, () => {}, () => {}); sources.push(source); await source.languageReady;
    expect(source.language).toBe(language); expect(source.languageError).toBe('');
    ensureSyntaxTree(source.state, source.state.doc.length, 1000);
    expect(syntaxTree(source.state).length).toBeGreaterThan(0); expect(syntaxTree(source.state).topNode.firstChild).not.toBeNull();
  });
  it('falls back to plain text and ignores late language loads after disposal', async () => {
    const source = new SourceSession('hello', 'unknown.xyz', () => {}, () => {}); sources.push(source); expect(source.language).toBe('Plain Text');
    source.setFilename('a.ts'); source.setFilename('a.txt', 'Plain Text'); await source.languageReady;
    expect(source.language).toBe('Plain Text'); expect(source.text()).toBe('hello'); source.destroy();
  });
});

describe('document/source mode ownership', () => {
  it('switches without changing original bytes, dirty state, editor or mode-local history', () => {
    const { model } = setup(); const raw = '\uFEFF---\r\ntitle: 测试\r\n---\r\n#  标题\r\n\r\n原始内容  \r\n\r\n';
    const tab = model.openFile(file('A.md', raw)); const editor = tab.editor;
    for (let i = 0; i < 3; i++) { model.setMode('source'); expect(tab.source!.text()).toBe(raw); model.setMode('document'); expect(tab.editor).toBe(editor); expect(tab.dirty).toBe(false); expect(model.markdown(tab)).toBe(raw); }
    model.setMode('source'); expect(tab.source!.state.facet(EditorState.readOnly)).toBe(false);
    expect(tab.editor!.isEditable).toBe(false);
  });
  it('synchronizes rich edits into source and source edits back into document without writing disk', () => {
    const { model, gateway } = setup(); const tab = model.openFile(file('A.md', '# Title\n\n正文\n'));
    tab.editor!.commands.insertContentAt(tab.editor!.state.doc.content.size - 1, '富文本修改'); const old = tab.editor;
    model.setMode('source'); expect(tab.sourceText).toContain('富文本修改'); insert(model, '\n\n源码编辑'); const source = tab.source;
    model.setMode('document'); expect(old!.isDestroyed).toBe(true); expect(tab.editor!.getText()).toContain('源码编辑'); expect(tab.editor!.can().undo()).toBe(false);
    tab.editor!.commands.insertContentAt(tab.editor!.state.doc.content.size - 1, '再次富文本');
    model.setMode('source'); expect(tab.source).not.toBe(source); expect(tab.sourceText).toContain('再次富文本'); expect(tab.source!.canUndo).toBe(false);
    expect(gateway.saveDocument).not.toHaveBeenCalled();
  });
  it('retains rich history through a no-edit source toggle and read-mode toggles', () => {
    const { model } = setup(); const tab = model.openFile(file('A.md', '# Title\n\n正文'));
    tab.editor!.commands.insertContentAt(tab.editor!.state.doc.content.size - 1, '修改'); const editor = tab.editor;
    model.setMode('source'); model.setMode('document'); model.setReading(true); model.setReading(false);
    expect(tab.editor).toBe(editor); tab.editor!.commands.undo(); expect(model.markdown(tab)).not.toContain('修改'); expect(tab.dirty).toBe(false);
    tab.editor!.commands.redo(); expect(model.markdown(tab)).toContain('修改');
  });
  it('keeps source undo/redo through a document preview and rich undo returns to its source basis', () => {
    const { model } = setup(); const tab = model.openFile(file('A.md', '#  A\n\n正文\n')); model.setMode('source'); insert(model, '源码修改');
    const source = tab.source; model.setMode('document'); tab.editor!.commands.insertContentAt(tab.editor!.state.doc.content.size - 1, '富文本修改');
    tab.editor!.commands.undo(); expect(model.markdown(tab)).toBe('#  A\n\n正文\n源码修改');
    model.setMode('source'); expect(tab.source).toBe(source); tab.source!.undo(); expect(model.markdown(tab)).toBe(tab.raw); expect(tab.dirty).toBe(false);
    tab.source!.redo(); expect(model.markdown(tab)).toContain('源码修改');
  });
  it('preserves source-only formatting and frontmatter edits when document mode has not changed', async () => {
    const { model, gateway } = setup(); const tab = model.openFile(file('A.md', '# A\n\noriginal\n')); model.setMode('source');
    tab.source!.dispatch({ changes: { from: 0, to: tab.source!.state.doc.length, insert: '---\ntitle: new\n---\n#   A\n\noriginal\n\n\n' } });
    const text = tab.sourceText; model.setMode('document'); model.setReading(true); model.setMode('source');
    expect(model.markdown(tab)).toBe(text); expect(tab.dirty).toBe(true); await model.save(tab.id); expect(gateway.saveDocument.mock.calls[0][1]).toBe(text);
  });
  it('retains unsupported Markdown in an editable source session and blocks destructive conversion', async () => {
    const { model, gateway } = setup(); const raw = '# A\n\n脚注[^1]\n\n[^1]: 原样\n'; const tab = model.openFile(file('A.md', raw));
    expect(tab.mode).toBe('source'); expect(tab.editor).toBeNull(); insert(model, '\n保留未知语法');
    expect(model.setMode('document')).toBe(false); expect(model.markdown(tab)).toContain('[^1]: 原样');
    await model.save(tab.id); expect(gateway.saveDocument.mock.calls[0][1]).toBe(raw + '\n保留未知语法');
    tab.source!.dispatch({ changes: { from: 0, to: tab.source!.state.doc.length, insert: '# 可编辑\n\n正常 Markdown\n' } });
    expect(model.setMode('document')).toBe(true); expect(tab.editor!.getText()).toContain('正常 Markdown');
  });
  it('retains source undo and selection when switching tabs and returns exactly to the saved baseline', () => {
    const { model } = setup(); const a = model.openFile(file('a.ts', 'const a = 1;\n')); insert(model, '// change'); a.source!.select(3); a.source!.scrollTop = 80;
    const b = model.openFile(file('b.txt', 'plain\n')); insert(model, 'B'); expect(b.source).not.toBe(a.source);
    model.activate(a.id); expect(a.source!.state.selection.main.head).toBe(3); expect(a.source!.scrollTop).toBe(80);
    a.source!.undo(); expect(model.markdown(a)).toBe(a.raw); expect(a.dirty).toBe(false); expect(model.markdown(b)).toContain('B');
    a.source!.redo(); expect(a.dirty).toBe(true);
  });
  it('saves code literally without parsing Markdown-like text and preserves trailing newlines/BOM/CRLF', async () => {
    const { model, gateway } = setup(); const raw = '\uFEFF// # title\r\nconst html = "<div>**not bold**</div>";\r\n\r\n';
    const tab = model.openFile(file('a.ts', raw)); expect(tab.editor).toBeNull(); expect(tab.kind).toBe('text'); insert(model, '// 中文\n');
    await model.save(tab.id); expect(gateway.saveDocument.mock.calls[0][1]).toBe(raw + '// 中文\r\n');
    expect(gateway.saveDocument.mock.calls[0][5]).toBeUndefined(); expect(tab.dirty).toBe(false);
  });
  it('uses text/code type after Save As extension changes, and remains in source when becoming Markdown', async () => {
    const { model, gateway } = setup(); const tab = model.openFile(file('A.md', '# Title\n')); tab.editor!.commands.insertContentAt(2, '修改');
    gateway.saveDocument.mockResolvedValueOnce(file('copy.ts', '# Title修改\n')); await model.save(tab.id, true);
    expect(tab.kind).toBe('text'); expect(tab.mode).toBe('source'); expect(tab.editor).toBeNull();
    gateway.saveDocument.mockResolvedValueOnce(file('copy.md', tab.raw)); await model.save(tab.id, true); expect(tab.kind).toBe('markdown'); expect(tab.mode).toBe('source');
  });
  it('holds source edits during native saves and protects dirty source on close', async () => {
    const { model, gateway } = setup(); const tab = model.openFile(file('a.json', '{"n":1}')); insert(model, ' ');
    let finish!: (saved: ReturnType<typeof file>) => void; gateway.saveDocument.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const saving = model.save(tab.id); insert(model, 'blocked'); expect(tab.sourceText).not.toContain('blocked');
    finish(file('a.json', tab.sourceText)); await saving; insert(model, 'next');
    model.requestClose([tab.id]); expect(model.closeTarget).toBe(tab); insert(model, 'blocked'); expect(tab.sourceText).not.toContain('blocked'); model.cancelClose();
    expect(tab.source!.state.facet(EditorState.readOnly)).toBe(false);
  });
  it('uses directory reads for ordinary files and deduplicates already opened source files', async () => {
    const { model, gateway } = setup(); model.root = { path: '/notes', name: 'notes', entries: [] };
    const entry = { path: '/notes/a.ts', name: 'a.ts', isDirectory: false, isMarkdown: false, isSymlink: false };
    await model.openTreeFile(entry); insert(model, 'local'); await model.openTreeFile(entry);
    expect(gateway.readWorkspaceDocument).toHaveBeenCalledOnce(); expect(model.tabs).toHaveLength(1); expect(model.active!.sourceText).toContain('local');
  });
  it('restores code and unsupported Markdown source drafts with their mode and literal contents', async () => {
    const { model, make, drafts } = setup(); await model.startReliability(); const a = model.openFile(file('a.ts', 'const a = 1;\n')); insert(model, '// 草稿'); a.source!.select(5); a.source!.scrollTop = 150;
    const b = model.openFile(file('B.md', '[^1]: footnote\n')); insert(model, 'more'); await model.flushDrafts(); expect(drafts()).toHaveLength(2); model.dispose();
    const next = make(); await next.startReliability(); await next.recoverDraft(a.draftId); expect(next.active!.sourceText).toContain('// 草稿'); expect(next.active!.mode).toBe('source');
    expect(next.active!.source!.state.selection.main.head).toBe(5); expect(next.active!.source!.scrollTop).toBe(150); expect(next.active!.kind).toBe('text');
    await next.recoverDraft(b.draftId); expect(next.active!.sourceText).toContain('[^1]: footnote'); expect(next.active!.mode).toBe('source');
  });
  it('reloads clean code, retains dirty source conflicts and replaces source undo only after confirmed reload', async () => {
    const { model, storage } = setup(); await model.startReliability(); const tab = model.openFile(file('a.py', 'print(1)\n')); tab.source!.select(4); tab.source!.scrollTop = 40;
    storage.checkDocuments.mockResolvedValue([{ path: tab.path!, kind: 'present', content: 'print(2)\n' }]); await model.checkDisk();
    expect(tab.sourceText).toBe('print(2)\n'); expect(tab.dirty).toBe(false); expect(tab.source!.scrollTop).toBe(40); expect(tab.source!.state.selection.main.head).toBe(4);
    insert(model, '# local'); const source = tab.source; storage.checkDocuments.mockResolvedValue([{ path: tab.path!, kind: 'present', content: 'print(3)\n' }]); await model.checkDisk();
    expect(tab.source).toBe(source); expect(tab.sourceText).toContain('local'); expect(tab.external?.content).toBe('print(3)\n');
    await model.reloadDisk(tab.id); expect(tab.sourceText).toBe('print(3)\n'); expect(tab.source!.canUndo).toBe(false); expect(tab.dirty).toBe(false);
  });
});

describe('source-mode Save As resource rewriting', () => {
  it('rewrites only Markdown URLs and reference destinations, keeping raw syntax, frontmatter, code and footnotes', () => {
    const input = '---\ntitle: "[label](meta.md)"\n---\n\n#  Heading\n\n![图](assets/a%20b.png) [other](../B.md#h)\n\n[ref]: <assets/c.png> "title"\n\n[^n]: keep text\n\n`[code](keep.md)`\n\n```md\n[x](code.md)\n```\n\n<div>[html](keep.md)</div>\n';
    const output = rebaseSourceContent(input, '/notes/A.md', '/other/B.md');
    expect(output).toContain('![图](../notes/assets/a%20b.png)'); expect(output).toContain('[ref]: <../notes/assets/c.png> "title"');
    expect(output).toContain('title: "[label](meta.md)"'); expect(output).toContain('`[code](keep.md)`'); expect(output).toContain('[x](code.md)'); expect(output).toContain('[^n]: keep text'); expect(output).toContain('<div>[html](keep.md)</div>');
    expect(sourceReferenceTokens(input).references).toHaveLength(3);
  });
  it('updates source to the saved reference paths and does not normalize other source bytes', async () => {
    const { model, gateway } = setup(); const raw = '#   A\n\n![图](assets/a.png)\n\n\n'; const tab = model.openFile(file('A.md', raw)); model.setMode('source');
    await model.save(tab.id, true); expect(gateway.saveDocument.mock.calls[0][5]?.references[0].value).toBe('assets/a.png');
    expect(tab.sourceText).toBe('#   A\n\n![图](../notes/assets/a.png)\n\n\n'); expect(tab.source!.text()).toBe(tab.raw); expect(tab.dirty).toBe(false);
  });
});


describe('raw reading fidelity and source ownership', () => {
  it('allows every protected extension in reading, refuses rich editing and keeps bytes across clean save/close', async () => {
    const { model, gateway } = setup();
    const raw = '\uFEFF---\r\ntitle: 原文\r\n---\r\n# 标题\r\n\r\n脚注[^1]\r\n\r\n[^1]: 内容\r\n\r\n$$x^2$$\r\n\r\n> [!NOTE]\r\n> 提示\r\n\r\n[[其他]]\r\n\r\n::: custom\r\n内容\r\n:::\r\n\r\n<!-- 保留 -->\r\n\r\n';
    const tab = model.openFile(file('mixed.md', raw));
    expect(tab.mode).toBe('source'); expect(model.selectMode('reading')).toBe(true);
    expect(tab.mode).toBe('document'); expect(tab.reading).toBe(true); expect(tab.editor).toBeNull();
    expect(model.markdown(tab)).toBe(raw); expect(tab.dirty).toBe(false);
    expect(model.selectMode('document')).toBe(false); expect(tab.reading).toBe(true);
    model.selectMode('source'); model.selectMode('reading');
    await model.save(tab.id); expect(gateway.saveDocument).not.toHaveBeenCalled(); expect(model.markdown(tab)).toBe(raw);
    model.requestClose([tab.id]); expect(model.closeTarget).toBeNull();
    useSettings.setState({markdownMode:'document'});
  });
  it('synchronizes source changes after repeated reading transitions without reviving a stale rich editor', async () => {
    const {model, gateway} = setup(); const tab = model.openFile(file('a.md','# 原标题\n\n正文\n'));
    model.selectMode('source'); insert(model, '\n新增内容');
    const edited = model.markdown(tab);
    model.selectMode('reading'); expect(model.markdown(tab)).toBe(edited);
    model.selectMode('source'); model.selectMode('reading'); model.selectMode('document');
    expect(tab.editor!.getText()).toContain('新增内容'); expect(model.markdown(tab)).toBe(edited);
    await model.save(tab.id); expect(gateway.saveDocument.mock.calls[0][1]).toBe(edited);
    useSettings.setState({markdownMode:'document'});
  });
  it('opens new protected files directly in the persisted reading preference and retains dirty source edits', async () => {
    const {model, make, gateway} = setup(); useSettings.setState({markdownMode:'reading'});
    const tab = model.openFile(file('notes.md','文字[^1]\n\n[^1]: 注释\n'));
    expect(tab.reading).toBe(true); expect(tab.mode).toBe('document'); expect(tab.source).toBeTruthy();
    model.selectMode('source'); insert(model,'\n源码补充\n'); const text = model.markdown(tab);
    model.selectMode('reading'); expect(tab.dirty).toBe(true);
    await model.save(tab.id); expect(gateway.saveDocument.mock.calls[0][1]).toBe(text);
    const reopened = make().openFile(file('notes.md', text)); expect(reopened.reading).toBe(true); expect(reopened.raw).toBe(text);
    useSettings.setState({markdownMode:'document'});
  });
  it('does not misclassify inline examples as HTML when entering document mode', () => {
    const {model} = setup(); const raw = '路径为 `build/<version>/`，示例 `[^1]`。\n';
    const tab = model.openFile(file('examples.md',raw)); expect(tab.unsupported).toBeNull();
    model.selectMode('reading'); expect(model.selectMode('document')).toBe(true); expect(model.markdown(tab)).toBe(raw);
    useSettings.setState({markdownMode:'document'});
  });
});

it('rebases wiki links on Save As without rewriting examples or aliases', () => {
  const raw = '[[child#章节|别名]]\n\n![[assets/a b.png]]\n\n`[[example]]`\n\n```md\n[[literal]]\n```\n';
  const output = rebaseSourceContent(raw, '/notes/a.md', '/other/b.md');
  expect(output).toContain('[[../notes/child.md#章节|别名]]');
  expect(output).toContain('![[../notes/assets/a%20b.png]]');
  expect(output).toContain('`[[example]]`'); expect(output).toContain('[[literal]]');
});

it('preserves exact raw formatting when saving a clean reading document as another file', async () => {
  const {model,gateway} = setup(); const raw = '\uFEFF# Heading\r\n\r\n*one*  and   **two**\r\n\r\n\r\n';
  const tab = model.openFile(file('format.md',raw)); model.selectMode('reading');
  await model.save(tab.id,true); expect(gateway.saveDocument.mock.calls[0][1]).toBe(raw);
  expect(model.markdown(tab)).toBe(raw); expect(tab.dirty).toBe(false);
  useSettings.setState({markdownMode:'document'});
});

it('retains rich undo history through reading then a no-edit source round trip', () => {
  const {model} = setup(); const tab = model.openFile(file('undo.md','# 标题\n\n原文\n'));
  tab.editor!.commands.insertContentAt(tab.editor!.state.doc.content.size - 1,'新增'); const editor = tab.editor;
  model.selectMode('reading'); model.selectMode('source'); model.selectMode('reading'); model.selectMode('document');
  expect(tab.editor).toBe(editor); tab.editor!.commands.undo(); expect(model.markdown(tab)).toBe(tab.raw); expect(tab.dirty).toBe(false);
  useSettings.setState({markdownMode:'document'});
});
it('recovers source-owned drafts saved while reading without stale rich content', async () => {
  const {model,make,drafts} = setup(); await model.startReliability();
  const tab = model.openFile(file('draft.md','#  标题\n\n原文\n')); model.selectMode('source'); insert(model,'\n未保存源码');
  const content = model.markdown(tab); model.selectMode('reading'); await model.flushDrafts(); expect(drafts()[0].document).toBeNull(); model.dispose();
  const restored = make(); await restored.startReliability(); await restored.recoverDraft(tab.draftId);
  expect(restored.active!.reading).toBe(true); expect(restored.markdown(restored.active!)).toBe(content);
  restored.selectMode('document'); expect(restored.active!.editor!.getText()).toContain('未保存源码');
  useSettings.setState({markdownMode:'document'});
});
