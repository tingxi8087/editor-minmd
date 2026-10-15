import Image, { type ImageOptions } from '@tiptap/extension-image';

export interface ResourceContext {
  image: (src: string) => Promise<string>;
}
export const LocalImage = Image.extend<ImageOptions & { resolve: (src: string) => Promise<string> }>({
  addOptions() { return { ...this.parent!(), resolve: async (src: string) => src }; },
  renderMarkdown(node) {
    const alt = String(node.attrs?.alt ?? '').replace(/[\\[\]]/g, '\\$&');
    const src = String(node.attrs?.src ?? '').replace(/\s/g, char => encodeURIComponent(char)).replace(/\(/g, '%28').replace(/\)/g, '%29');
    const title = String(node.attrs?.title ?? '').replace(/[\\"]/g, '\\$&');
    return `![${alt}](${src}${title ? ` "${title}"` : ''})`;
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span'); dom.className = 'local-image'; dom.contentEditable = 'false';
      const img = document.createElement('img'); const message = document.createElement('span'); message.className = 'image-message';
      dom.append(img, message); let generation = 0;
      const render = (attrs: Record<string, unknown>) => {
        const current = ++generation; img.removeAttribute('src'); img.alt = String(attrs.alt ?? ''); img.title = String(attrs.title ?? '');
        message.textContent = '正在载入图片…'; message.hidden = false;
        const fail = () => { if (current === generation) { img.hidden = true; message.hidden = false; message.textContent = `图片不可用 · ${attrs.alt || attrs.src}`; } };
        img.onload = () => { if (current === generation) { img.hidden = false; message.hidden = true; } }; img.onerror = fail;
        void this.options.resolve(String(attrs.src ?? '')).then(src => { if (current === generation) { img.hidden = false; img.src = src; } }, fail);
      };
      render(node.attrs);
      return { dom, update: next => { if (next.type !== node.type) return false; if (JSON.stringify(next.attrs) !== JSON.stringify(node.attrs)) render(next.attrs); node = next; return true; }, destroy: () => { generation++; img.onload = null; img.onerror = null; } };
    };
  },
});
