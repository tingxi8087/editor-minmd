import { describe, expect, it, vi } from 'vitest';
import { BackgroundModel, type BackgroundGateway, type BackgroundView } from '../src/lib/background';
const image = { name: '本地背景.png', dataUrl: 'data:image/png;base64,new' };
const initial: BackgroundView = { blur: 6, mask: 30, image: null };
function setup(value: BackgroundView = { ...initial, image }) {
  const gateway = {
    load: vi.fn<BackgroundGateway['load']>().mockResolvedValue(value), choose: vi.fn<BackgroundGateway['choose']>().mockResolvedValue(null),
    options: vi.fn<BackgroundGateway['options']>().mockResolvedValue(undefined), reset: vi.fn<BackgroundGateway['reset']>().mockResolvedValue(initial),
  };
  return { gateway, model: new BackgroundModel(gateway) };
}
describe('persistent local background', () => {
  it('loads persisted image and options without writing them again', async () => {
    const { model, gateway } = setup({ image, blur: 12, mask: 55 }); expect(await model.load()).toBe(true);
    expect(model.image).toEqual(image); expect([model.blur, model.mask]).toEqual([12, 55]); expect(model.loaded).toBe(true); expect(gateway.options).not.toHaveBeenCalled();
  });
  it('deduplicates concurrent startup loads', async () => {
    const { model, gateway } = setup(); const a = model.load(); const b = model.load(); await Promise.all([a, b]); expect(gateway.load).toHaveBeenCalledTimes(1); expect(model.busy).toBe(false);
  });
  it('previews rapidly changing options immediately and serializes/coalesces persistence to the latest values', async () => {
    const { model, gateway } = setup(); await model.load(); let finish!: () => void;
    gateway.options.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    model.setOptions({ blur: 1 }); model.setOptions({ blur: 10 }); model.setOptions({ mask: 70 });
    expect([model.blur, model.mask]).toEqual([10, 70]); expect(gateway.options).toHaveBeenCalledTimes(1); expect(model.saving).toBe(true);
    finish(); expect(await model.flush()).toBe(true); expect(gateway.options.mock.calls).toEqual([[1, 30], [10, 70]]); expect(model.saving).toBe(false);
  });
  it('keeps preview and desired values on save failure and retries without losing changes', async () => {
    const { model, gateway } = setup(); await model.load(); gateway.options.mockRejectedValueOnce('disk full'); model.setOptions({ blur: 14 });
    expect(await model.flush()).toBe(false); expect(model.blur).toBe(14); expect(model.error).toContain('保存失败');
    expect(await model.retry()).toBe(true); expect(gateway.options).toHaveBeenLastCalledWith(14, 30); expect(model.error).toBe('');
  });
  it('flushes pending options before choosing and cancellation preserves the old background', async () => {
    const { model, gateway } = setup(); await model.load(); model.setOptions({ mask: 60 }); expect(await model.choose()).toBe(false);
    expect(gateway.options).toHaveBeenCalledWith(6, 60); expect(model.image).toEqual(image); expect(model.mask).toBe(60); expect(model.error).toBe('');
  });
  it('retains the previous image on import failure and accepts a successful import', async () => {
    const { model, gateway } = setup(); await model.load(); gateway.choose.mockRejectedValueOnce('bad image'); expect(await model.choose()).toBe(false); expect(model.image).toEqual(image);
    const next = { ...image, name: 'next.jpg', dataUrl: 'data:image/jpeg;base64,next' }; gateway.choose.mockResolvedValueOnce({ image: next, blur: 6, mask: 30 });
    expect(await model.choose()).toBe(true); expect(model.image).toEqual(next); expect(model.error).toBe('');
  });
  it('waits for an earlier option write before resetting and prevents stale options from returning', async () => {
    const { model, gateway } = setup(); await model.load(); let finish!: () => void; gateway.options.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    model.setOptions({ blur: 22 }); const reset = model.reset(); expect(gateway.reset).not.toHaveBeenCalled(); model.setOptions({ mask: 90 }); expect(model.mask).toBe(30);
    finish(); expect(await reset).toBe(true); expect(model.image).toBeNull(); expect([model.blur, model.mask]).toEqual([6, 30]); expect(await model.flush()).toBe(true); expect(gateway.options).toHaveBeenCalledTimes(1);
  });
  it('keeps current settings if restore fails and surfaces cleanup warnings after success', async () => {
    const { model, gateway } = setup(); await model.load(); gateway.reset.mockRejectedValueOnce('permission denied'); expect(await model.reset()).toBe(false); expect(model.image).toEqual(image);
    gateway.reset.mockResolvedValueOnce({ ...initial, cleanupWarning: '旧背景清理失败' }); expect(await model.reset()).toBe(true); expect(model.image).toBeNull(); expect(model.warning).toContain('清理失败');
  });
  it('falls back on unreadable startup state and can recover through explicit reset', async () => {
    const { model, gateway } = setup(); gateway.load.mockRejectedValueOnce('missing asset'); expect(await model.load()).toBe(false); expect(model.image).toBeNull(); expect(model.error).toContain('载入失败');
    expect(await model.reset()).toBe(true); expect(model.loaded).toBe(true); expect(model.error).toBe('');
  });
  it('ignores a stale image error and keeps a safe default surface when the current image fails', async () => {
    const { model } = setup(); await model.load(); model.imageFailed('old-url'); expect(model.image).toEqual(image);
    model.imageFailed(image.dataUrl); expect(model.image).toBeNull(); expect(model.error).toContain('默认纸面'); expect(await model.retry()).toBe(true); expect(model.image).toEqual(image);
  });
  it('clamps nonfinite/out-of-range options and does not write during initial loading or import', async () => {
    const { model, gateway } = setup(); model.setOptions({ blur: 20 }); expect(gateway.options).not.toHaveBeenCalled(); await model.load(); model.setOptions({ blur: 99, mask: -8 }); await model.flush(); expect(gateway.options).toHaveBeenLastCalledWith(24, 0);
    model.setOptions({ blur: NaN, mask: Infinity }); await model.flush(); expect([model.blur, model.mask]).toEqual([6, 30]);
    let finish!: (value: BackgroundView | null) => void; gateway.choose.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); const choose = model.choose(); await vi.waitFor(() => expect(gateway.choose).toHaveBeenCalled());
    expect(await model.reset()).toBe(false); model.setOptions({ blur: 18 }); expect(model.blur).toBe(6); finish(null); await choose;
  });
});
