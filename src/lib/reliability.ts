import type { JSONContent } from '@tiptap/core';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
export interface Draft {
  id: string; name: string; path: string | null; resourceBase: string | null;
  kind?: 'markdown' | 'text' | null; mode?: 'document' | 'source' | null; authority?: 'rich' | 'source' | null; sourceScrollTop?: number | null;
  document?: JSONContent | null; baseline?: JSONContent | null;
  raw: string; content: string; updatedAt: number; scrollTop: number; selection: number;
}
export interface DiskSnapshot { path: string; kind: 'present' | 'missing' | 'error'; content?: string; message?: string }
export const reliability = {
  loadDrafts: () => invoke<Draft[]>('load_drafts'),
  writeDrafts: (drafts: Draft[]) => invoke<void>('write_drafts', { drafts }),
  authorizeDraft: (id: string) => invoke<DiskSnapshot | null>('authorize_draft', { id }),
  checkDocuments: (paths: string[]) => invoke<DiskSnapshot[]>('check_documents', { paths }),
  watchDocuments: (paths: string[]) => invoke<void>('watch_documents', { paths }),
  onDiskChange: (callback: () => void) => listen('document-disk-change', callback),
};
export type ReliabilityGateway = typeof reliability;
