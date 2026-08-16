import { Fragment, useEffect, useRef } from 'react';
import { Keyboard, X } from 'lucide-react';
import { useI18n } from '../i18n';

type Props = {
  onClose: () => void;
};

type Shortcut = {
  label: string;
  combinations: string[][];
};

function ShortcutKeys({ combinations }: Pick<Shortcut, 'combinations'>) {
  const { t } = useI18n();
  return (
    <span className="shortcut-keys" dir="ltr">
      {combinations.map((keys, combinationIndex) => (
        <Fragment key={keys.join('+')}>
          {combinationIndex > 0 && <small>{t('or')}</small>}
          <span>
            {keys.map((key, keyIndex) => (
              <Fragment key={key}>
                {keyIndex > 0 && <i>+</i>}
                <kbd>{key}</kbd>
              </Fragment>
            ))}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

function ShortcutGroup({ title, shortcuts }: { title: string; shortcuts: Shortcut[] }) {
  return (
    <section className="shortcut-group">
      <h3>{title}</h3>
      <ul>
        {shortcuts.map((shortcut) => (
          <li key={shortcut.label}>
            <span>{shortcut.label}</span>
            <ShortcutKeys combinations={shortcut.combinations} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function KeyboardShortcutsDialog({ onClose }: Props) {
  const { t } = useI18n();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const modifierKey = /Mac|iPhone|iPad|iPod/.test(window.navigator.platform) ? '⌘' : 'Ctrl';
  const generalShortcuts: Shortcut[] = [
    { label: t('Quick-create a task'), combinations: [['C']] },
    { label: t('Save workspace'), combinations: [[modifierKey, 'S']] },
    { label: t('Create a task or finish editing'), combinations: [[modifierKey, 'Enter']] },
    { label: t('Show keyboard shortcuts'), combinations: [['?']] },
    { label: t('Close an open dialog'), combinations: [['Esc']] },
  ];
  const canvasShortcuts: Shortcut[] = [
    { label: t('Select tool'), combinations: [['V']] },
    { label: t('Pen tool'), combinations: [['P']] },
    { label: t('Add a note'), combinations: [['N']] },
    { label: t('Open task library'), combinations: [['T']] },
    { label: t('Open file library'), combinations: [['F']] },
    { label: t('Pan the canvas'), combinations: [['Space']] },
    { label: t('Duplicate selected item'), combinations: [[modifierKey, 'D']] },
    { label: t('Delete selected items'), combinations: [['Delete'], ['Backspace']] },
    { label: t('Fit canvas to screen'), combinations: [['0']] },
    { label: t('Zoom in or out'), combinations: [['+'], ['−']] },
  ];

  useEffect(() => {
    previousFocusRef.current = window.document.activeElement instanceof HTMLElement
      ? window.document.activeElement
      : null;
    closeButtonRef.current?.focus();
    return () => {
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus();
    };
  }, []);

  return (
    <div
      className="modal-backdrop shortcuts-backdrop fade-in"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="shortcuts-modal modal-enter"
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-shortcuts-title"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          } else if (event.key === 'Tab') {
            event.preventDefault();
            closeButtonRef.current?.focus();
          }
        }}
      >
        <header className="shortcuts-header">
          <span className="shortcuts-icon"><Keyboard size={24} /></span>
          <div>
            <small>{t('Help & shortcuts')}</small>
            <h2 id="keyboard-shortcuts-title">{t('Keyboard shortcuts')}</h2>
            <p>{t('Keep your hands on the keyboard and move through work faster.')}</p>
          </div>
          <button ref={closeButtonRef} className="icon-button" onClick={onClose} aria-label={t('Close')}><X size={20} /></button>
        </header>
        <div className="shortcuts-body">
          <ShortcutGroup title={t('General')} shortcuts={generalShortcuts} />
          <ShortcutGroup title={t('Canvas')} shortcuts={canvasShortcuts} />
        </div>
        <footer>{t('Single-key shortcuts are paused while you type in a field.')}</footer>
      </section>
    </div>
  );
}
