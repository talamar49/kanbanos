import { describe, expect, it, vi } from 'vitest';
import { COMPACT_LAYOUT_QUERY, isCompactLayout } from './runtime';

describe('responsive platform layout', () => {
  it('uses the compact mobile experience for a native app even on a wide device', () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: false,
      media: COMPACT_LAYOUT_QUERY,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });

    expect(isCompactLayout()).toBe(false);
    document.documentElement.classList.add('native-mobile');
    expect(isCompactLayout()).toBe(true);
  });
});
