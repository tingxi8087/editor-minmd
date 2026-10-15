import type { KeyboardEvent } from "react";
import { IconChevronDown, IconChevronRight, IconFile, IconFolder, IconFolderOpen, IconMarkdown } from "paper-ink/icons";
import type { DirectoryEntry } from "@/lib/files";
import type { WorkspaceModel } from "@/workspace/model";
import styles from "./index.module.less";

export default function FileTree({ workspace }: { workspace: WorkspaceModel }) {
  const root = workspace.root;
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
    const disabled = entry.isSymlink || (!entry.isDirectory && !entry.isMarkdown);
    const Icon = entry.isDirectory ? expanded ? IconFolderOpen : IconFolder : entry.isMarkdown ? IconMarkdown : IconFile;
    return <li role="treeitem" aria-expanded={entry.isDirectory ? expanded : undefined} aria-selected={active} key={entry.path}>
      <button className={`${styles.row} ${active ? styles.active : ""}`} data-path={entry.path} title={`${entry.path}${disabled ? entry.isSymlink ? " · 暂不展开符号链接" : " · 当前仅支持 Markdown" : ""}`} disabled={workspace.busy || disabled} style={{ paddingLeft: 8 + depth * 12 }} onClick={() => void (entry.isDirectory ? workspace.toggleDirectory(entry.path) : workspace.openTreeFile(entry))}>
        {entry.isDirectory ? expanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} /> : <span className={styles.spacer} />}
        <Icon size={15} stroke={1.5} /><span>{entry.name}</span>
        {workspace.tabs.some((tab) => tab.path === entry.path && tab.dirty) && <i className="dirty-dot" />}
      </button>
      {entry.isDirectory && expanded && <ul role="group">{renderChildren(entry.path, depth + 1)}</ul>}
    </li>;
  };
  const navigate = (event: KeyboardEvent<HTMLUListElement>) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    event.preventDefault();
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="treeitem"] > button:not(:disabled)'));
    const index = buttons.indexOf(target);
    const item = target.parentElement;
    if (event.key === 'ArrowLeft') {
      if (item?.getAttribute('aria-expanded') === 'true') target.click();
      else item?.parentElement?.closest('[role="treeitem"]')?.querySelector<HTMLButtonElement>(':scope > button')?.focus();
    } else if (event.key === 'ArrowRight' && item?.getAttribute('aria-expanded') === 'false') target.click();
    else buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)))]?.focus();
  };
  return <ul className={styles.tree} role="tree" aria-label="文件树" onKeyDown={navigate}>{renderEntry({ path: root.path, name: root.name, isDirectory: true, isMarkdown: false, isSymlink: false }, 0)}</ul>;
}
