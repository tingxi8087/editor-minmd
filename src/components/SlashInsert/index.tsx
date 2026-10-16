import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button, Input, Modal } from 'paper-ink';
import type { JSONContent } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { files } from '@/lib/files';
import { rebaseReference, validLink } from '@/lib/resources';
import type { WorkspaceModel } from '@/workspace/model';
import styles from './index.module.less';
import { emojiGroups, emojiNames } from './emoji';

export interface SlashInsertRequest { id: string; kind: 'emoji' | 'date' | 'reference' | 'link'; from: number; to: number }
const extraKeywords: Record<string, string> = {
  '😀': '开心 笑脸 kaixin smile', '😊': '微笑 weixiao', '😂': '大笑 笑哭 daxiao', '🤔': '思考 sikao',
  '😎': '酷 墨镜 ku', '🥳': '庆祝 qingzhu', '😭': '哭 难过 ku', '❤️': '爱 心 aixin',
  '👍': '赞 棒 zan', '👏': '鼓掌 guzhang', '🙏': '感谢 拜托 ganxie', '🎉': '庆祝 彩带 qingzhu',
  '✨': '闪光 shanguang', '🔥': '火 热门 huo', '✅': '完成 对勾 wancheng', '❌': '错误 删除 cuowu',
  '⚠️': '警告 注意 jinggao', '💡': '灵感 灯泡 linggan', '📝': '笔记 写作 biji', '📚': '书 学习 shu',
  '📌': '图钉 固定 guding', '🚀': '火箭 启动 huojian', '🌱': '成长 植物 chengzhang', '☕': '咖啡 kafei',
};
const allEmoji = emojiGroups.flatMap(group => group.items);
function emojiLabel(emoji: string) { return (extraKeywords[emoji] || emojiNames[emoji] || emoji).split(' ')[0]; }
function matchingEmoji(query: string, category: string) {
  const normalized = query.trim().toLowerCase();
  return emojiGroups.filter(group => normalized || group.name === category).flatMap(group => group.items.filter(emoji => !normalized || `${emoji} ${emojiNames[emoji] || ''} ${extraKeywords[emoji] || ''} ${group.name} ${group.keywords}`.toLowerCase().includes(normalized)));
}
const recentKey = 'minmd.recent-emoji';
function readRecent(): string[] { try { const values: unknown = JSON.parse(localStorage.getItem(recentKey) || '[]'); return Array.isArray(values) ? values.filter((item): item is string => typeof item === 'string' && allEmoji.includes(item)).slice(0, 8) : []; } catch { return []; } }
function localDate() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
function validDate(value: string) { const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value); if (!match || Number(match[1]) < 1) return false; const date = new Date(`${value}T12:00:00`); return !Number.isNaN(date.valueOf()) && date.getFullYear() === Number(match[1]) && date.getMonth() + 1 === Number(match[2]) && date.getDate() === Number(match[3]); }

export default function SlashInsert({ workspace, request, onClose }: { workspace: WorkspaceModel; request: SlashInsertRequest | null; onClose: () => void }) {
  // Key by the exact request, so fields and async chooser results never leak into another insertion.
  return request ? <InsertDialog key={`${request.id}:${request.kind}:${request.from}:${request.to}`} workspace={workspace} request={request} onClose={onClose} /> : null;
}
function InsertDialog({ workspace, request, onClose }: { workspace: WorkspaceModel; request: SlashInsertRequest; onClose: () => void }) {
  useSyncExternalStore(workspace.subscribe, workspace.snapshot);
  const originalTab = useRef(workspace.tabs.find(tab => tab.id === request.id)).current;
  const editor = originalTab?.editor;
  const initialDocument = useRef(editor?.state.doc).current;
  const alive = useRef(true);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('表情');
  const [value, setValue] = useState(request.kind === 'date' ? localDate() : '');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [choosing, setChoosing] = useState(false);
  const [selectedFile, setSelectedFile] = useState('');
  const [recent] = useState(readRecent);
  const eligible = () => !!editor && !editor.isDestroyed && editor.isEditable && workspace.activeId === request.id && workspace.tabs.includes(originalTab!) && originalTab?.editor === editor && originalTab.mode === 'document' && !workspace.busy && !workspace.closing && editor.state.doc === initialDocument;
  const close = () => { alive.current = false; if (eligible()) editor!.chain().focus().setTextSelection({ from: request.from, to: request.to }).run(); onClose(); };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (!eligible()) { alive.current = false; onClose(); } });
  const insert = (content: JSONContent | string, emoji?: string) => {
    if (!eligible() || choosing || !alive.current) return;
    const applied = editor!.chain().focus().command(({ tr }) => { closeHistory(tr); return true; }).deleteRange({ from: request.from, to: request.to }).insertContent(content).run();
    if (!applied) { setError('插入失败，请重试'); return; }
    if (emoji) { try { localStorage.setItem(recentKey, JSON.stringify([emoji, ...recent.filter(item => item !== emoji)].slice(0, 8))); } catch { /* Storage being unavailable must not prevent insertion. */ } }
    alive.current = false; onClose();
  };
  const apply = () => {
    if (request.kind === 'date') { if (!validDate(value)) { setError('请选择有效日期'); return; } insert({ type: 'text', text: value }); return; }
    const input = value.trim();
    const href = request.kind === 'link' && originalTab?.path && originalTab.resourceBase ? rebaseReference(input, originalTab.path, originalTab.resourceBase) : input;
    if (!validLink(href)) { setError('请输入网页地址、相对文件路径或 #标题锚点'); return; }
    insert({ type: 'text', text: text.trim() || selectedFile || input, marks: [{ type: 'link', attrs: { href } }] });
  };
  const choose = async () => {
    if (!eligible() || choosing || !originalTab?.resourceBase) { setError('请先保存当前文档，再引用本地 Markdown 文件'); return; }
    setChoosing(true); setError('');
    try {
      const chosen = await files.chooseMarkdownReference(originalTab.resourceBase);
      if (!alive.current || !eligible()) return;
      if (chosen) { setValue(chosen.reference); setSelectedFile(chosen.name); setText(chosen.name.replace(/\.(?:md|markdown)$/i, '')); }
    } catch (cause) { if (alive.current && eligible()) setError(String(cause)); }
    finally { if (alive.current) setChoosing(false); }
  };
  const title = { emoji: '插入表情', date: '插入日期', reference: '引用本地文档', link: '插入链接' }[request.kind];
  const visibleEmoji = matchingEmoji(query, category);
  return <Modal className={styles.dialog} open title={title} width={380} maskClosable={false} getContainer={false} onCancel={close} footer={request.kind === 'emoji' ? null : <div className={styles.actions}><Button onClick={close}>取消</Button><Button type="primary" disabled={choosing || !eligible() || (request.kind === 'reference' && !value)} onClick={apply}>插入</Button></div>}>
    <div className={styles.fields} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && request.kind !== 'emoji') { event.preventDefault(); apply(); } }}>
      {request.kind === 'emoji' ? <>
        <Input autoFocus aria-label="搜索表情" placeholder="搜索表情，如：开心、赞、灵感" value={query} onChange={event => setQuery(event.target.value)} />
        {!query && recent.length > 0 && <><span className={styles.caption}>最近使用</span><div className={styles.emoji}>{recent.map(emoji => <button key={emoji} aria-label={`最近使用 ${emoji}`} onClick={() => insert({ type: 'text', text: emoji }, emoji)}>{emoji}</button>)}</div></>}
        <div className={styles.categories} role="group" aria-label="表情分类">{emojiGroups.map(group => <button key={group.name} aria-label={`${group.name}分类`} aria-pressed={category === group.name && !query.trim()} onClick={() => { setCategory(group.name); setQuery(''); }}>{group.name}</button>)}</div>
        <div className={styles.emojiPanel}><div className={styles.emoji} aria-label="表情列表">{visibleEmoji.map(emoji => <button key={emoji} title={emojiNames[emoji] || emojiLabel(emoji)} aria-label={`${emojiLabel(emoji)} ${emoji}`} onClick={() => insert({ type: 'text', text: emoji }, emoji)}>{emoji}</button>)}</div>
        {visibleEmoji.length === 0 && <p>没有匹配的表情</p>}</div>
      </> : request.kind === 'date' ? <label>日期<input className={styles.date} type="date" aria-label="日期" autoFocus value={value} onChange={event => { setValue(event.target.value); setError(''); }} /><span className={styles.caption}>插入普通文本，格式为 YYYY-MM-DD。</span></label> : <>
        {request.kind === 'reference' ? <><Button disabled={choosing || !originalTab?.resourceBase} onClick={() => void choose()}>{choosing ? '选择中…' : '选择本地 Markdown'}</Button><p>{!originalTab?.resourceBase ? '请先保存当前文档，再引用本地 Markdown 文件。' : selectedFile || '选择文档后，将插入普通相对路径链接。'}</p></> : null}
        <label>显示文字<Input autoFocus={request.kind === 'link'} aria-label="链接显示文字" value={text} onChange={event => setText(event.target.value)} placeholder="留空则显示地址" /></label>
        {request.kind === 'link' && <label>链接地址<Input aria-label="插入链接地址" value={value} onChange={event => { setValue(event.target.value); setError(''); }} placeholder="https://… 或 ../笔记.md#标题" /></label>}
        {request.kind === 'reference' && value && <p className={styles.reference}>{value}</p>}
      </>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  </Modal>;
}
