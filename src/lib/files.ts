import { invoke, isTauri } from "@tauri-apps/api/core";
export interface DocumentFile { path: string; name: string; content: string }
export interface DirectoryEntry { path: string; name: string; isDirectory: boolean; isFile?: boolean; isMarkdown: boolean; isSymlink: boolean }
export interface DirectoryRoot { path: string; name: string; entries: DirectoryEntry[] }
export const desktopAvailable = isTauri();
export interface ResourceSaveContext { basePath: string; references: { token: string; value: string }[] }
export const files = {
  openDocument: () => invoke<DocumentFile | null>("open_document"),
  saveDocument: (path: string | null, content: string, expectedContent: string | null, saveAs: boolean, protectedPaths: string[], resources?: ResourceSaveContext, suggestedName?: string) =>
    invoke<DocumentFile | null>("save_document", { request: { path, content, expectedContent, saveAs, protectedPaths, resources, suggestedName } }),
  readEmbed: (document: string, reference: string) => invoke<DocumentFile>("read_embedded_document", { document, reference }),
  loadImage: (document: string, reference: string) => invoke<string>("load_document_image", { document, reference }),
  importImage: (document: string, source?: string, data?: number[], name?: string) => invoke<{ reference: string; name: string } | null>("import_document_image", { document, source, data, name }),
  chooseMarkdownReference: (document: string) => invoke<{ reference: string; name: string } | null>("choose_markdown_reference", { document }),
  openLink: (document: string, reference: string) => invoke<DocumentFile | null>("open_document_link", { document, reference }),
  releaseDocument: (path: string) => invoke<void>("release_document", { path }),
  openDirectory: () => invoke<DirectoryRoot | null>("open_directory"),
  listDirectory: (root: string, path: string) => invoke<DirectoryEntry[]>("list_directory", { root, path }),
  readWorkspaceDocument: (root: string, path: string) => invoke<DocumentFile>("read_workspace_document", { root, path }),
  createEntry: (root: string, parent: string, name: string, directory: boolean) => invoke<string>("create_workspace_entry", { root, parent, name, directory }),
  renameEntry: (root: string, path: string, name: string, expected: { path: string; content: string }[]) => invoke<string>("rename_workspace_entry", { root, path, name, expected }),
  trashEntry: (root: string, path: string, expected: { path: string; content: string }[]) => invoke<void>("trash_workspace_entry", { root, path, expected }),
  closeDirectory: () => invoke<void>("close_directory"),
};
export type FileGateway = Omit<typeof files, 'chooseMarkdownReference' | 'readEmbed'> & { readEmbed?: typeof files.readEmbed };
