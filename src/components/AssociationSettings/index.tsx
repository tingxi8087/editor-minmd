import { useEffect, useRef, useState } from 'react';
import { Button, Modal } from 'paper-ink';
import { associationExtensions, associationGroups, associations, type AssociationGateway, type AssociationResult } from '@/lib/associations';
import styles from './index.module.less';
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
export default function AssociationSettings({ onClose, onBusyChange, gateway = associations }: { onClose: () => void; onBusyChange?: (busy: boolean) => void; gateway?: AssociationGateway }) {
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
  return <Modal open getContainer={false} title="默认打开方式" width={480} maskClosable={false} keyboard={!busy} closable={!busy} onCancel={() => { if (!busy) onClose(); }} footer={<div className={styles.footer}><span>已选择 {selected.length} 种扩展名</span><Button size="small" disabled={busy} onClick={onClose}>关闭</Button><Button size="small" type="primary" disabled={disabled || !selected.length} onClick={() => void apply()}>{busy ? '正在设置…' : '设为默认打开应用'}</Button></div>}>
    <div className={styles.content}>
      <p>在访达中双击所选类型的文件，使用 MinMD 打开。</p>
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
    </div>
  </Modal>;
}
