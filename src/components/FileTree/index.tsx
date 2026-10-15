import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button, Input, Modal } from "paper-ink";
import { IconDots, IconFilePlus, IconFolderPlus, IconChevronDown, IconChevronRight, IconFile, IconFolder, IconFolderOpen, IconMarkdown } from "paper-ink/icons";
import type { DirectoryEntry } from "@/lib/files";
import type { WorkspaceModel } from "@/workspace/model";
import styles from "./index.module.less";

export default function FileTree({ workspace }: { workspace: WorkspaceModel }) {
  const root = workspace.root;
  const [menu, setMenu] = useState<{ entry: DirectoryEntry; x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<{ action: 'file' | 'folder' | 'rename' | 'trash'; entry: DirectoryEntry } | null>(null);
  const [name, setName] = useState(''); const [error, setError] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setMenu(null); setDialog(null); }, [root?.path]);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(null); };
    const escape = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('mousedown', outside); window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('mousedown', outside); window.removeEventListener('keydown', escape); };
  }, [menu]);
  const begin = (action: 'file' | 'folder' | 'rename' | 'trash', entry: DirectoryEntry) => { setMenu(null); setError(''); setName(action === 'rename' ? entry.name : action === 'file' ? '未命名.md' : '新建文件夹'); setDialog({ action, entry }); };
  const submit = async () => {
    if (!dialog || workspace.busy) return;
    const { action, entry } = dialog;
    if (action !== 'trash' && !name.trim()) { setError('请输入名称'); return; }
    const result = action === 'trash' ? await workspace.trashEntry(entry.path) : action === 'rename' ? await workspace.renameEntry(entry.path, name) : await workspace.createEntry(entry.path, name, action === 'folder');
    if (result) setDialog(null); else setError(workspace.error || '操作未完成，请重试');
  };
  const showMenu = (entry: DirectoryEntry, x: number, y: number) => { if (!workspace.busy && !workspace.closing) setMenu({ entry, x: Math.max(4, Math.min(x, window.innerWidth - 172)), y: Math.max(4, Math.min(y, window.innerHeight - 170)) }); };

  if (!root) return <div className={styles.empty}><p>打开一个目录，浏览本地文件。</p><button onClick={() => void workspace.chooseDirectory()} disabled={workspace.busy}><IconFolderOpen size={15} stroke={1.6} />打开目录</button></div>;
  const renderChildren = (path: string, depth: number) => <>
    {workspace.loading.has(path) && <li role="none" className={styles.hint} style={{ paddingLeft: 12 + depth * 12 }}>正在读取…</li>}
    {workspace.treeErrors.has(path) && <li role="none" className={styles.hint}><span role="alert">{workspace.treeErrors.get(path)}</span><button disabled={workspace.busy} onClick={() => void workspace.loadDirectory(path)}>重试</button></li>}
    {!workspace.loading.has(path) && workspace.children.get(path)?.length === 0 && <li role="none" className={styles.hint} style={{ paddingLeft: 12 + depth * 12 }}>空目录</li>}
    {workspace.children.get(path)?.map((entry) => renderEntry(entry, depth))}
  </>;
  const renderEntry = (entry: DirectoryEntry, depth: number) => {
    const expanded = workspace.expanded.has(entry.path);
    const active = workspace.active?.path === entry.path;
    const disabled = entry.isSymlink || (!entry.isDirectory && entry.isFile === false);
    const Icon = entry.isDirectory ? expanded ? IconFolderOpen : IconFolder : entry.isMarkdown ? IconMarkdown : IconFile;
    return <li role="treeitem" aria-expanded={entry.isDirectory ? expanded : undefined} aria-selected={active} key={entry.path}>
      <div className={styles.itemRow}><button onContextMenu={event => { event.preventDefault(); if (!disabled) showMenu(entry, event.clientX, event.clientY); }} onKeyDown={event => { if (event.key === 'F2' && entry.path !== root.path) { event.preventDefault(); begin('rename', entry); } }} className={`${styles.row} ${active ? styles.active : ""}`} data-path={entry.path} title={`${entry.path}${disabled ? entry.isSymlink ? " · 暂不展开符号链接" : " · 不是普通文件" : ""}`} disabled={workspace.busy || disabled} style={{ paddingLeft: 8 + depth * 12 }} onClick={() => void (entry.isDirectory ? workspace.toggleDirectory(entry.path) : workspace.openTreeFile(entry))}>
        {entry.isDirectory ? expanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} /> : <span className={styles.spacer} />}
        <Icon size={15} stroke={1.5} /><span>{entry.name}</span>
        {workspace.tabs.some((tab) => tab.path === entry.path && tab.dirty) && <i className="dirty-dot" />}
      </button>
      {!disabled && <span className={styles.actions}>
        {entry.path === root.path && <><button aria-label="目录中新建文件" title="新建文件" disabled={workspace.busy} onClick={() => begin('file', entry)}><IconFilePlus size={14} /></button><button aria-label="目录中新建文件夹" title="新建文件夹" disabled={workspace.busy} onClick={() => begin('folder', entry)}><IconFolderPlus size={14} /></button></>}
        <button aria-label={`更多操作 ${entry.name}`} title="更多操作（也可右键）" disabled={workspace.busy} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); showMenu(entry, rect.left, rect.bottom); }}><IconDots size={14} /></button>
      </span>}
      </div>
      {entry.isDirectory && expanded && <ul role="group">{renderChildren(entry.path, depth + 1)}</ul>}
    </li>;
  };
  const navigate = (event: KeyboardEvent<HTMLUListElement>) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    event.preventDefault();
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="treeitem"] > div > button:not(:disabled)'));
    const index = buttons.indexOf(target);
    const item = target.closest('[role="treeitem"]');
    if (event.key === 'ArrowLeft') {
      if (item?.getAttribute('aria-expanded') === 'true') target.click();
      else item?.parentElement?.closest('[role="treeitem"]')?.querySelector<HTMLButtonElement>(':scope > div > button')?.focus();
    } else if (event.key === 'ArrowRight' && item?.getAttribute('aria-expanded') === 'false') target.click();
    else buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)))]?.focus();
  };
  return <><ul className={styles.tree} role="tree" aria-label="文件树" onKeyDown={navigate}>{renderEntry({ path: root.path, name: root.name, isDirectory: true, isMarkdown: false, isSymlink: false }, 0)}</ul>
    {menu && <div ref={menuRef} className={styles.menu} style={{ left: menu.x, top: menu.y }} role="menu" aria-label={`${menu.entry.name} 的操作`} onKeyDown={event => { if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button')); const index = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus(); }}>
      {menu.entry.isDirectory && <><button role="menuitem" onClick={() => begin('file', menu.entry)}>新建文件</button><button role="menuitem" onClick={() => begin('folder', menu.entry)}>新建文件夹</button></>}
      {menu.entry.path !== root.path && <><button role="menuitem" onClick={() => begin('rename', menu.entry)}>重命名</button><button role="menuitem" className={styles.danger} onClick={() => begin('trash', menu.entry)}>移到回收站</button></>}
    </div>}
    <Modal open={!!dialog} maskClosable={dialog?.action !== 'rename'} title={dialog?.action === 'trash' ? '移到系统回收站？' : dialog?.action === 'rename' ? '重命名' : dialog?.action === 'folder' ? '新建文件夹' : '新建文件'} width={420} onCancel={() => { if (!workspace.busy) setDialog(null); }} footer={<div className={styles.dialogActions}><Button disabled={workspace.busy} onClick={() => setDialog(null)}>取消</Button><Button type="primary" danger={dialog?.action === 'trash'} disabled={workspace.busy} onClick={() => void submit()}>{workspace.busy ? '处理中…' : dialog?.action === 'trash' ? '移到回收站' : '确定'}</Button></div>}>
      <p className={styles.location}>{dialog?.entry.path}</p>
      {dialog?.action === 'trash' ? <p>将「{dialog.entry.name}」{dialog.entry.isDirectory ? '及其全部内容' : ''}移到系统回收站，可在系统中恢复。对应的已保存标签会关闭；有未保存内容时会阻止删除。</p> : <label className={styles.nameField}>名称<Input autoFocus aria-label="名称" value={name} disabled={workspace.busy} onChange={event => { setName(event.target.value); setError(''); }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) void submit(); }} /></label>}
      {error && <p role="alert" className="dialog-error">{error}</p>}
    </Modal>
  </>;
}
