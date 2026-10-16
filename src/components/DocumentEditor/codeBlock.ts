import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { renderMermaid, validateMermaid } from './mermaidRenderer';
import './codeBlock.less';

const languages: [string, string][] = [
  ['plaintext', '纯文本'], ['mermaid', 'Mermaid 图表'], ['javascript', 'JavaScript'], ['typescript', 'TypeScript'],
  ['jsx', 'JSX'], ['tsx', 'TSX'], ['json', 'JSON'], ['html', 'HTML'], ['css', 'CSS'], ['python', 'Python'],
  ['bash', 'Shell'], ['rust', 'Rust'], ['go', 'Go'], ['java', 'Java'], ['c', 'C'], ['cpp', 'C++'],
  ['sql', 'SQL'], ['yaml', 'YAML'], ['markdown', 'Markdown'], ['xml', 'XML'],
];
export const RichCodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div'); dom.className = 'rich-code-block';
      const toolbar = document.createElement('div'); toolbar.className = 'code-block-toolbar'; toolbar.contentEditable = 'false';
      const language = document.createElement('select'); language.setAttribute('aria-label', '代码块语言');
      for (const [value, label] of languages) language.add(new Option(label, value));
      const label = document.createElement('span');
      const sourceToggle = document.createElement('button'); sourceToggle.type = 'button'; sourceToggle.textContent = '查看源码';
      const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = '复制'; copy.title = '复制代码';
      toolbar.append(language, label, sourceToggle, copy);
      const pre = document.createElement('pre'); const code = document.createElement('code'); pre.append(code);
      const preview = document.createElement('div'); preview.className = 'mermaid-preview'; preview.contentEditable = 'false'; preview.setAttribute('aria-live', 'polite');
      dom.append(toolbar, pre, preview);
      let disposed = false; let generation = 0; let timer: ReturnType<typeof setTimeout> | undefined; let copyTimer: ReturnType<typeof setTimeout> | undefined;
      let showingSource = false; let renderedSource = ''; let renderedTheme = false; let failed = false; let lastEditable = editor.isEditable;
      const isMermaid = () => String(node.attrs.language ?? '').toLowerCase() === 'mermaid';
      const visibility = () => {
        const editable = editor.isEditable;
        language.hidden = !editable; label.hidden = editable;
        sourceToggle.hidden = !isMermaid() || editable;
        sourceToggle.textContent = showingSource ? '隐藏源码' : '查看源码';
        pre.hidden = isMermaid() && !editable && !showingSource && !failed;
        preview.hidden = !isMermaid();
      };
      const update = (immediate = false) => {
        const value = String(node.attrs.language || 'plaintext');
        if (![...language.options].some(option => option.value === value)) language.add(new Option(value, value));
        language.value = value; label.textContent = value === 'plaintext' ? '纯文本' : value;
        code.className = `language-${value}`;
        visibility();
        const current = ++generation;
        clearTimeout(timer);
        if (!isMermaid()) { preview.replaceChildren(); return; }
        const source = node.textContent; const dark = Boolean(dom.closest('.dark'));
        if (source === renderedSource && dark === renderedTheme && preview.querySelector('img')) return;
        preview.textContent = '正在绘制图表…';
        const run = async () => {
          try {
            validateMermaid(source);
            const uri = await renderMermaid(source, dark);
            if (disposed || generation !== current) return;
            const img = document.createElement('img'); img.alt = 'Mermaid 图表'; img.src = uri;
            preview.replaceChildren(img); preview.classList.remove('mermaid-error');
            renderedSource = source; renderedTheme = dark; failed = false; visibility();
          } catch (error) {
            if (disposed || generation !== current) return;
            failed = true; preview.classList.add('mermaid-error');
            const detail = error instanceof Error ? error.message : String(error);
            preview.textContent = `图表暂时无法预览：${detail.slice(0, 240)}`; visibility();
          }
        };
        timer = setTimeout(() => { void run(); }, immediate ? 0 : 250);
      };
      language.addEventListener('change', () => {
        if (!editor.isEditable) return;
        const pos = getPos();
        if (typeof pos === 'number') editor.chain().command(({ tr }) => { tr.setNodeMarkup(pos, undefined, { ...node.attrs, language: language.value }); return true; }).run();
      });
      sourceToggle.addEventListener('click', () => { showingSource = !showingSource; visibility(); });
      copy.addEventListener('click', () => {
        const source = node.textContent;
        void Promise.resolve().then(() => navigator.clipboard.writeText(source)).then(() => { if (!disposed) copy.textContent = '已复制'; }, () => { if (!disposed) copy.textContent = '复制失败'; }).finally(() => {
          if (!disposed) { clearTimeout(copyTimer); copyTimer = setTimeout(() => { copy.textContent = '复制'; }, 1600); }
        });
      });
      const onTransaction = () => { if (lastEditable !== editor.isEditable) { lastEditable = editor.isEditable; visibility(); } };
      editor.on('transaction', onTransaction);
      // The node is not connected yet at creation; observe the app after mounting.
      let observer: MutationObserver | undefined;
      let modeObserver: MutationObserver | undefined;
      const mounted = setTimeout(() => {
        if (disposed) return;
        modeObserver = new MutationObserver(visibility);
        modeObserver.observe(editor.view.dom, { attributes: true, attributeFilter: ['contenteditable'] });
        const workspace = dom.closest('.workspace');
        if (workspace) { observer = new MutationObserver(() => update()); observer.observe(workspace, { attributes: true, attributeFilter: ['class'] }); }
        update(true);
      }, 0);
      visibility();
      return {
        dom, contentDOM: code,
        update(next) { if (next.type !== node.type) return false; const changed = next.textContent !== node.textContent || next.attrs.language !== node.attrs.language; node = next; if (changed) update(); else visibility(); return true; },
        stopEvent: event => toolbar.contains(event.target as Node) || preview.contains(event.target as Node),
        ignoreMutation: mutation => mutation.type === 'attributes' || (mutation.type !== 'selection' && !code.contains(mutation.target) && mutation.target !== code),
        destroy() { disposed = true; generation++; clearTimeout(timer); clearTimeout(mounted); clearTimeout(copyTimer); observer?.disconnect(); modeObserver?.disconnect(); editor.off('transaction', onTransaction); },
      };
    };
  },
});
