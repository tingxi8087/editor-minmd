import { useEffect, useRef, useState } from 'react';
import { Button, Modal, Tabs } from 'paper-ink';
import { associationExtensions, associationGroups, associations, type AssociationGateway, type AssociationResult } from '@/lib/associations';
import styles from './index.module.less';
import { name, version, license } from '../../../package.json';
const storageKey = 'minmd-file-associations-v1';
function loadSelection() {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (Array.isArray(stored) && stored.every(value => typeof value === 'string')) return associationExtensions.filter(ext => stored.includes(ext));
  } catch { /* Use the initial selection when storage is unavailable. */ }
  return [...associationExtensions];
}
function GroupCheckbox({ name, count, total, disabled, onChange }: { name: string; count: number; total: number; disabled: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = count > 0 && count < total; }, [count, total]);
  return <label><input ref={ref} type="checkbox" checked={count === total} aria-checked={count > 0 && count < total ? 'mixed' : count === total} disabled={disabled} onChange={onChange} />{name}<small>{count}/{total}</small></label>;
}
const shortcutGroups = [
  { title: '文件与工作台', rows: [
    ['新建 Markdown', '⌘ / Ctrl + N'], ['新建文本', '⌘ / Ctrl + Shift + N'],
    ['打开文件', '⌘ / Ctrl + O'], ['打开目录', '⌘ / Ctrl + Shift + O'],
    ['保存', '⌘ / Ctrl + S'], ['另存为', '⌘ / Ctrl + Shift + S'],
    ['关闭当前标签', '⌘ / Ctrl + W'], ['下一个 / 上一个标签', '⌘ / Ctrl + Tab / Shift + Tab'],
    ['收起 / 展开文件与大纲', '⌘ / Ctrl + B'],
    ['关闭窗口（桌面）', '⌘ / Ctrl + Shift + W'], ['退出应用（桌面）', '⌘ / Ctrl + Q'], ['打开设置（桌面）', '⌘ / Ctrl + ,'],
  ] },
  { title: '模式与查找', rows: [
    ['文档模式', '⌘ / Ctrl + 1'], ['阅读模式', '⌘ / Ctrl + 2'], ['源码模式', '⌘ / Ctrl + 3'],
    ['查找（文档、阅读、源码）', '⌘ / Ctrl + F'], ['下一处 / 上一处匹配（查找框内）', 'Enter / Shift + Enter'], ['关闭查找', 'Esc'],
  ] },
  { title: '编辑内容', rows: [
    ['撤销 / 重做', '⌘ / Ctrl + Z / Shift + Z'], ['剪切 / 复制 / 粘贴', '⌘ / Ctrl + X / C / V'], ['全选', '⌘ / Ctrl + A'],
    ['斜体（文档）', '⌘ / Ctrl + I'], ['插入 / 编辑链接（文档）', '⌘ / Ctrl + K'], ['退出代码块（文档）', '⌘ / Ctrl + Enter'],
    ['下一个 / 上一个单元格（文档）', 'Tab / Shift + Tab'],
  ] },
  { title: '插入菜单', rows: [
    ['打开插入菜单（文档）', '/'], ['选择上一项 / 下一项', '↑ / ↓'], ['插入所选内容', 'Enter'], ['关闭插入菜单', 'Esc'],
  ] },
];
function ShortcutList() {
  return <div className={styles.shortcuts}>
    <p>macOS 使用 ⌘，其他平台使用 Ctrl。文件操作请在桌面应用中使用，浏览器预览可能保留部分系统快捷键。</p>
    {shortcutGroups.map(group => <section key={group.title} aria-label={group.title}>
      <h3>{group.title}</h3>
      <table><thead className={styles.srOnly}><tr><th>操作</th><th>快捷键</th></tr></thead><tbody>{group.rows.map(([action, keys]) => <tr key={action}><th scope="row">{action}</th><td><kbd>{keys}</kbd></td></tr>)}</tbody></table>
    </section>)}
    <p className={styles.shortcutNote}>阅读模式仅支持查找；替换请切回文档或源码模式。⌘ / Ctrl + B 用于侧栏，粗体与删除线可使用文档工具栏。</p>
  </div>;
}
export default function Settings({ onClose, onBusyChange, gateway = associations }: { onClose: () => void; onBusyChange?: (busy: boolean) => void; gateway?: AssociationGateway }) {
  const [tab, setTab] = useState('associations');
  const [selected, setSelected] = useState(loadSelection);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<AssociationResult[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { let disposed = false; gateway.supported().then(value => { if (!disposed) setSupported(value); }).catch(e => { if (!disposed) { setSupported(false); setError(String(e)); } }); return () => { disposed = true; }; }, [gateway]);
  const change = (next: string[]) => {
    setSelected(next); setResults([]); setError('');
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { setError('勾选项暂时无法保存到本机，仍可执行本次设置。'); }
  };
  const apply = async () => {
    setBusy(true); onBusyChange?.(true); setError(''); setResults([]);
    try { setResults(await gateway.apply(selected)); } catch (e) { setError(String(e)); } finally { setBusy(false); onBusyChange?.(false); }
  };
  const disabled = busy || supported !== true;
  return <Modal open getContainer={false} title="设置" width={480} maskClosable={false} keyboard={!busy} closable={!busy} onCancel={() => { if (!busy) onClose(); }} footer={<div className={styles.footer}>{tab === 'associations' && <span>已选择 {selected.length} 种扩展名</span>}<Button size="small" disabled={busy} onClick={onClose}>关闭</Button>{tab === 'associations' && <Button size="small" type="primary" disabled={disabled || !selected.length} onClick={() => void apply()}>{busy ? '正在设置…' : '设为默认打开应用'}</Button>}</div>}>
    <Tabs size="small" activeKey={tab} onChange={setTab} items={[
      { key: 'associations', label: '默认打开方式', disabled: busy, children: <div className={styles.content}>
      <p>在访达中双击所选类型的文件，使用 editor-minmd 打开。</p>
      <div className={styles.actions}><Button size="small" type="text" disabled={disabled} onClick={() => change([...associationExtensions])}>全选</Button><Button size="small" type="text" disabled={disabled} onClick={() => change([])}>取消全选</Button></div>
      {associationGroups.map(group => {
        const count = group.extensions.filter(ext => selected.includes(ext)).length;
        return <div className={styles.group} key={group.name}>
          <GroupCheckbox name={group.name} count={count} total={group.extensions.length} disabled={disabled} onChange={() => change(count === group.extensions.length ? selected.filter(ext => !group.extensions.includes(ext)) : [...new Set([...selected, ...group.extensions])])} />
          <details open={group.name === 'Markdown'}><summary>选择具体扩展名</summary><div className={styles.extensions}>{group.extensions.map(ext => <label key={ext}><input type="checkbox" checked={selected.includes(ext)} disabled={disabled} onChange={() => change(selected.includes(ext) ? selected.filter(item => item !== ext) : [...selected, ext])} />.{ext}</label>)}</div></details>
        </div>;
      })}
      <p className={styles.hint}>修改系统默认打开方式；取消勾选不会恢复旧关联。macOS 按文件类型设置，属于同一类型的其他扩展名也可能一起变化。</p>
      {supported === false && <p role="status">目前仅支持 macOS 桌面应用。</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {!!results.length && <div className={styles.results} role="status"><strong>{results.filter(row => row.success).length}/{results.length} 项已设为默认</strong>{results.map(row => <p key={row.extension} className={row.success ? undefined : styles.error}><code>.{row.extension}</code><span>{row.message}</span></p>)}</div>}
    </div> },
      { key: 'shortcuts', label: '快捷键', disabled: busy, children: <ShortcutList /> },
      { key: 'about', label: '关于', disabled: busy, children: <div className={styles.about}>
        <h3>{name}</h3>
        <p>专注 Markdown 的本地文本编辑器。</p>
        <dl><div><dt>版本</dt><dd>{version}</dd></div><div><dt>开源许可</dt><dd>{license}</dd></div></dl>
        <p>支持所见即所得编辑、阅读、源码编辑，以及普通文本与代码查看。文档保存在本地。</p>
        <small>© 2026 tingxi8087</small>
      </div> },
    ]} />
  </Modal>;
}
