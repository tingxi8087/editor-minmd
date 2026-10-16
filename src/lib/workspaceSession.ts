import { invoke } from '@tauri-apps/api/core';
import type { DirectoryRoot, DocumentFile } from './files';
export interface SavedWorkspace {
  version: 1;
  directory: string | null;
  tabs: { path: string; mode: 'document' | 'source'; reading: boolean }[];
  activePath: string | null;
}
export interface RestoredWorkspace {
  exists: boolean; session: SavedWorkspace; root: DirectoryRoot | null;
  tabs: { file: DocumentFile; mode: 'document' | 'source'; reading: boolean }[];
  errors: string[];
}
export const workspaceSession = {
  restore: (restoreDirectory = true) => invoke<RestoredWorkspace>('restore_workspace_session', { restoreDirectory }),
  write: (session: SavedWorkspace, reset = false) => invoke<void>('write_workspace_session', { session, reset }),
};
export type WorkspaceSessionGateway = typeof workspaceSession;
