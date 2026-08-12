import {
  CalendarRange,
  ChartNoAxesGantt,
  AlertCircle,
  Check,
  Columns3,
  LoaderCircle,
  Menu,
  Paperclip,
  PenTool,
  Save,
} from 'lucide-react';
import type { Project, WorkspaceView } from '../domain/types';
import { useI18n } from '../i18n';

type SaveState = 'idle' | 'saving' | 'synced' | 'error' | 'local';

type Props = {
  activeView: WorkspaceView;
  activeProject: Project;
  menuOpen: boolean;
  saveState: SaveState;
  dirty: boolean;
  onOpenMenu: () => void;
  onSave: () => void;
  onChangeView: (view: WorkspaceView) => void;
};

const items: Array<{ view: WorkspaceView; label: string; icon: typeof Columns3 }> = [
  { view: 'board', label: 'Work', icon: Columns3 },
  { view: 'timeline', label: 'Timeline', icon: CalendarRange },
  { view: 'canvas', label: 'Canvas', icon: PenTool },
  { view: 'roadmap', label: 'Roadmap', icon: ChartNoAxesGantt },
  { view: 'files', label: 'Files', icon: Paperclip },
];

export function MobileNavigation({ activeView, activeProject, menuOpen, saveState, dirty, onOpenMenu, onSave, onChangeView }: Props) {
  const { t } = useI18n();
  const isSaving = saveState === 'saving';
  const hasSaveError = saveState === 'error';
  const needsSave = dirty && !isSaving;
  const saveLabel = isSaving
    ? t('Saving')
    : hasSaveError
      ? t('Sync needs attention')
      : needsSave
        ? t('Save now')
        : saveState === 'local'
          ? t('Saved locally')
          : t('Saved');
  return (
    <>
      <header className="mobile-app-bar">
        <button
          type="button"
          className={`mobile-menu-trigger ${menuOpen ? 'active' : ''}`}
          aria-label={t(menuOpen ? 'Close navigation' : 'Open navigation')}
          aria-expanded={menuOpen}
          onClick={onOpenMenu}
        ><Menu size={23} /></button>
        <div className="mobile-app-title">
          <strong>Kanbanos</strong>
          <span>{activeProject.name}</span>
        </div>
        <button
          type="button"
          className={`mobile-save-status ${needsSave ? 'dirty' : ''} ${isSaving ? 'saving' : ''} ${hasSaveError ? 'error' : ''}`}
          disabled={isSaving || (!dirty && saveState === 'synced')}
          onClick={onSave}
          aria-label={saveLabel}
          title={saveLabel}
        >
          {isSaving ? <LoaderCircle size={17} /> : hasSaveError ? <AlertCircle size={17} /> : needsSave ? <Save size={17} /> : <Check size={17} />}
          <span>{saveLabel}</span>
        </button>
      </header>
      <nav className="mobile-bottom-nav" aria-label={t('Mobile navigation')}>
        {items.map(({ view, label, icon: Icon }) => {
          const active = view === 'board'
            ? activeView === 'board' || activeView === 'list'
            : activeView === view;
          return (
            <button
              type="button"
              key={view}
              className={active ? 'active' : ''}
              aria-current={active ? 'page' : undefined}
              onClick={() => onChangeView(view)}
            >
              <Icon size={20} />
              <span>{t(label)}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
