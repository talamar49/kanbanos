import type { Project, TaskDraft, WorkItem, WorkspaceAction, WorkspaceDocument } from '../domain/types';
import { TimelineView } from './TimelineView';

type SaveState = 'idle' | 'saving' | 'synced' | 'error' | 'local';

type Props = {
  document: WorkspaceDocument;
  project: Project;
  saveState: SaveState;
  dirty: boolean;
  onOpenTask: (item: WorkItem) => void;
  onCreateTask: (preset?: Partial<TaskDraft>) => void;
  onAction: (action: WorkspaceAction) => void;
  onSave: () => void;
  onEditProject: () => void;
};

/**
 * Native phones use the complete Timeline engine rather than a reduced agenda.
 * The TimelineView owns the contained horizontal chart, compact lanes, drag
 * scheduling, dependencies, and week/month/year ranges.
 */
export function MobileTimelineView(props: Props) {
  return <TimelineView {...props} mobile />;
}
