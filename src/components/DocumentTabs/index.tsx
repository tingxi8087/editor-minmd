import { useLayoutEffect, useRef } from "react";
import { IconMarkdown, IconX } from "paper-ink/icons";
import type { WorkspaceModel } from "@/workspace/model";
import styles from "./index.module.less";

export default function DocumentTabs({ workspace, onClose }: { workspace: WorkspaceModel; onClose: (ids: string[]) => void }) {
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [workspace.activeId]);
  return <div ref={list} className={styles.tabs} role="tablist" aria-label="打开的文档">
    {workspace.tabs.map((tab) => <div className={`${styles.tab} ${workspace.activeId === tab.id ? styles.active : ""}`} key={tab.id} title={tab.path ?? tab.name}>
      <button role="tab" aria-selected={workspace.activeId === tab.id} aria-controls={`panel-${tab.id}`} id={`tab-${tab.id}`} disabled={workspace.busy} onClick={() => workspace.activate(tab.id)} onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = workspace.tabs.findIndex((item) => item.id === tab.id);
        const target = workspace.tabs[event.key === 'Home' ? 0 : event.key === 'End' ? workspace.tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + workspace.tabs.length) % workspace.tabs.length];
        workspace.activate(target.id); document.getElementById(`tab-${target.id}`)?.focus();
      }}><IconMarkdown size={15} stroke={1.5} /><span>{tab.name}</span>{tab.dirty && <i className="dirty-dot" aria-label="未保存" />}</button>
      <button className={styles.close} aria-label={`关闭 ${tab.name}`} title="关闭标签" disabled={workspace.busy} onClick={() => onClose([tab.id])}><IconX size={12} stroke={1.6} /></button>
    </div>)}
  </div>;
}
