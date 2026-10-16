import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Selection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { renderMermaid, validateMermaid } from './mermaidRenderer';
import './codeBlock.less';

const languages: [string, string][] = [
  ['plaintext', '纯文本'], ['mermaid', 'Mermaid 图表'], ['javascript', 'JavaScript'], ['typescript', 'TypeScript'],
  ['jsx', 'JSX'], ['tsx', 'TSX'], ['json', 'JSON'], ['html', 'HTML'], ['css', 'CSS'], ['less', 'Less'], ['python', 'Python'],
  ['bash', 'Shell'], ['rust', 'Rust'], ['go', 'Go'], ['java', 'Java'], ['c', 'C'], ['cpp', 'C++'], ['csharp', 'C#'],
  ['php', 'PHP'], ['ruby', 'Ruby'], ['swift', 'Swift'], ['kotlin', 'Kotlin'], ['dockerfile', 'Dockerfile'],
  ['sql', 'SQL'], ['yaml', 'YAML'], ['markdown', 'Markdown'], ['xml', 'XML'],
];
const customLanguage = /^[a-zA-Z0-9_+.#-]{1,40}$/;
export const RichCodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div'); dom.className = 'rich-code-block';
      const toolbar = document.createElement('div'); toolbar.className = 'code-block-toolbar'; toolbar.contentEditable = 'false';
      const language = document.createElement('button'); language.type = 'button'; language.className = 'code-language'; language.setAttribute('aria-label', '代码块语言'); language.setAttribute('aria-haspopup', 'listbox');
      const languageMenu = document.createElement('div'); languageMenu.className = 'code-language-menu'; languageMenu.hidden = true;
      const search = document.createElement('input'); search.type = 'text'; search.placeholder = '搜索或输入语言'; search.setAttribute('aria-label', '搜索代码块语言'); search.autocomplete = 'off';
      const options = document.createElement('div'); options.setAttribute('role', 'listbox'); options.setAttribute('aria-label', '代码块语言选项');
      languageMenu.append(search, options);
      const label = document.createElement('span'); label.className = 'code-language-label';
      const views = document.createElement('div'); views.className = 'code-view-options'; views.setAttribute('role', 'group'); views.setAttribute('aria-label', 'Mermaid 视图');
      const graphView = document.createElement('button'); graphView.type = 'button'; graphView.textContent = '图表';
      const sourceView = document.createElement('button'); sourceView.type = 'button'; sourceView.textContent = '源码';
      views.append(graphView, sourceView);
      const sourceToggle = document.createElement('button'); sourceToggle.type = 'button'; sourceToggle.textContent = '查看源码';
      const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = '复制'; copy.title = '复制代码';
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '删除'; remove.setAttribute('aria-label', '删除代码块');
      toolbar.append(language, label, views, sourceToggle, copy, remove, languageMenu);
      const pre = document.createElement('pre'); const code = document.createElement('code'); pre.append(code);
      const preview = document.createElement('div'); preview.className = 'mermaid-preview'; preview.contentEditable = 'false'; preview.setAttribute('aria-live', 'polite');
      dom.append(toolbar, pre, preview);
      let disposed = false; let generation = 0; let timer: ReturnType<typeof setTimeout> | undefined; let copyTimer: ReturnType<typeof setTimeout> | undefined;
      let showingSource = false; let editingGraph = false; let renderedSource = ''; let renderedTheme = false; let failed = false; let lastEditable = editor.isEditable;
      const isMermaid = () => String(node.attrs.language ?? '').toLowerCase() === 'mermaid';
      const closeMenu = () => { languageMenu.hidden = true; language.setAttribute('aria-expanded', 'false'); search.value = ''; };
      const visibility = () => {
        const editable = editor.isEditable;
        language.hidden = !editable; label.hidden = editable; remove.hidden = !editable;
        if (!editable) closeMenu();
        views.hidden = !isMermaid() || !editable;
        sourceToggle.hidden = !isMermaid() || editable;
        sourceToggle.textContent = showingSource ? '隐藏源码' : '查看源码';
        graphView.setAttribute('aria-pressed', String(editingGraph)); sourceView.setAttribute('aria-pressed', String(!editingGraph));
        pre.hidden = isMermaid() && !failed && (editable ? editingGraph : !showingSource);
        preview.hidden = !isMermaid();
        if (isMermaid() && !node.textContent.trim()) preview.textContent = editable ? '输入 Mermaid 源码后预览图表' : '空 Mermaid 图表';
      };
      const update = (immediate = false) => {
        const value = String(node.attrs.language || 'plaintext');
        const caption = languages.find(([key]) => key === value)?.[1] ?? value;
        language.textContent = `${caption} ▾`; label.textContent = caption;
        code.className = `language-${value}`;
        visibility();
        const current = ++generation;
        clearTimeout(timer);
        if (!isMermaid()) { preview.replaceChildren(); failed = false; return; }
        const source = node.textContent; const dark = Boolean(dom.closest('.dark'));
        if (!source.trim()) {
          failed = false; preview.classList.remove('mermaid-error'); preview.textContent = editor.isEditable ? '输入 Mermaid 源码后预览图表' : '空 Mermaid 图表'; visibility(); return;
        }
        if (source === renderedSource && dark === renderedTheme && preview.querySelector('img')) return;
        preview.textContent = '正在绘制图表…'; preview.classList.remove('mermaid-error');
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
      const applyLanguage = (value: string) => {
        if (!editor.isEditable || !customLanguage.test(value)) return;
        const pos = getPos(); closeMenu();
        if (typeof pos === 'number') {
          editingGraph = false; showingSource = false;
          editor.chain().command(({ tr }) => { closeHistory(tr); tr.setNodeMarkup(pos, undefined, { ...node.attrs, language: value }); return true; }).run();
          editor.view.focus();
        }
      };
      const populateLanguages = () => {
        const query = search.value.trim().toLowerCase(); options.replaceChildren();
        const choices = [...languages]; const value = String(node.attrs.language || 'plaintext');
        if (!choices.some(([key]) => key === value)) choices.push([value, value]);
        if (customLanguage.test(query) && !choices.some(([key]) => key.toLowerCase() === query)) choices.push([query, `使用自定义类型：${query}`]);
        for (const [key, caption] of choices.filter(([key, caption]) => `${key} ${caption}`.toLowerCase().includes(query))) {
          const option = document.createElement('button'); option.type = 'button'; option.textContent = caption; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(key === value)); option.dataset.language = key;
          option.addEventListener('mousedown', event => event.preventDefault()); option.addEventListener('click', () => applyLanguage(key)); options.append(option);
        }
        if (!options.childElementCount) options.textContent = '输入语言名称，如 mermaid';
      };
      language.addEventListener('click', () => {
        if (!editor.isEditable) return;
        if (!languageMenu.hidden) { closeMenu(); return; }
        languageMenu.hidden = false; language.setAttribute('aria-expanded', 'true'); populateLanguages();
        const rect = toolbar.getBoundingClientRect(); const below = window.innerHeight - rect.bottom;
        const upward = below < 240 && rect.top > below;
        languageMenu.style.top = upward ? 'auto' : 'calc(100% + 3px)'; languageMenu.style.bottom = upward ? 'calc(100% + 3px)' : 'auto';
        options.style.maxHeight = `${Math.max(60, Math.min(190, (upward ? rect.top : below) - 56))}px`;
        search.focus();
      });
      search.addEventListener('input', populateLanguages);
      search.addEventListener('keydown', event => {
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); editor.view.focus(); }
        if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); const choice = options.querySelector<HTMLButtonElement>('button'); if (choice?.dataset.language) applyLanguage(choice.dataset.language); }
        if (event.key === 'ArrowDown') { event.preventDefault(); options.querySelector<HTMLButtonElement>('button')?.focus(); }
      });
      options.addEventListener('keydown', event => {
        const items = [...options.querySelectorAll<HTMLButtonElement>('button')]; const index = items.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); editor.view.focus(); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
      });
      const dismiss = (event: Event) => { if (!toolbar.contains(event.target as Node)) closeMenu(); };
      document.addEventListener('pointerdown', dismiss);
      toolbar.addEventListener('mousedown', event => { if (!(event.target instanceof HTMLInputElement)) event.preventDefault(); });
      const revealSearch = () => { editingGraph = false; showingSource = true; visibility(); };
      dom.addEventListener('document-search-reveal', revealSearch);
      graphView.addEventListener('click', () => { editingGraph = true; visibility(); graphView.focus(); });
      sourceView.addEventListener('click', () => { editingGraph = false; visibility(); editor.view.focus(); });
      sourceToggle.addEventListener('click', () => { showingSource = !showingSource; visibility(); });
      remove.addEventListener('click', () => {
        if (!editor.isEditable) return;
        const pos = getPos(); if (typeof pos !== 'number') return;
        editor.chain().command(({ tr }) => {
          closeHistory(tr); tr.deleteRange(pos, pos + node.nodeSize);
          tr.setSelection(Selection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size)))); return true;
        }).run(); editor.view.focus();
      });
      copy.addEventListener('click', () => {
        const source = node.textContent;
        void Promise.resolve().then(() => navigator.clipboard.writeText(source)).then(() => { if (!disposed) copy.textContent = '已复制'; }, () => { if (!disposed) copy.textContent = '复制失败'; }).finally(() => {
          if (!disposed) { clearTimeout(copyTimer); copyTimer = setTimeout(() => { copy.textContent = '复制'; }, 1600); }
        });
      });
      const onTransaction = () => { if (lastEditable !== editor.isEditable) { lastEditable = editor.isEditable; visibility(); } };
      editor.on('transaction', onTransaction);
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
      update();
      return {
        dom, contentDOM: code,
        update(next) { if (next.type !== node.type) return false; const changed = next.textContent !== node.textContent || next.attrs.language !== node.attrs.language; if (next.attrs.language !== node.attrs.language) { editingGraph = false; showingSource = false; } node = next; if (changed) update(); else visibility(); return true; },
        stopEvent: event => toolbar.contains(event.target as Node) || preview.contains(event.target as Node),
        ignoreMutation: mutation => mutation.type === 'attributes' || (mutation.type !== 'selection' && !code.contains(mutation.target) && mutation.target !== code),
        destroy() { disposed = true; generation++; clearTimeout(timer); clearTimeout(mounted); clearTimeout(copyTimer); observer?.disconnect(); modeObserver?.disconnect(); dom.removeEventListener('document-search-reveal', revealSearch); document.removeEventListener('pointerdown', dismiss); editor.off('transaction', onTransaction); },
      };
    };
  },
});
