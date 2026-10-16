import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconMarkdown, IconFileCode, IconX } from "paper-ink/icons";
import type { WorkspaceModel } from "@/workspace/model";
import styles from "./index.module.less";

export default function DocumentTabs({ workspace, onClose }: { workspace: WorkspaceModel; onClose: (ids: string[]) => void }) {
  const list = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const locked = workspace.busy || !!workspace.closing;
  const showMenu = (id: string, x: number, y: number) => { if (!locked) setMenu({ id, x, y }); };
  const dismiss = (restoreFocus = false) => {
    if (restoreFocus && menu) document.getElementById(`tab-${menu.id}`)?.focus({ preventScroll: true });
    setMenu(null);
  };
  useEffect(() => { if (locked || menu && !workspace.tabs.some(tab => tab.id === menu.id)) setMenu(null); }, [locked, workspace.tabs, menu?.id]);
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const x = Math.max(6, Math.min(menu.x, window.innerWidth - rect.width - 6));
    const y = Math.max(6, Math.min(menu.y, window.innerHeight - rect.height - 6));
    if (x !== menu.x || y !== menu.y) setMenu({ ...menu, x, y });
    menuRef.current.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [menu?.id, menu?.x, menu?.y]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(null); };
    const hide = () => setMenu(null);
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", hide, true); window.addEventListener("resize", hide);
    return () => { document.removeEventListener("pointerdown", outside, true); window.removeEventListener("scroll", hide, true); window.removeEventListener("resize", hide); };
  }, [Boolean(menu)]);
  const index = workspace.tabs.findIndex(tab => tab.id === menu?.id);
  const items = [
    { label: "关闭其他", tabs: workspace.tabs.filter(tab => tab.id !== menu?.id) },
    { label: "关闭左侧", tabs: workspace.tabs.slice(0, Math.max(0, index)) },
    { label: "关闭右侧", tabs: index < 0 ? [] : workspace.tabs.slice(index + 1) },
    { label: "全部关闭", tabs: workspace.tabs },
    { label: "关闭已保存", tabs: workspace.tabs.filter(tab => !tab.dirty) },
  ];
  useLayoutEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [workspace.activeId]);
  return <><div ref={list} className={styles.tabs} role="tablist" aria-label="打开的文档">
    {workspace.tabs.map((tab) => <div className={`${styles.tab} ${workspace.activeId === tab.id ? styles.active : ""}`} key={tab.id} title={tab.path ?? tab.name} onContextMenu={event => { event.preventDefault(); showMenu(tab.id, event.clientX, event.clientY); }} onKeyDown={event => {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
      event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); showMenu(tab.id, rect.left, rect.bottom);
    }}>
      <button role="tab" aria-selected={workspace.activeId === tab.id} aria-controls={`panel-${tab.id}`} id={`tab-${tab.id}`} disabled={locked} onClick={() => workspace.activate(tab.id)} onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = workspace.tabs.findIndex((item) => item.id === tab.id);
        const target = workspace.tabs[event.key === 'Home' ? 0 : event.key === 'End' ? workspace.tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + workspace.tabs.length) % workspace.tabs.length];
        workspace.activate(target.id); document.getElementById(`tab-${target.id}`)?.focus();
      }}>{tab.kind === "markdown" ? <IconMarkdown size={15} stroke={1.5} /> : <IconFileCode size={15} stroke={1.5} />}<span>{tab.name}</span>{tab.dirty && <i className="dirty-dot" aria-label="未保存" />}</button>
      <button className={styles.close} aria-label={`关闭 ${tab.name}`} title="关闭标签" disabled={locked} onClick={() => onClose([tab.id])}><IconX size={12} stroke={1.6} /></button>
    </div>)}
  </div>{menu && createPortal(<div ref={menuRef} role="menu" aria-label="标签操作" className={styles.menu} style={{ left: menu.x, top: menu.y }} onContextMenu={event => event.preventDefault()} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss(true); return; }
    if (event.key === "Tab") { dismiss(); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = Array.from(menuRef.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  }}>{items.map(item => <button key={item.label} role="menuitem" type="button" disabled={locked || index < 0 || !item.tabs.length} onClick={() => { dismiss(true); onClose(item.tabs.map(tab => tab.id)); }}>{item.label}</button>)}</div>, list.current?.closest(".workspace") ?? document.body)}</>;

}
