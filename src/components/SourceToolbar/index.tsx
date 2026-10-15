import { IconArrowBackUp, IconArrowForwardUp, IconSearch } from 'paper-ink/icons';
import { languages } from '@codemirror/language-data';
import { languageDescription } from '@/components/SourceEditor/session';
import type { WorkspaceModel } from '@/workspace/model';
const choices = ['Plain Text', 'Markdown', 'JavaScript', 'JSX', 'TypeScript', 'TSX', 'JSON', 'HTML', 'CSS', 'Rust', 'Python', 'Shell', 'YAML', 'SQL'].filter(name => name === 'Plain Text' || languages.some(language => language.name === name));
export default function SourceToolbar({ workspace }: { workspace: WorkspaceModel }) {
  const tab = workspace.active; const source = tab?.source;
  if (!tab || !source || tab.mode !== 'source') return null;
  const disabled = workspace.busy || !!workspace.closing || tab.guide;
  const automaticLanguage = languageDescription(tab.kind === 'markdown' ? 'document.md' : tab.name.replace(/ · 恢复副本$/, ''))?.name ?? 'Plain Text';
  return <div className="formatbar source-toolbar" role="toolbar" aria-label="源码工具栏">
    <button className="format-button" aria-label="撤销源码" title="撤销 · ⌘/Ctrl Z" disabled={disabled || !source.canUndo} onMouseDown={e => e.preventDefault()} onClick={() => { source.undo(); source.focus(); }}><IconArrowBackUp size={17} stroke={1.65} /></button>
    <button className="format-button" aria-label="重做源码" title="重做" disabled={disabled || !source.canRedo} onMouseDown={e => e.preventDefault()} onClick={() => { source.redo(); source.focus(); }}><IconArrowForwardUp size={17} stroke={1.65} /></button>
    <span className="tool-divider" />
    <select aria-label="语法语言" title="按文件名识别，或选择高亮语言" value={tab.languageOverride ?? ''} disabled={workspace.busy} onChange={e => workspace.setSourceLanguage(e.target.value)}><option value="">自动 · {automaticLanguage === 'Plain Text' ? '纯文本' : automaticLanguage}</option>{choices.map(name => <option key={name} value={name}>{name === 'Plain Text' ? '纯文本' : name}</option>)}</select>
    <span className="tool-divider" />
    <button className="quiet-button" aria-label="查找和替换" title="查找 / 替换 · ⌘/Ctrl F" onMouseDown={e => e.preventDefault()} onClick={() => source.search()}><IconSearch size={15} stroke={1.65} />查找</button>
    <label className="source-wrap"><input type="checkbox" checked={tab.wrap} onChange={e => workspace.setSourceWrap(e.target.checked)} />自动换行</label>
    <span className="toolbar-note">{source.languageError || (tab.guide ? '内置指南 · 只读源码' : tab.kind === 'markdown' ? 'Markdown 源码' : '文本与代码')}</span>
  </div>;
}
