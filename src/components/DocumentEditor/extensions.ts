import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { LocalImage, type ResourceContext } from "./localImage";
import Placeholder from "@tiptap/extension-placeholder";
import { InteractiveTable, QuickTableView, TableDeletePreview } from "./table";
import { RichCodeBlock } from "./codeBlock";
import { DocumentSearchExtension } from "../DocumentSearch/extension";
import { common, createLowlight } from "lowlight";
const lowlight = createLowlight(common);
export const editorExtensions = (resources?: ResourceContext) => [
  StarterKit.configure({ codeBlock: false, underline: false, link: { openOnClick: false, autolink: false, protocols: ["file"] } }),
  RichCodeBlock.configure({ lowlight, defaultLanguage: "plaintext" }),
  TableKit.configure({ table: false }),
  InteractiveTable.configure({ resizable: true, View: QuickTableView, cellMinWidth: 70 }),
  TableDeletePreview,
  DocumentSearchExtension,
  TaskList, TaskItem.configure({ nested: true }),
  LocalImage.configure({ allowBase64: false, resolve: resources?.image ?? (async (src: string) => src) }),
  Placeholder.configure({ placeholder: ({ node }) => node.type.name === "paragraph" ? "写下第一行，输入 / 插入内容…" : "" }),
  Markdown,
];
