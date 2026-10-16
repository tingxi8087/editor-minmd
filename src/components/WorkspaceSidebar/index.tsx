import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { DEFAULT_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, normalizeSidebarWidth, useSettings } from "@/store/settings";
import styles from "./index.module.less";

export default function WorkspaceSidebar({ children }: { children: ReactNode }) {
  const { sidebarWidth, setSidebarWidth } = useSettings();
  const element = useRef<HTMLElement>(null);
  const id = useId();
  const drag = useRef<{ pointer: number; startX: number; startWidth: number; width: number } | null>(null);
  const [draft, setDraft] = useState<number | null>(null);
  const [maximum, setMaximum] = useState(MAX_SIDEBAR_WIDTH);
  const clamp = (width: number) => Math.min(maximum, normalizeSidebarWidth(width));
  const width = clamp(draft ?? sidebarWidth);
  const resizing = draft !== null;
  useLayoutEffect(() => {
    const parent = element.current?.parentElement;
    const measure = () => {
      // Keep the activity rail (38px) and at least 320px for the document.
      const available = parent?.getBoundingClientRect().width || window.innerWidth;
      setMaximum(Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, available - 38 - 320)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (parent) observer.observe(parent);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  const cancel = () => { drag.current = null; setDraft(null); };
  useEffect(() => {
    if (!resizing) return;
    const root = document.documentElement;
    const cursor = root.style.cursor, selection = root.style.userSelect;
    root.style.cursor = "col-resize"; root.style.userSelect = "none";
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); cancel(); } };
    window.addEventListener("blur", cancel); window.addEventListener("keydown", escape, true);
    return () => { root.style.cursor = cursor; root.style.userSelect = selection; window.removeEventListener("blur", cancel); window.removeEventListener("keydown", escape, true); };
  }, [resizing]);
  return <aside ref={element} id={id} className={`sidebar ${styles.sidebar}`} aria-label="文件与大纲" style={{ width, flexBasis: width }}>
    {children}
    <div className={`${styles.handle} ${resizing ? styles.dragging : ""}`} role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" aria-controls={id} aria-valuemin={MIN_SIDEBAR_WIDTH} aria-valuemax={maximum} aria-valuenow={width} tabIndex={0} title="拖拽调整侧栏宽度，双击恢复默认" onPointerDown={event => {
      if (event.button !== 0 || drag.current) return;
      event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointer: event.pointerId, startX: event.clientX, startWidth: width, width }; setDraft(width);
    }} onPointerMove={event => {
      const current = drag.current; if (!current || current.pointer !== event.pointerId) return;
      current.width = clamp(current.startWidth + event.clientX - current.startX); setDraft(current.width);
    }} onPointerUp={event => {
      const current = drag.current; if (!current || current.pointer !== event.pointerId) return;
      setSidebarWidth(clamp(current.startWidth + event.clientX - current.startX)); cancel();
      event.currentTarget.releasePointerCapture(event.pointerId);
    }} onPointerCancel={cancel} onLostPointerCapture={cancel} onDoubleClick={() => { cancel(); setSidebarWidth(DEFAULT_SIDEBAR_WIDTH); }} onKeyDown={event => {
      if (resizing || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      setSidebarWidth(event.key === "Home" ? MIN_SIDEBAR_WIDTH : event.key === "End" ? maximum : clamp(width + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 40 : 10)));
    }} />
  </aside>;
}
