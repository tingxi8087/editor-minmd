// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RecentEntries, { type RecentEntriesProps } from '../src/components/RecentEntries';

const file = { name: '草稿.md', path: '/Users/tingxi/文档/草稿.md' };
const directory = { name: '项目', path: '/Users/tingxi/工作/项目' };
const setup = (options: Partial<RecentEntriesProps> = {}) => {
  const props = { files: [file], directories: [directory], busy: false, onOpen: vi.fn(), onRemove: vi.fn(), onClear: vi.fn(), onClose: vi.fn(), ...options };
  return { ...render(<RecentEntries {...props} />), props };
};
afterEach(() => cleanup());

describe('compact recent entries', () => {
  it('separates files and directories, shows names and parents, exposes exact full paths', () => {
    setup();
    const files = screen.getByRole('region', { name: '最近文件' });
    const directories = screen.getByRole('region', { name: '最近目录' });
    const fileButton = within(files).getByRole('button', { name: '打开文件 草稿.md' });
    expect(fileButton.title).toBe(file.path);
    expect(files.textContent).toContain('/Users/tingxi/文档');
    expect(within(directories).getByRole('button', { name: '打开目录 项目' }).title).toBe(directory.path);
    expect(directories.textContent).toContain('/Users/tingxi/工作');
    expect(document.activeElement).toBe(fileButton);
  });

  it('opens each kind and keeps the panel open until its owner closes it', async () => {
    const { props } = setup(); const user = userEvent.setup();
    await user.keyboard('{Enter}');
    expect(props.onOpen).toHaveBeenNthCalledWith(1, file, false);
    await user.click(screen.getByRole('button', { name: '打开目录 项目' }));
    expect(props.onOpen).toHaveBeenNthCalledWith(2, directory, true);
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '最近打开' })).toBeTruthy();
  });

  it('removes individual history records without opening them, and clears all history', async () => {
    const { props } = setup(); const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '移除文件记录 草稿.md' }));
    await user.click(screen.getByRole('button', { name: '移除目录记录 项目' }));
    expect(props.onRemove).toHaveBeenNthCalledWith(1, file, false);
    expect(props.onRemove).toHaveBeenNthCalledWith(2, directory, true);
    await user.click(screen.getByRole('button', { name: '清空记录' }));
    expect(props.onClear).toHaveBeenCalledOnce();
    expect(props.onOpen).not.toHaveBeenCalled();
    expect(screen.getByText('清除记录不会删除本地文件')).toBeTruthy();
  });

  it('closes using Escape, its close button and outside pointer, while keeping inside clicks open', () => {
    const { props } = setup();
    fireEvent.pointerDown(screen.getByRole('button', { name: '打开文件 草稿.md' }));
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape', isComposing: true });
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '关闭最近打开' }));
    fireEvent.pointerDown(document.body);
    expect(props.onClose).toHaveBeenCalledTimes(3);
  });

  it('does not handle its trigger as an outside pointer or steal focus from a different target', () => {
    const onClose = vi.fn();
    const props = { files: [file], directories: [], busy: false, onOpen: vi.fn(), onRemove: vi.fn(), onClear: vi.fn(), onClose };
    const { unmount } = render(<div><button>最近打开入口</button><RecentEntries {...props} /></div>);
    fireEvent.pointerDown(screen.getByRole('button', { name: '最近打开入口' }));
    expect(onClose).not.toHaveBeenCalled();
    const outside = document.createElement('button'); document.body.append(outside); outside.focus();
    unmount(); expect(document.activeElement).toBe(outside); outside.remove();
    fireEvent.pointerDown(document.body); fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('allows keyboard access to removing records and restores its trigger on unmount', async () => {
    const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
    const { props, unmount } = setup(); const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '移除文件记录 草稿.md' }));
    await user.keyboard('{Enter}'); expect(props.onRemove).toHaveBeenCalledWith(file, false);
    unmount(); expect(document.activeElement).toBe(trigger); trigger.remove();
  });

  it('shows independent empty groups and disables clear only when both are empty', () => {
    const { rerender, props } = setup({ files: [], directories: [] });
    expect(screen.getByText('暂无最近文件')).toBeTruthy(); expect(screen.getByText('暂无最近目录')).toBeTruthy();
    expect((screen.getByRole('button', { name: '清空记录' }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭最近打开' }));
    rerender(<RecentEntries {...props} directories={[directory]} />);
    expect((screen.getByRole('button', { name: '清空记录' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables opening and history changes while busy but still permits closing', async () => {
    const { props } = setup({ busy: true }); const user = userEvent.setup();
    expect(screen.getByRole('dialog').getAttribute('aria-busy')).toBe('true');
    for (const button of screen.getAllByRole('button').filter(button => button.getAttribute('aria-label') !== '关闭最近打开')) {
      expect((button as HTMLButtonElement).disabled).toBe(true); await user.click(button);
    }
    expect(props.onOpen).not.toHaveBeenCalled(); expect(props.onRemove).not.toHaveBeenCalled(); expect(props.onClear).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '关闭最近打开' })); expect(props.onClose).toHaveBeenCalledOnce();
  });

  it('keeps failed records accessible for retry or removal and renders the native error as text', () => {
    const error = '无法打开 /不存在/<文件>.md：文件不存在'; setup({ error });
    expect(screen.getByRole('alert').textContent).toBe(error);
    fireEvent.click(screen.getByRole('button', { name: '移除文件记录 草稿.md' }));
    expect(screen.getByRole('button', { name: '打开文件 草稿.md' })).toBeTruthy();
  });

  it('handles long names, Windows parent paths and root-level paths without corrupting full paths', () => {
    const name = '长文件名'.repeat(50) + '.md';
    const path = `C:\\Users\\中文\\${name}`;
    setup({ files: [{ name, path }, { name: 'root.md', path: '/root.md' }], directories: [] });
    expect(screen.getByRole('button', { name: `打开文件 ${name}` }).title).toBe(path);
    expect(screen.getByText('C:\\Users\\中文')).toBeTruthy();
    expect(screen.getByText('/')).toBeTruthy();
  });
});
