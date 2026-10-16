import { expect, it, vi } from 'vitest';
import { connectExternalFiles, type IncomingFile } from '../src/lib/externalFiles';
import type { WorkspaceModel } from '../src/workspace/model';
const setup = () => {
  let notify!: () => void; let changed!: () => void;
  const stop = vi.fn(); const off = vi.fn();
  const workspace = { busy: false, closing: null, openFile: vi.fn(), reportError: vi.fn(), subscribe: (fn: () => void) => { changed = fn; return off; } };
  const gateway = { take: vi.fn().mockResolvedValue([]), listen: vi.fn(async (fn: () => void) => { notify = fn; return stop; }) };
  const dispose = connectExternalFiles(workspace as unknown as WorkspaceModel, gateway);
  return { workspace, gateway, dispose, stop, off, notify: () => notify(), changed: () => changed() };
};
const file: IncomingFile = { file: { name: '测试.md', path: '/tmp/测试.md', content: '# hello' }, error: null };
it('drains startup files after registering a listener and accepts later open events', async () => {
  const ctx = setup(); ctx.gateway.take.mockResolvedValueOnce([file]);
  await vi.waitFor(() => expect(ctx.workspace.openFile).toHaveBeenCalledWith(file.file));
  ctx.gateway.take.mockResolvedValueOnce([{ ...file, file: { ...file.file!, path: '/tmp/other.md' } }]); ctx.notify();
  await vi.waitFor(() => expect(ctx.workspace.openFile).toHaveBeenCalledTimes(2)); ctx.dispose(); expect(ctx.stop).toHaveBeenCalledOnce(); expect(ctx.off).toHaveBeenCalledOnce();
});
it('keeps files queued while the workspace is busy or awaiting close confirmation', async () => {
  const ctx = setup(); ctx.workspace.busy = true; ctx.gateway.take.mockResolvedValueOnce([file]);
  await Promise.resolve(); expect(ctx.gateway.take).not.toHaveBeenCalled();
  ctx.workspace.busy = false; (ctx.workspace as { closing: unknown }).closing = {}; ctx.changed(); expect(ctx.gateway.take).not.toHaveBeenCalled();
  ctx.workspace.closing = null; ctx.changed(); await vi.waitFor(() => expect(ctx.workspace.openFile).toHaveBeenCalledOnce()); ctx.dispose();
});
it('buffers an in-flight result until a concurrent file operation finishes', async () => {
  const ctx = setup(); let done!: (files: IncomingFile[]) => void;
  ctx.gateway.take.mockImplementationOnce(() => new Promise(resolve => { done = resolve; }));
  await vi.waitFor(() => expect(ctx.gateway.take).toHaveBeenCalledOnce()); ctx.workspace.busy = true; done([file]);
  await Promise.resolve(); expect(ctx.workspace.openFile).not.toHaveBeenCalled();
  ctx.workspace.busy = false; ctx.changed(); expect(ctx.workspace.openFile).toHaveBeenCalledWith(file.file); ctx.dispose();
});
it('opens valid files from a batch and reports errors from the remaining files', async () => {
  const ctx = setup(); ctx.gateway.take.mockResolvedValueOnce([{ file: null, error: '不能读取二进制文件' }, file]);
  await vi.waitFor(() => expect(ctx.workspace.reportError).toHaveBeenCalledWith('不能读取二进制文件'));
  expect(ctx.workspace.openFile).toHaveBeenCalledWith(file.file); ctx.dispose();
});
it('does not drain when disposed before listener registration completes', async () => {
  const ctx = setup(); ctx.dispose(); await Promise.resolve(); expect(ctx.gateway.take).not.toHaveBeenCalled(); expect(ctx.stop).toHaveBeenCalledOnce();
});
