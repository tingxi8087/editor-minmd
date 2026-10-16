import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { closeHistory } from '@tiptap/pm/history';
import type { Editor } from '@tiptap/core';

export type SearchMatch = { from: number; to: number };
export type SearchState = { query: string; caseSensitive: boolean; matches: SearchMatch[]; current: number };
type SearchMeta = Partial<Pick<SearchState, 'query' | 'caseSensitive' | 'current'>>;
export const searchKey = new PluginKey<SearchState>('documentSearch');
const empty: SearchState = { query: '', caseSensitive: false, matches: [], current: -1 };

/** Adjacent text nodes share a run even when inline marks differ. Atoms and blocks separate runs. */
export function findMatches(doc: ProseMirrorNode, query: string, caseSensitive = false): SearchMatch[] {
  if (!query) return [];
  const result: SearchMatch[] = [];
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(escaped, caseSensitive ? 'gu' : 'giu');
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    let text = ''; let start = pos + 1;
    const flush = () => {
      pattern.lastIndex = 0;
      for (let match = pattern.exec(text); match; match = pattern.exec(text)) result.push({ from: start + match.index, to: start + match.index + match[0].length });
      text = '';
    };
    node.forEach((child, offset) => {
      if (child.isText) { if (!text) start = pos + 1 + offset; text += child.text; }
      else flush();
    });
    flush(); return false;
  });
  return result;
}

export const DocumentSearchExtension = Extension.create({
  name: 'documentSearch',
  addProseMirrorPlugins() {
    return [new Plugin<SearchState>({
      key: searchKey,
      state: {
        init: () => ({ ...empty, matches: [] }),
        apply(tr, old) {
          const meta = tr.getMeta(searchKey) as SearchMeta | undefined;
          if (!tr.docChanged && !meta) return old;
          const next = { ...old, ...meta };
          next.matches = tr.docChanged || next.query !== old.query || next.caseSensitive !== old.caseSensitive
            ? findMatches(tr.doc, next.query, next.caseSensitive) : old.matches;
          if (meta?.query !== undefined || meta?.caseSensitive !== undefined) next.current = next.matches.length ? 0 : -1;
          else if (tr.docChanged && meta?.current === undefined && old.current >= 0) {
            const mapped = tr.mapping.map(old.matches[old.current]?.from ?? 0);
            const index = next.matches.findIndex(match => match.from >= mapped);
            next.current = index < 0 ? (next.matches.length ? 0 : -1) : index;
          }
          next.current = next.matches.length ? Math.max(0, Math.min(next.current, next.matches.length - 1)) : -1;
          return next;
        },
      },
      props: {
        decorations(state) {
          const search = searchKey.getState(state);
          return DecorationSet.create(state.doc, search?.matches.map((match, index) => Decoration.inline(match.from, match.to, {
            class: index === search.current ? 'document-search-match document-search-current' : 'document-search-match',
          })) ?? []);
        },
      },
    })];
  },
});

export function setSearch(editor: Editor, meta: SearchMeta) {
  if (editor.isDestroyed || !searchKey.getState(editor.state)) return;
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, meta).setMeta('addToHistory', false));
}

export function revealMatch(editor: Editor, index: number) {
  const search = searchKey.getState(editor.state); const match = search?.matches[index];
  if (!search || !match || editor.isDestroyed) return;
  // Reveal a diagram's real source before scrolling; never serialize this UI state.
  const point = editor.view.domAtPos(match.from);
  const element = point.node instanceof Element ? point.node : point.node.parentElement;
  element?.closest('.rich-code-block')?.dispatchEvent(new Event('document-search-reveal'));
  const tr = editor.state.tr.setMeta(searchKey, { current: index }).setMeta('addToHistory', false);
  tr.setSelection(TextSelection.create(tr.doc, match.from, match.to));
  editor.view.dispatch(tr.scrollIntoView());
}

export function replaceMatches(editor: Editor, replacement: string, all = false): boolean {
  if (!editor.isEditable || editor.isDestroyed) return false;
  const search = searchKey.getState(editor.state);
  if (!search?.matches.length) return false;
  const matches = all ? search.matches : [search.matches[search.current]];
  if (!matches[0]) return false;
  const tr = editor.state.tr;
  closeHistory(tr);
  for (const match of [...matches].reverse()) {
    const marks = tr.doc.resolve(match.from).nodeAfter?.marks ?? tr.doc.resolve(match.from).marks();
    if (replacement) tr.replaceWith(match.from, match.to, editor.schema.text(replacement, marks));
    else tr.delete(match.from, match.to);
  }
  editor.view.dispatch(tr);
  // Keep following edits in their own undo group as well.
  editor.view.dispatch(closeHistory(editor.state.tr).setMeta('addToHistory', false));
  return true;
}
