// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { editorExtensions } from '../src/components/DocumentEditor/extensions';
const editors: Editor[] = [];
function setup() {
  const element = document.createElement('div'); document.body.append(element);
  const editor = new Editor({ element, extensions: editorExtensions(), content: '' });
  editors.push(editor); return { editor, element };
}
afterEach(() => { editors.splice(0).forEach(editor => editor.destroy()); document.body.replaceChildren(); });
describe('Empty editor hints', () => {
  it('never decorates the empty code block toolbar with the document hint', () => {
    const { editor, element } = setup();
    editor.commands.setCodeBlock();
    const block = element.querySelector('.rich-code-block')!;
    expect(block.getAttribute('data-placeholder') ?? '').toBe('');
    expect(block.querySelectorAll('[data-placeholder]').length).toBe(0);
  });
  it('only shows the document hint on the empty top-level paragraph', () => {
    const { editor, element } = setup();
    expect(element.querySelector('p')?.getAttribute('data-placeholder')).toContain('输入 /');
    editor.commands.insertTable({rows: 2, cols: 2, withHeaderRow: true});
    expect([...element.querySelectorAll('th [data-placeholder],td [data-placeholder]')].some(node => node.getAttribute('data-placeholder'))).toBe(false);
    editor.commands.setContent(''); editor.setEditable(false);
    expect(element.querySelector('[data-placeholder]')).toBeNull();
  });
});

describe('Code block boundaries', () => {
  it('can insert a paragraph after the last block and before the first block', () => {
    const { editor } = setup();
    editor.commands.setContent({type:'doc',content:[{type:'codeBlock',attrs:{language:'javascript'},content:[{type:'text',text:'x'}]}]});
    editor.commands.setTextSelection(2);
    expect(editor.commands.exitCode()).toBe(true);
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
    expect(editor.state.doc.child(0).textContent).toBe('x');
    editor.commands.setTextSelection(1);
    editor.commands.keyboardShortcut('ArrowUp');
    expect(editor.getJSON().content?.[0].type).toBe('paragraph');
    expect(editor.getJSON().content?.[1].type).toBe('codeBlock');
  });
  it('exits a block on a second empty line without discarding its text', () => {
    const { editor } = setup();
    editor.commands.setContent({type:'doc',content:[{type:'codeBlock',attrs:{language:'javascript'},content:[{type:'text',text:'x\n\n'}]}]});
    editor.commands.setTextSelection(4);
    editor.commands.keyboardShortcut('Enter');
    expect(editor.getJSON().content?.map(node=>node.type)).toEqual(['codeBlock','paragraph']);
    expect(editor.state.doc.child(0).textContent).toBe('x');
  });
});
