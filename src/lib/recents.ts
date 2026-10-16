import { invoke } from '@tauri-apps/api/core';
import { desktopAvailable, type DirectoryRoot, type DocumentFile } from './files';
export interface RecentEntry { path: string; name: string }
export interface RecentEntries { files: RecentEntry[]; directories: RecentEntry[] }
export const recentGateway = {
  load: () => desktopAvailable ? invoke<RecentEntries>('load_recent_entries') : Promise.resolve<RecentEntries>({ files: [], directories: [] }),
  record: (path: string, directory: boolean) => invoke<RecentEntries>('record_recent_entry', { path, directory }),
  remove: (path: string, directory: boolean) => invoke<RecentEntries>('remove_recent_entry', { path, directory }),
  clear: () => invoke<RecentEntries>('clear_recent_entries'),
  openFile: (path: string) => invoke<DocumentFile>('open_recent_document', { path }),
  openDirectory: (path: string) => invoke<DirectoryRoot>('open_recent_directory', { path }),
};
export type RecentGateway = typeof recentGateway;

// Serialize history writes so a slow initial load cannot replace newer MRU results.
export class RecentModel {
  files: RecentEntry[] = [];
  directories: RecentEntry[] = [];
  error = '';
  busy = false;
  private revision = 0;
  private listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  constructor(readonly gateway: RecentGateway = recentGateway) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.revision;
  private changed() { this.revision++; this.listeners.forEach(listener => listener()); }
  reportError(error: unknown) { this.error = String(error); this.changed(); }
  private update(operation: () => Promise<RecentEntries>): Promise<boolean> {
    this.pending++; this.busy = true; this.changed();
    const result = this.queue.then(async () => {
      try {
        const entries = await operation();
        this.files = entries.files; this.directories = entries.directories; this.error = ''; return true;
      } catch (error) { this.error = String(error); return false; }
      finally { this.pending--; this.busy = this.pending > 0; this.changed(); }
    });
    this.queue = result; return result;
  }
  load = () => this.update(() => this.gateway.load());
  record = (path: string, directory: boolean) => this.update(() => this.gateway.record(path, directory));
  remove = (path: string, directory: boolean) => this.update(() => this.gateway.remove(path, directory));
  clear = () => this.update(() => this.gateway.clear());
}
