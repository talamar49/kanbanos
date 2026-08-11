import { describe, expect, it, vi } from 'vitest';
import { bindMobileKeyboardState, setMobileKeyboardOpen, viewportSuggestsKeyboard } from './mobile-keyboard';

describe('mobile keyboard layout state', () => {
  it('marks the document while a native keyboard is open and removes the mark when it closes', async () => {
    const callbacks = new Map<string, () => void>();
    const remove = vi.fn().mockResolvedValue(undefined);
    const addListener = vi.fn(async (event: string, callback: () => void) => {
      callbacks.set(event, callback);
      return { remove };
    });
    const viewport = {
      height: 900,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as VisualViewport;
    const root = document.createElement('html');

    const cleanup = await bindMobileKeyboardState({ addListener } as never, viewport, root);
    callbacks.get('keyboardWillShow')?.();
    expect(root).toHaveClass('keyboard-open');

    callbacks.get('keyboardDidHide')?.();
    expect(root).not.toHaveClass('keyboard-open');

    cleanup();
    expect(remove).toHaveBeenCalledTimes(4);
    expect(viewport.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
  });

  it('uses visual viewport shrinkage as a fallback and leaves unrelated layouts unchanged', () => {
    expect(viewportSuggestsKeyboard({ height: 680 }, 820)).toBe(true);
    expect(viewportSuggestsKeyboard({ height: 760 }, 820)).toBe(false);

    const root = document.createElement('html');
    setMobileKeyboardOpen(true, root);
    expect(root).toHaveClass('keyboard-open');
    setMobileKeyboardOpen(false, root);
    expect(root).not.toHaveClass('keyboard-open');
  });
});
