// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn(async (_id: string, source: string) => ({ svg: `<svg><text>${source}</text></svg>` })) }));
vi.mock('mermaid', () => ({ default: api }));
import { renderMermaid } from '../src/components/DocumentEditor/mermaidRenderer';

describe('Mermaid renderer isolation', () => {
  it('uses strict inert image output, serializes configuration, caches by theme and never binds callbacks', async () => {
    const [light, dark] = await Promise.all([renderMermaid('graph TD\n开始-->结束', false), renderMermaid('sequenceDiagram\nA->>B: 你好', true)]);
    expect(light).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(decodeURIComponent(light)).toContain('开始'); expect(decodeURIComponent(dark)).toContain('你好');
    expect(api.initialize.mock.calls[0][0]).toMatchObject({ securityLevel: 'strict', htmlLabels: false, theme: 'neutral', startOnLoad: false, maxEdges: 300 });
    expect(api.initialize.mock.calls[1][0]).toMatchObject({ theme: 'dark' });
    const count = api.render.mock.calls.length;
    expect(await renderMermaid('graph TD\n开始-->结束', false)).toBe(light);
    expect(api.render).toHaveBeenCalledTimes(count);
    await renderMermaid('graph TD\n开始-->结束', true); expect(api.render).toHaveBeenCalledTimes(count + 1);
  });
  it('preserves the intrinsic viewBox size so small diagrams are not enlarged', async () => {
    api.render.mockImplementationOnce(async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="-8 -8 170.5 150.2"><text>小图</text></svg>' }));
    const uri = await renderMermaid('graph TD\nSmall-->Diagram', false);
    const image = new DOMParser().parseFromString(decodeURIComponent(uri.split(',')[1]), 'image/svg+xml').documentElement;
    expect(image.getAttribute('width')).toBe('171'); expect(image.getAttribute('height')).toBe('151');
  });
  it('does not load renderer for custom directives, oversized sources or empty input', async () => {
    const count = api.render.mock.calls.length;
    await expect(renderMermaid('%%{init:{}}%%\ngraph TD', false)).rejects.toThrow('配置');
    await expect(renderMermaid('a'.repeat(30_001), false)).rejects.toThrow('30,000');
    await expect(renderMermaid(' ', false)).rejects.toThrow('输入');
    expect(api.render).toHaveBeenCalledTimes(count);
  });
  it('cleans temporary error DOM and continues rendering after a failure', async () => {
    api.render.mockImplementationOnce(async id => {
      const temporary = document.createElement('div'); temporary.id = `d${id}`; document.body.append(temporary);
      throw new Error('bad diagram');
    });
    await expect(renderMermaid('broken diagram', false)).rejects.toThrow('bad diagram');
    expect(document.body.children).toHaveLength(0);
    await expect(renderMermaid('graph TD\nRecovery-->Success', false)).resolves.toContain('data:image/svg+xml');
  });
});
