// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import WorkspaceSidebar from '../src/components/WorkspaceSidebar';
import { useSettings } from '../src/store/settings';
let available = 1240;
let resize: () => void;
class Observer {
  constructor(callback: () => void) { resize = callback; }
  observe() {} disconnect() {}
}
beforeEach(() => {
  available = 1240; vi.stubGlobal('ResizeObserver', Observer);
  // jsdom lacks pointer events/capture. Preserve all coordinates and pointer IDs.
  class Pointer extends MouseEvent { pointerId: number; constructor(type: string, options: PointerEventInit = {}) { super(type, options); this.pointerId = options.pointerId ?? 1; } }
  vi.stubGlobal('PointerEvent', Pointer);
  HTMLElement.prototype.setPointerCapture = vi.fn(); HTMLElement.prototype.releasePointerCapture = vi.fn();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, available, 800));
  useSettings.setState({ sidebarWidth: 190 });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); useSettings.setState({ sidebarWidth: 190 }); });
function setup() { render(<div><WorkspaceSidebar><button>文件</button><button>大纲</button></WorkspaceSidebar></div>); return screen.getByRole('separator', { name: '调整侧栏宽度' }); }
const down = (handle: HTMLElement, x = 228) => fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: x });
const move = (handle: HTMLElement, x: number) => fireEvent.pointerMove(handle, { pointerId: 1, clientX: x });
const up = (handle: HTMLElement, x: number) => fireEvent.pointerUp(handle, { pointerId: 1, clientX: x });
it('drags in both directions, keeps the final coordinate, persists only on release and restores the pointer styles', () => {
  const handle = setup(); expect(handle.getAttribute('aria-valuenow')).toBe('190');
  down(handle); move(handle, 338);
  expect(handle.getAttribute('aria-valuenow')).toBe('300'); expect(useSettings.getState().sidebarWidth).toBe(190);
  expect(document.documentElement.style.cursor).toBe('col-resize');
  up(handle, 348); expect(useSettings.getState().sidebarWidth).toBe(310);
  expect(JSON.parse(localStorage.getItem('minmd-appearance')!).state.sidebarWidth).toBe(310);
  expect(document.documentElement.style.cursor).toBe(''); expect(document.documentElement.style.userSelect).toBe('');
  down(handle, 348); move(handle, 278); up(handle, 278); expect(useSettings.getState().sidebarWidth).toBe(240);
});
it('clamps both drag limits and keeps at least 320px for the document as the window narrows', () => {
  const handle = setup(); down(handle); move(handle, -100); up(handle, -100); expect(useSettings.getState().sidebarWidth).toBe(160);
  down(handle); move(handle, 5000); up(handle, 5000); expect(useSettings.getState().sidebarWidth).toBe(480);
  act(() => { available = 700; resize(); });
  expect(handle.getAttribute('aria-valuemax')).toBe('342'); expect(handle.getAttribute('aria-valuenow')).toBe('342');
  expect(useSettings.getState().sidebarWidth).toBe(480);
  act(() => { available = 1240; resize(); }); expect(handle.getAttribute('aria-valuenow')).toBe('480');
});
it.each(['Escape', 'cancel', 'lost', 'blur'])('cancels a pending drag on %s without changing the saved width', reason => {
  const handle = setup(); down(handle); move(handle, 400);
  if (reason === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
  if (reason === 'cancel') fireEvent.pointerCancel(handle, { pointerId: 1 });
  if (reason === 'lost') fireEvent.lostPointerCapture(handle, { pointerId: 1 });
  if (reason === 'blur') fireEvent(window, new Event('blur'));
  expect(useSettings.getState().sidebarWidth).toBe(190); expect(handle.getAttribute('aria-valuenow')).toBe('190');
  expect(document.documentElement.style.cursor).toBe('');
});
it('supports keyboard resizing and double-click reset, and ignores secondary pointers/buttons', () => {
  const handle = setup(); fireEvent.keyDown(handle, { key: 'ArrowRight' }); expect(useSettings.getState().sidebarWidth).toBe(200);
  fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true }); expect(useSettings.getState().sidebarWidth).toBe(160);
  fireEvent.keyDown(handle, { key: 'End' }); expect(useSettings.getState().sidebarWidth).toBe(480);
  fireEvent.keyDown(handle, { key: 'Home' }); expect(useSettings.getState().sidebarWidth).toBe(160);
  fireEvent.doubleClick(handle); expect(useSettings.getState().sidebarWidth).toBe(190);
  fireEvent.pointerDown(handle, { pointerId: 2, button: 2, clientX: 100 }); move(handle, 500); expect(handle.getAttribute('aria-valuenow')).toBe('190');
  down(handle); fireEvent.pointerMove(handle, { pointerId: 2, clientX: 500 }); expect(handle.getAttribute('aria-valuenow')).toBe('190');
  up(handle, 228);
});
it('remounts and rehydrates with the saved preference while old/invalid values fall back safely', async () => {
  setup(); act(() => useSettings.getState().setSidebarWidth(328));
  const saved = localStorage.getItem('minmd-appearance')!; cleanup();
  useSettings.setState({ sidebarWidth: 190 }); localStorage.setItem('minmd-appearance', saved);
  await act(async () => { await useSettings.persist.rehydrate(); });
  const handle = setup(); expect(handle.getAttribute('aria-valuenow')).toBe('328');
  act(() => useSettings.setState({ sidebarWidth: undefined as unknown as number })); expect(handle.getAttribute('aria-valuenow')).toBe('190');
  down(handle); move(handle, 400); cleanup(); expect(document.documentElement.style.cursor).toBe('');
});
