import { invoke } from '@tauri-apps/api/core';
import { desktopAvailable } from './files';
export interface BackgroundImage { name: string; dataUrl: string }
export interface BackgroundView { blur: number; mask: number; image: BackgroundImage | null; cleanupWarning?: string | null }
export const backgroundGateway = {
  load: () => desktopAvailable ? invoke<BackgroundView>('load_background') : Promise.resolve<BackgroundView>({ blur: 6, mask: 30, image: null }),
  choose: () => invoke<BackgroundView | null>('choose_background'),
  options: (blur: number, mask: number) => invoke<void>('set_background_options', { blur, mask }),
  reset: () => invoke<BackgroundView>('reset_background'),
};
export type BackgroundGateway = typeof backgroundGateway;
const clamp = (value: number, max: number, fallback: number) => Number.isFinite(value) ? Math.round(Math.max(0, Math.min(max, value))) : fallback;

// Background preferences have their own native manifest and never enter document sessions.
export class BackgroundModel {
  image: BackgroundImage | null = null;
  blur = 6; mask = 30; busy = false; saving = false; loaded = false; error = ''; warning = '';
  private revision = 0;
  private listeners = new Set<() => void>();
  private loadTask: Promise<boolean> | null = null;
  private writeTask: Promise<boolean> | null = null;
  private version = 0; private savedVersion = 0;
  constructor(private gateway: BackgroundGateway = backgroundGateway) {}
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  snapshot = () => this.revision;
  private changed() { this.revision++; this.listeners.forEach(fn => fn()); }
  private accept(value: BackgroundView) {
    this.image = value.image; this.blur = clamp(value.blur, 24, 6); this.mask = clamp(value.mask, 90, 30);
    this.version = this.savedVersion = 0; this.loaded = true; this.error = ''; this.warning = value.cleanupWarning ?? '';
  }
  load() {
    if (this.loadTask) return this.loadTask;
    if (this.busy) return Promise.resolve(false);
    this.busy = true; this.changed();
    this.loadTask = this.gateway.load().then(value => { this.accept(value); return true; }).catch(error => { this.image = null; this.error = `背景载入失败：${String(error)}`; return false; }).finally(() => { this.busy = false; this.loadTask = null; this.changed(); });
    return this.loadTask;
  }
  setOptions(patch: { blur?: number; mask?: number }) {
    if (!this.loaded || this.busy) return;
    this.blur = clamp(patch.blur ?? this.blur, 24, 6); this.mask = clamp(patch.mask ?? this.mask, 90, 30);
    this.version++; this.error = ''; this.changed(); void this.flush();
  }
  flush(): Promise<boolean> {
    if (this.writeTask) return this.writeTask;
    if (this.version === this.savedVersion) return Promise.resolve(true);
    this.saving = true; this.changed();
    this.writeTask = (async () => {
      while (this.version !== this.savedVersion) {
        const version = this.version; const blur = this.blur; const mask = this.mask;
        try { await this.gateway.options(blur, mask); this.savedVersion = version; this.error = ''; }
        catch (error) { this.error = `背景设置保存失败：${String(error)}`; return false; }
      }
      return true;
    })().finally(() => { this.saving = false; this.writeTask = null; this.changed(); });
    return this.writeTask;
  }
  async choose() {
    if (this.busy) return false;
    this.busy = true; this.error = ''; this.changed();
    try { if (!await this.flush()) return false; const value = await this.gateway.choose(); if (value) this.accept(value); return !!value; }
    catch (error) { this.error = `背景选择失败：${String(error)}`; return false; }
    finally { this.busy = false; this.changed(); }
  }
  async reset() {
    if (this.busy) return false;
    this.busy = true; this.changed();
    try { if (this.writeTask) await this.writeTask; this.accept(await this.gateway.reset()); return true; }
    catch (error) { this.error = `恢复默认失败：${String(error)}`; return false; }
    finally { this.busy = false; this.changed(); }
  }
  retry() { return this.version !== this.savedVersion ? this.flush() : this.load(); }
  imageFailed(url: string) { if (this.image?.dataUrl === url) { this.image = null; this.error = '背景显示失败，已回到默认纸面；可重试、重新选择或恢复默认。'; this.changed(); } }
}
