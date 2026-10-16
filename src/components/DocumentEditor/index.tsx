import { useLayoutEffect, useRef } from "react";
import { EditorContent, type Editor } from "@tiptap/react";
import styles from "./index.module.less";
import TableContextMenu from "../TableContextMenu";
export default function DocumentEditor({ editor, active = true, scrollTop = 0, onScroll }: { editor: Editor | null; active?: boolean; scrollTop?: number; onScroll?: (position: number) => void }) {
  const container = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (active && container.current) container.current.scrollTop = scrollTop; }, [active, editor]);
  return <div ref={container} className={`${styles.editor} document-scroll`} onScroll={(event) => { if (active) onScroll?.(event.currentTarget.scrollTop); }}><EditorContent editor={editor} />{editor && active && <TableContextMenu editor={editor} />}</div>;
}
