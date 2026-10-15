import type { Editor } from "@tiptap/react";
import { EditorState } from "@tiptap/pm/state";

export function replaceEditorDocument(editor: Editor, markdown: string) {
  editor.commands.setContent(markdown, { contentType: "markdown", emitUpdate: false });
  // Undo must never restore the previous file after switching documents.
  editor.view.updateState(EditorState.create({ doc: editor.state.doc, schema: editor.schema, plugins: editor.state.plugins }));
}
