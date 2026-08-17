export const DEFAULT_SIDEBAR_WIDTH = 260;
export const MIN_SIDEBAR_WIDTH = 220;
export const MIN_WORKSPACE_WIDTH = 640;
export const SIDEBAR_WIDTH_STORAGE_KEY = "diagnostic-teaching.sidebar-width";

export type SidebarWidthStorage = Pick<Storage, "getItem" | "setItem">;
export type SidebarWidthStorageProvider = () => SidebarWidthStorage | null;

export type SidebarWidthBounds = {
  min: number;
  max: number;
};

export function getSidebarWidthBounds(shellWidth: number): SidebarWidthBounds {
  const usableShellWidth = Number.isFinite(shellWidth) ? Math.max(0, shellWidth) : 0;
  return {
    min: MIN_SIDEBAR_WIDTH,
    max: Math.max(MIN_SIDEBAR_WIDTH, Math.floor(usableShellWidth - MIN_WORKSPACE_WIDTH))
  };
}

export function clampSidebarWidth(width: number, shellWidth: number) {
  const bounds = getSidebarWidthBounds(shellWidth);
  const safeWidth = Number.isFinite(width) ? width : DEFAULT_SIDEBAR_WIDTH;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(safeWidth)));
}

export function parseStoredSidebarWidth(value: string | null) {
  if (value === null || value.trim() === "") return DEFAULT_SIDEBAR_WIDTH;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : DEFAULT_SIDEBAR_WIDTH;
}

export function readStoredSidebarWidth(getStorage: SidebarWidthStorageProvider) {
  try {
    return parseStoredSidebarWidth(getStorage()?.getItem(SIDEBAR_WIDTH_STORAGE_KEY) ?? null);
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
  }
}

export function writeStoredSidebarWidth(
  getStorage: SidebarWidthStorageProvider,
  width: number
) {
  try {
    const storage = getStorage();
    if (!storage) return false;
    storage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
    return true;
  } catch {
    return false;
  }
}
