import { invoke, isTauri } from "@tauri-apps/api/core";
export interface DocumentFile { path: string; name: string; content: string }
export interface DirectoryEntry { path: string; name: string; isDirectory: boolean; isMarkdown: boolean; isSymlink: boolean }
export interface DirectoryRoot { path: string; name: string; entries: DirectoryEntry[] }
export const desktopAvailable = isTauri();
export const files = {
  openDocument: () => invoke<DocumentFile | null>("open_document"),
  saveDocument: (path: string | null, content: string, expectedContent: string | null, saveAs: boolean, protectedPaths: string[]) =>
    invoke<DocumentFile | null>("save_document", { request: { path, content, expectedContent, saveAs, protectedPaths } }),
  releaseDocument: (path: string) => invoke<void>("release_document", { path }),
  openDirectory: () => invoke<DirectoryRoot | null>("open_directory"),
  listDirectory: (root: string, path: string) => invoke<DirectoryEntry[]>("list_directory", { root, path }),
  readWorkspaceDocument: (root: string, path: string) => invoke<DocumentFile>("read_workspace_document", { root, path }),
  closeDirectory: () => invoke<void>("close_directory"),
};
export type FileGateway = typeof files;
