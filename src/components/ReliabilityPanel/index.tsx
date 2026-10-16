import { useEffect, useState } from 'react';
import { Button, Modal } from 'paper-ink';
import type { WorkspaceModel } from '@/workspace/model';
import './style.less';

export default function ReliabilityPanel({ workspace }: { workspace: WorkspaceModel }) {
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [reloadId, setReloadId] = useState<string | null>(null);
  const [discardId, setDiscardId] = useState<string | null>(null);
  const watchError = workspace.watchError || workspace.listenerError;
  const tab = workspace.active; const disk = tab?.external;
  const comparison = workspace.tabs.find(item => item.id === compareId);
  const reload = workspace.tabs.find(item => item.id === reloadId);
  const discard = workspace.pendingDrafts.find(item => item.id === discardId);
  useEffect(() => { setCompareId(null); setReloadId(null); }, [workspace.activeId]);
  return <>
    {workspace.sessionError && <div className="reliability-banner reliability-warning session-warning" role="alert"><span title={workspace.sessionError}>工作区记录未完成：{workspace.sessionError}</span><button disabled={workspace.busy || !!workspace.closing} onClick={() => { if (workspace.sessionReady) void workspace.flushSession(); else void workspace.restoreSession(); }}>重试工作区记录</button><button disabled={workspace.busy || !!workspace.closing} onClick={() => void workspace.flushSession(undefined, true)}>以当前工作区重建记录</button></div>}
    {workspace.sessionWarnings.length > 0 && <div className="reliability-banner reliability-warning session-warning" role="status"><span title={workspace.sessionWarnings.join('\n')}>有 {workspace.sessionWarnings.length} 项未能恢复：{workspace.sessionWarnings[0]}</span><button disabled={workspace.busy || !!workspace.closing} onClick={() => void workspace.restoreSession()}>重试恢复</button><button onClick={() => workspace.dismissSessionWarnings()}>关闭提示</button></div>}
    {workspace.pendingDrafts.length > 0 && <div className="reliability-banner" role="status"><span>发现 {workspace.pendingDrafts.length} 份未保存的恢复草稿</span><button onClick={() => setRecoveryOpen(true)}>查看草稿</button></div>}
    {workspace.recoveryError && <div className="reliability-banner reliability-warning" role="alert"><span>草稿保护未完成：{workspace.recoveryError}</span><button disabled={workspace.busy} onClick={() => { if (workspace.recoveryReady) void workspace.flushDrafts(); else void workspace.loadRecovery(); }}>重试草稿保护</button></div>}
    {watchError && <div className="reliability-banner reliability-warning" role="alert"><span>实时监听不可用，仍会定期检查：{watchError}</span><button disabled={workspace.busy} onClick={() => void workspace.checkDisk()}>重新检查</button></div>}
    {workspace.checkError && <div className="reliability-banner reliability-warning" role="alert"><span>磁盘检查未完成：{workspace.checkError}</span><button disabled={workspace.busy} onClick={() => void workspace.checkDisk()}>重试磁盘检查</button></div>}
    {tab && disk && <div className="reliability-banner reliability-warning" role="status"><span>{disk.kind === 'present' ? '磁盘内容已变化，本地修改已保留。' : disk.kind === 'missing' ? '文件已被删除或移动，当前正文已保留。' : `无法读取磁盘文件：${disk.message}`}</span><div>
      {disk.kind === 'present' && <><button disabled={workspace.busy} onClick={() => setCompareId(tab.id)}>对比内容</button><button disabled={workspace.busy} onClick={() => { if (tab.dirty) setReloadId(tab.id); else void workspace.reloadDisk(tab.id); }}>重新载入</button></>}
      {disk.kind !== 'present' && <button disabled={workspace.busy} onClick={() => void workspace.checkDisk()}>重新检查</button>}
      {(tab.editor || tab.source) && <button disabled={workspace.busy} onClick={() => void workspace.save(tab.id, true)}>另存副本</button>}
    </div></div>}
    <Modal open={recoveryOpen && workspace.pendingDrafts.length > 0} title="恢复未保存的草稿" width={620} onCancel={() => setRecoveryOpen(false)} footer={<Button onClick={() => setRecoveryOpen(false)}>稍后处理</Button>}>
      <p className="recovery-description">草稿保存在本机。恢复后先检查正文，再手动保存到文件。</p>
      <div className="recovery-list">{workspace.pendingDrafts.map(draft => <article key={draft.id}>
        <div><strong>{draft.name}</strong><small title={draft.path ?? '未命名文档'}>{draft.path ?? '未命名文档'}</small><small>{new Date(draft.updatedAt).toLocaleString()}</small><pre>{draft.content.slice(0, 180)}</pre></div>
        <div><Button size="small" disabled={workspace.busy} onClick={() => setDiscardId(draft.id)}>丢弃</Button><Button size="small" type="primary" disabled={workspace.busy} onClick={() => void workspace.recoverDraft(draft.id)}>恢复</Button></div>
      </article>)}</div>
      {workspace.recoveryError && <p role="alert" className="dialog-error">{workspace.recoveryError}</p>}
    </Modal>
    <Modal open={!!discard} title="丢弃这份恢复草稿？" onCancel={() => setDiscardId(null)} footer={<div className="leave-actions"><Button onClick={() => setDiscardId(null)}>保留草稿</Button><Button danger disabled={workspace.busy} onClick={async () => { if (discard) await workspace.discardDraft(discard.id); setDiscardId(null); }}>确认丢弃</Button></div>}><p>「{discard?.name}」的恢复记录将被移除，不会修改原文件。</p></Modal>
    <Modal open={!!comparison?.external && comparison.external.kind === 'present'} title="本地修改与磁盘内容" width={1000} onCancel={() => setCompareId(null)} footer={<Button onClick={() => setCompareId(null)}>继续保留本地修改</Button>}>
      {comparison && <div className="disk-comparison"><section><h3>当前编辑内容</h3><pre>{workspace.markdown(comparison)}</pre></section><section><h3>磁盘最新内容</h3><pre>{comparison.external?.content}</pre></section></div>}
    </Modal>
    <Modal open={!!reload} title="重新载入磁盘内容？" onCancel={() => setReloadId(null)} footer={<div className="leave-actions"><Button onClick={() => setReloadId(null)}>保留本地修改</Button><Button danger disabled={workspace.busy} onClick={async () => { if (reload && await workspace.reloadDisk(reload.id)) { setReloadId(null); setCompareId(null); } }}>放弃本地修改并载入</Button></div>}><p>「{reload?.name}」未保存的编辑将被磁盘最新内容替换，此标签的撤销历史会重置。</p></Modal>
  </>;
}
