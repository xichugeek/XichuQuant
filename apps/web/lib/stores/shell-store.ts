"use client";

import { create } from "zustand";

type ShellState = {
  mobileNavigationOpen: boolean;
  setMobileNavigationOpen: (open: boolean) => void;
};

export const useShellStore = create<ShellState>((set) => ({
  mobileNavigationOpen: false,
  setMobileNavigationOpen: (mobileNavigationOpen) => set({ mobileNavigationOpen }),
}));
