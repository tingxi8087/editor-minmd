import { useEffect, useRef } from 'react';
import { Button } from 'paper-ink';
import { IconPhoto, IconX } from 'paper-ink/icons';
import type { BackgroundModel } from '@/lib/background';
import { desktopAvailable } from '@/lib/files';
import styles from './index.module.less';

export default function BackgroundSettings({ model, onClose }: { model: BackgroundModel; onClose: () => void }) {
  const first = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => { first.current?.focus(); const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !model.busy) close.current(); }; window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape); }, [model]);
  const unavailable = model.busy || !desktopAvailable;
  return <section className={styles.panel} role="dialog" aria-label="背景设置">
    <header><div><strong>纸面背景</strong><span>本地 · 仅本机</span></div><button aria-label="关闭背景设置" title="关闭" disabled={model.busy} onClick={onClose}><IconX size={16} /></button></header>
    <div className={styles.preview} style={model.image ? { backgroundImage: `url(${JSON.stringify(model.image.dataUrl)})` } : undefined}>
      {!model.image && <IconPhoto size={23} stroke={1} />}<span title={model.image?.name}>{model.image?.name ?? '默认纸面'}</span>
    </div>
    <div className={styles.actions}><Button ref={first} size="small" disabled={unavailable} onClick={() => void model.choose()}>{model.busy ? '处理中…' : model.image ? '更换图片' : '选择本地图片'}</Button><Button size="small" type="text" disabled={unavailable} onClick={() => void model.reset()}>恢复默认</Button></div>
    <p className={styles.hint}>PNG / JPEG / WebP · 最多 16 MiB</p>
    <label className={styles.range}><span>背景模糊<output>{model.blur} px</output></span><input aria-label="背景模糊" type="range" min="0" max="24" step="1" value={model.blur} disabled={unavailable || !model.image} onChange={event => model.setOptions({ blur: Number(event.target.value) })} /></label>
    <label className={styles.range}><span>背景遮罩<output>{model.mask}%</output></span><input aria-label="背景遮罩" type="range" min="0" max="90" step="1" value={model.mask} disabled={unavailable || !model.image} onChange={event => model.setOptions({ mask: Number(event.target.value) })} /></label>
    <p className={styles.hint}>正文保持清晰，设置不改变文档内容。</p>
    {!desktopAvailable && <p className={styles.hint}>请在桌面应用中选择本地背景。</p>}
    {model.error ? <div className={styles.error} role="alert"><span>{model.error}</span><button disabled={model.busy || model.saving} onClick={() => void model.retry()}>重试</button></div> : <p className={styles.status} role="status">{model.busy ? '正在处理背景…' : model.saving ? '正在保存设置…' : model.loaded ? '设置已保存在本机' : '尚未载入背景'}</p>}
    {model.warning && <p className={styles.error} role="status">{model.warning}</p>}
  </section>;
}
