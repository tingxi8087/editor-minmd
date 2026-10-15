import { create } from "zustand";
import { persist } from "zustand/middleware";
interface Settings { dark: boolean; sidebar: boolean; toggleDark: () => void; toggleSidebar: () => void }
export const useSettings = create<Settings>()(persist((set) => ({
  dark: false, sidebar: true,
  toggleDark: () => set((s) => ({ dark: !s.dark })),
  toggleSidebar: () => set((s) => ({ sidebar: !s.sidebar })),
}), { name: "minmd-appearance" }));
