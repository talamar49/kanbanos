import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = '';
  document.documentElement.dir = '';
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
  document.documentElement.classList.remove('compact-layout', 'native-mobile', 'platform-android', 'platform-ios');
  delete window.kanbanos;
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  writable: true,
  value: ResizeObserverMock,
});

if (!globalThis.PointerEvent) {
  Object.defineProperty(globalThis, 'PointerEvent', {
    configurable: true,
    writable: true,
    value: MouseEvent,
  });
}

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
}

if (!document.elementFromPoint) {
  document.elementFromPoint = vi.fn(() => document.body);
}

const emptyRect = (): DOMRect => ({
  x: 0, y: 0, top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0,
  toJSON: () => ({}),
});

if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = emptyRect;
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = (() => [] as unknown as DOMRectList);

if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
}
