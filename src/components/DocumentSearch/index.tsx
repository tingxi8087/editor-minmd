import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { revealMatch, replaceMatches, searchKey, setSearch, type SearchState } from './extension';
import styles from './index.module.less';

export default function DocumentSearch({ editor, readOnly = false, openRequest = 0, onClose }: {
  editor: Editor | null; readOnly?: boolean; openRequest?: number; onClose: () => void;
}) {
  const [query, setQuery] = useState(() => {
    if (!editor || editor.isDestroyed || editor.state.selection.empty) return '';
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, '\n', '\ufffc');
    return text.length <= 200 && !/[\n\ufffc]/.test(text) ? text : '';
  });
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [result, setResult] = useState<SearchState | undefined>();
  const input = useRef<HTMLInputElement>(null);
  const editable = Boolean(editor?.isEditable && !readOnly);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const update = () => setResult(searchKey.getState(editor.state));
    editor.on('transaction', update); update();
    return () => { editor.off('transaction', update); if (!editor.isDestroyed) setSearch(editor, { query: '' }); };
  }, [editor]);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    setSearch(editor, { query, caseSensitive });
    const search = searchKey.getState(editor.state);
    if (search?.matches.length) revealMatch(editor, 0);
  }, [editor, query, caseSensitive]);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, [editor, openRequest]);
  useEffect(() => { if (!editable) setReplaceOpen(false); }, [editable]);

  const navigate = (direction: number) => {
    if (!editor || !result?.matches.length) return;
    revealMatch(editor, (result.current + direction + result.matches.length) % result.matches.length);
  };
  const close = () => { if (editor && !editor.isDestroyed) { setSearch(editor, { query: '' }); editor.view.focus(); } onClose(); };
  const replace = (all: boolean) => {
    if (!editor || !editable) return;
    const replaced = replaceMatches(editor, replacement, all);
    const next = searchKey.getState(editor.state);
    if (next?.matches.length) revealMatch(editor, next.current);
    if (replaced) editor.view.focus();
  };
  return <section className={styles.search} aria-label="文档查找" onKeyDown={event => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      event.preventDefault(); event.stopPropagation();
      if (event.target.name === 'replacement') replace(false);
      else navigate(event.shiftKey ? -1 : 1);
    }
  }}>
    <div className={styles.row}>
      {editable && <button type="button" aria-label={replaceOpen ? '收起替换' : '展开替换'} aria-expanded={replaceOpen} onClick={() => setReplaceOpen(value => !value)}>{replaceOpen ? '▾' : '▸'}</button>}
      <input ref={input} aria-label="查找内容" placeholder="查找内容" value={query} onChange={event => setQuery(event.target.value)} />
      <span className={styles.count} role="status" aria-live="polite">{query ? `${result?.matches.length ? (result.current + 1) : 0} / ${result?.matches.length ?? 0}` : '查找'}</span>
      <button type="button" title="区分大小写" aria-label="区分大小写" aria-pressed={caseSensitive} onClick={() => setCaseSensitive(value => !value)}>Aa</button>
      <button type="button" aria-label="上一处" title="上一处（Shift+Enter）" disabled={!result?.matches.length} onClick={() => navigate(-1)}>↑</button>
      <button type="button" aria-label="下一处" title="下一处（Enter）" disabled={!result?.matches.length} onClick={() => navigate(1)}>↓</button>
      <button type="button" aria-label="关闭查找" title="关闭（Esc）" onClick={close}>×</button>
    </div>
    {editable && replaceOpen && <div className={styles.row}>
      <input name="replacement" aria-label="替换内容" placeholder="替换为（留空删除）" value={replacement} onChange={event => setReplacement(event.target.value)} />
      <button type="button" disabled={!result?.matches.length} onClick={() => replace(false)}>替换</button>
      <button type="button" disabled={!result?.matches.length} onClick={() => replace(true)}>全部替换</button>
    </div>}
  </section>;
}
