import { invoke, isTauri } from "@tauri-apps/api/core";
export interface DocumentFile { path: string; name: string; content: string }
export const desktopAvailable = isTauri();
export function openDocument() { return invoke<DocumentFile | null>("open_document"); }
export function saveDocument(path: string | null, content: string, expectedContent: string | null, saveAs: boolean) {
  return invoke<DocumentFile | null>("save_document", { request: { path, content, expectedContent, saveAs } });
}
