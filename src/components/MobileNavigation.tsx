import {
  CalendarRange,
  ChartNoAxesGantt,
  Columns3,
  Menu,
  Paperclip,
  PenTool,
} from 'lucide-react';
import type { Project, WorkspaceView } from '../domain/types';
import { useI18n } from '../i18n';

type Props = {
  activeView: WorkspaceView;
  activeProject: Project;
  menuOpen: boolean;
  onOpenMenu: () => void;
  onChangeView: (view: WorkspaceView) => void;
};

const items: Array<{ view: WorkspaceView; label: string; icon: typeof Columns3 }> = [
  { view: 'board', label: 'Work', icon: Columns3 },
  { view: 'timeline', label: 'Timeline', icon: CalendarRange },
  { view: 'canvas', label: 'Canvas', icon: PenTool },
  { view: 'roadmap', label: 'Roadmap', icon: ChartNoAxesGantt },
  { view: 'files', label: 'Files', icon: Paperclip },
];

export function MobileNavigation({ activeView, activeProject, menuOpen, onOpenMenu, onChangeView }: Props) {
  const { t } = useI18n();
  return (
    <>
      <button
        type="button"
        className={`mobile-menu-trigger ${menuOpen ? 'active' : ''}`}
        aria-label={t(menuOpen ? 'Close navigation' : 'Open navigation')}
        aria-expanded={menuOpen}
        onClick={onOpenMenu}
      >
        <Menu size={22} />
        <span><small>{t('Current project')}</small><strong>{activeProject.name}</strong></span>
      </button>
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
