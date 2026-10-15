import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { LocalImage, type ResourceContext } from "./localImage";
import Placeholder from "@tiptap/extension-placeholder";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
const lowlight = createLowlight(common);
export const editorExtensions = (resources?: ResourceContext) => [
  StarterKit.configure({ codeBlock: false, underline: false, link: { openOnClick: false, autolink: false, protocols: ["file"] } }),
  CodeBlockLowlight.configure({ lowlight, defaultLanguage: "plaintext" }),
  TableKit.configure({ table: { resizable: false } }),
  TaskList, TaskItem.configure({ nested: true }),
  LocalImage.configure({ allowBase64: false, resolve: resources?.image ?? (async (src: string) => src) }),
  Placeholder.configure({ placeholder: "写下第一行，或输入 # 空格创建标题…" }),
  Markdown,
];
