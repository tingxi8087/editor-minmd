import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { DocumentFile } from '@/lib/files';
import type { WorkspaceModel } from '@/workspace/model';
export interface IncomingFile { file: DocumentFile | null; error: string | null }
export const externalFiles = {
  take: () => invoke<IncomingFile[]>('take_external_files'),
  listen: (notify: () => void) => listen('external-files-pending', notify),
};
// Register before draining: macOS may deliver files before the webview is ready.
export function connectExternalFiles(workspace: WorkspaceModel, gateway = externalFiles) {
  let disposed = false; let reading = false; let pending = false; let unlisten: (() => void) | undefined;
  const buffered: IncomingFile[] = [];
  const pump = async () => {
    if (disposed || reading || workspace.busy || workspace.closing) return;
    reading = true;
    try {
      while (!disposed && !workspace.busy && !workspace.closing) {
        if (buffered.length) {
          const errors: string[] = [];
          for (const item of buffered.splice(0)) { if (item.file) workspace.openFile(item.file); if (item.error) errors.push(item.error); }
          if (errors.length) workspace.reportError(errors.join('\n'));
        }
        if (!pending) break;
        pending = false;
        buffered.push(...await gateway.take());
      }
    } catch (error) { if (!disposed) workspace.reportError(`无法接收外部文件：${String(error)}`); }
    finally { reading = false; }
  };
  const off = workspace.subscribe(() => { void pump(); });
  void gateway.listen(() => { pending = true; void pump(); }).then(stop => {
    if (disposed) { stop(); return; }
    unlisten = stop; pending = true; void pump();
  }).catch(error => { if (!disposed) workspace.reportError(`无法监听外部文件：${String(error)}`); });
  return () => { disposed = true; off(); unlisten?.(); };
}
