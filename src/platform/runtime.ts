import { Capacitor } from '@capacitor/core';

export const COMPACT_LAYOUT_QUERY = '(max-width: 900px), (pointer: coarse) and (max-height: 600px)';

export function isNativeMobile(): boolean {
  return Capacitor.isNativePlatform() || document.documentElement.classList.contains('native-mobile');
}

export function isCompactLayout(): boolean {
  return isNativeMobile() || window.matchMedia?.(COMPACT_LAYOUT_QUERY).matches === true;
}
