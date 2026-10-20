import { create } from 'zustand';

/** Which of the sphere's sheets is open. One at a time; the arc itself keeps its own state. */
export type QuickSheet = 'menu' | 'import' | 'quick' | null;

interface QuickActionsState {
  sheet: QuickSheet;
  open(sheet: Exclude<QuickSheet, null>): void;
  close(): void;
}

export const useQuickActions = create<QuickActionsState>((set) => ({
  sheet: null,
  open: (sheet) => set({ sheet }),
  close: () => set({ sheet: null }),
}));
