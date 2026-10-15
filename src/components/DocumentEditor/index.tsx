import { EditorContent, type Editor } from "@tiptap/react";
import styles from "./index.module.less";
export default function DocumentEditor({ editor }: { editor: Editor | null }) {
  return <div className={`${styles.editor} document-scroll`}><EditorContent editor={editor} /></div>;
}
