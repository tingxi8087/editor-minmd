import { useEffect, useRef } from 'react';
import { IconFile, IconFolder, IconX } from 'paper-ink/icons';
import type { RecentEntry } from '@/lib/recents';
import styles from './index.module.less';

export interface RecentEntriesProps {
  files: RecentEntry[];
  directories: RecentEntry[];
  busy: boolean;
  error?: string;
  onOpen: (entry: RecentEntry, directory: boolean) => void;
  onRemove: (entry: RecentEntry, directory: boolean) => void;
  onClear: () => void;
  onClose: () => void;
}

function parentPath(path: string) {
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return separator < 0 ? path : path.slice(0, separator) || path.slice(0, 1);
}

export default function RecentEntries({ files, directories, busy, error, onOpen, onRemove, onClear, onClose }: RecentEntriesProps) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const element = panel.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (element?.querySelector<HTMLButtonElement>('[data-open-recent]:not(:disabled)') ?? element?.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      // The anchor also contains the trigger, whose click toggles the popover.
      if (!panel.current?.parentElement?.contains(event.target as Node)) close.current();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault(); event.stopPropagation(); close.current();
      }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keyboard);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', keyboard);
      if (element?.contains(document.activeElement) || document.activeElement === document.body) previous?.focus({ preventScroll: true });
    };
  }, []);
  const section = (entries: RecentEntry[], directory: boolean) => <section aria-label={directory ? '最近目录' : '最近文件'}>
    <h3>{directory ? '最近目录' : '最近文件'}<span>{entries.length}</span></h3>
    {entries.length ? <ul>{entries.map(entry => <li key={entry.path}>
      <button type="button" data-open-recent className={styles.open} disabled={busy} title={entry.path} aria-label={`打开${directory ? '目录' : '文件'} ${entry.name}`} onClick={() => onOpen(entry, directory)}>
        {directory ? <IconFolder size={16} stroke={1.6} aria-hidden="true" /> : <IconFile size={16} stroke={1.6} aria-hidden="true" />}
        <span><strong>{entry.name}</strong><small>{parentPath(entry.path)}</small></span>
      </button>
      <button type="button" className={styles.remove} disabled={busy} title="移除记录" aria-label={`移除${directory ? '目录' : '文件'}记录 ${entry.name}`} onClick={() => onRemove(entry, directory)}><IconX size={13} stroke={1.6} aria-hidden="true" /></button>
    </li>)}</ul> : <p className={styles.empty}>暂无{directory ? '最近目录' : '最近文件'}</p>}
  </section>;
  return <div ref={panel} role="dialog" aria-label="最近打开" aria-busy={busy} className={styles.panel}>
    <header><strong>最近打开</strong><button type="button" className={styles.close} aria-label="关闭最近打开" onClick={onClose}><IconX size={16} stroke={1.6} aria-hidden="true" /></button></header>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.list}>{section(files, false)}{section(directories, true)}</div>
    <footer><span>清除记录不会删除本地文件</span><button type="button" disabled={busy || !error && !files.length && !directories.length} onClick={onClear}>清空记录</button></footer>
  </div>;
}
