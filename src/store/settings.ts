import { create } from "zustand";
import { persist } from "zustand/middleware";
export type MarkdownMode = "document" | "reading" | "source";
export const DEFAULT_SIDEBAR_WIDTH = 190;
export const MIN_SIDEBAR_WIDTH = 160;
export const MAX_SIDEBAR_WIDTH = 480;
export function normalizeSidebarWidth(width: number) {
  return Number.isFinite(width) ? Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, Math.round(width))) : DEFAULT_SIDEBAR_WIDTH;
}
interface Settings { sidebarWidth: number; setSidebarWidth: (width: number) => void; markdownMode: MarkdownMode; setMarkdownMode: (mode: MarkdownMode) => void; dark: boolean; sidebar: boolean; toggleDark: () => void; toggleSidebar: () => void }
export const useSettings = create<Settings>()(persist((set) => ({
  dark: false, sidebar: true, sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  setSidebarWidth: (width) => set({ sidebarWidth: normalizeSidebarWidth(width) }), markdownMode: "document",
  setMarkdownMode: (markdownMode) => set({ markdownMode }),
  toggleDark: () => set((s) => ({ dark: !s.dark })),
  toggleSidebar: () => set((s) => ({ sidebar: !s.sidebar })),
}), { name: "minmd-appearance" }));

export function preferredMarkdownMode(): MarkdownMode {
  const mode = useSettings.getState().markdownMode;
  return mode === "reading" || mode === "source" ? mode : "document";
}
