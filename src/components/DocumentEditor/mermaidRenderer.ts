/** Rendering is serialized because Mermaid's configuration and render DOM are global. */
export const MAX_MERMAID_LENGTH = 30_000;
const cache = new Map<string, string>();
let queue: Promise<unknown> = Promise.resolve();
let sequence = 0;

export function validateMermaid(source: string) {
  if (!source.trim()) throw new Error('请先输入 Mermaid 图表源码');
  if (source.length > MAX_MERMAID_LENGTH) throw new Error('图表源码超过 30,000 字符，请精简后预览');
  // Per-document config can inject CSS, enable external images, or change renderer behaviour.
  // Keep ordinary diagram syntax; do not apply user supplied configuration directives.
  if (/%%\s*\{|^\s*---(?:\r?\n|$)/m.test(source)) throw new Error('图表预览不支持自定义配置指令或 frontmatter');
}

export function renderMermaid(source: string, dark: boolean): Promise<string> {
  try { validateMermaid(source); } catch (error) { return Promise.reject(error); }
  const key = `${dark ? 'dark' : 'light'}:${source}`;
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  const task = queue.then(async () => {
    const again = cache.get(key);
    if (again) return again;
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({
      startOnLoad: false, securityLevel: 'strict', htmlLabels: false,
      suppressErrorRendering: true, maxTextSize: MAX_MERMAID_LENGTH, maxEdges: 300,
      theme: dark ? 'dark' : 'neutral', fontFamily: 'PingFang SC, sans-serif',
      secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'suppressErrorRendering', 'htmlLabels', 'themeCSS', 'dompurifyConfig'],
    });
    const id = `minmd-mermaid-${++sequence}`;
    try {
      const { svg } = await mermaid.render(id, source);
      // An SVG image is an inert image context: no scripts, handlers, links, foreign
      // HTML or external subresources are mounted in the editor's document.
      // Mermaid emits width=100%; an SVG used as an image otherwise falls back
      // to the browser's default 300px sizing and can enlarge a tiny diagram.
      const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
      const box = root.getAttribute('viewBox')?.trim().split(/[ ,]+/).map(Number);
      let image = svg;
      if (root.localName === 'svg' && box?.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0) {
        root.setAttribute('width', String(Math.ceil(box[2])));
        root.setAttribute('height', String(Math.ceil(box[3])));
        image = new XMLSerializer().serializeToString(root);
      }
      const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(image)}`;
      cache.set(key, uri);
      while (cache.size > 24) cache.delete(cache.keys().next().value!);
      return uri;
    } finally {
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
    }
  });
  queue = task.catch(() => {});
  return task;
}
