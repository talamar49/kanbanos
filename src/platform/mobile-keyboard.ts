import type { KeyboardPlugin } from '@capacitor/keyboard';

type ViewportLike = Pick<VisualViewport, 'height'>;
type KeyboardApi = Pick<KeyboardPlugin, 'addListener'>;

export function setMobileKeyboardOpen(open: boolean, root: HTMLElement = document.documentElement): void {
  root.classList.toggle('keyboard-open', open);
}

export function viewportSuggestsKeyboard(viewport: ViewportLike | null | undefined, innerHeight = window.innerHeight): boolean {
  return Boolean(viewport && innerHeight - viewport.height > 120);
}

export async function bindMobileKeyboardState(
  keyboard: KeyboardApi,
  viewport: VisualViewport | null | undefined = window.visualViewport,
  root: HTMLElement = document.documentElement,
): Promise<() => void> {
  let nativeKeyboardOpen = false;
  const apply = () => setMobileKeyboardOpen(nativeKeyboardOpen || viewportSuggestsKeyboard(viewport), root);
  const show = () => { nativeKeyboardOpen = true; apply(); };
  const hide = () => { nativeKeyboardOpen = false; apply(); };
  const listeners = await Promise.all([
    keyboard.addListener('keyboardWillShow', show),
    keyboard.addListener('keyboardDidShow', show),
    keyboard.addListener('keyboardWillHide', hide),
    keyboard.addListener('keyboardDidHide', hide),
  ]);
  viewport?.addEventListener('resize', apply);
  apply();

  return () => {
    viewport?.removeEventListener('resize', apply);
    setMobileKeyboardOpen(false, root);
    for (const listener of listeners) void listener.remove();
  };
}

export async function installMobileKeyboardHandling(): Promise<() => void> {
  const { Keyboard } = await import('@capacitor/keyboard');
  return bindMobileKeyboardState(Keyboard);
}
