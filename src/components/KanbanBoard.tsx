import { Fragment, type CSSProperties, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  closestCorners,
  DndContext,
  DragEndEvent,
  DragMoveEvent,
  DragOverlay,
  DragOverEvent,
  DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { CollisionDetection, KeyboardCoordinateGetter } from '@dnd-kit/core';
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Columns3,
  Ellipsis,
  Filter,
  GripVertical,
  LayoutGrid,
  ListFilter,
  Plus,
  Search,
  Sparkles,
  Rows3,
  X,
} from 'lucide-react';
import type { KanbanColumn, KanbanColumnRule, Priority, Project, TaskDraft, WorkItem, WorkspaceAction, WorkspaceDocument, WorkspaceView } from '../domain/types';
import { columnForRule, createWorkItem, itemsForColumn, KANBAN_COLUMN_RULES, PRIORITY_META } from '../domain/workspace';
import { useI18n } from '../i18n';
import { useCompactLayout } from '../platform/useCompactLayout';
import { PreferencesControls } from './PreferencesControls';
import { ProjectScopeSelect, type ProjectScope } from './ProjectScopeSelect';
import { TaskCard } from './TaskCard';

type SaveState = 'idle' | 'saving' | 'synced' | 'error' | 'local';

type ColumnMenuPosition = {
  top: number;
  left: number;
};

const COLUMN_MENU_WIDTH = 340;
const COLUMN_MENU_GUTTER = 12;
const COLUMN_MENU_OFFSET = 5;

function columnMenuPosition(bounds: DOMRect, direction: 'ltr' | 'rtl'): ColumnMenuPosition {
  const width = Math.min(COLUMN_MENU_WIDTH, window.innerWidth - COLUMN_MENU_GUTTER * 2);
  const preferredLeft = direction === 'rtl' ? bounds.left : bounds.right - width;
  return {
    top: bounds.bottom + COLUMN_MENU_OFFSET,
    left: Math.max(COLUMN_MENU_GUTTER, Math.min(preferredLeft, window.innerWidth - width - COLUMN_MENU_GUTTER)),
  };
}

const boardCollisionDetection: CollisionDetection = (args) => {
  if (args.active.data.current?.type === 'column') {
    return closestCorners({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (container) => container.data.current?.type === 'column',
      ),
    });
  }

  if (!args.pointerCoordinates) return closestCorners(args);

  const collisions = pointerWithin(args);
  const containerFor = (id: string | number) => args.droppableContainers.find((container) => container.id === id);
  const hoveredColumn = collisions.find((collision) => containerFor(collision.id)?.data.current?.type === 'column');
  const columnId = hoveredColumn ? containerFor(hoveredColumn.id)?.data.current?.columnId : undefined;
  const belongsToHoveredColumn = (id: string | number) => (
    columnId === undefined || containerFor(id)?.data.current?.columnId === columnId
  );
  const hoveredPreview = collisions.find((collision) => (
    containerFor(collision.id)?.data.current?.type === 'task-preview' && belongsToHoveredColumn(collision.id)
  ));
  const itemCollisions = collisions.filter((collision) => (
    containerFor(collision.id)?.data.current?.type === 'item' && belongsToHoveredColumn(collision.id)
  ));
  const hoveredItem = itemCollisions.find((collision) => collision.id !== args.active.id) ?? itemCollisions[0];
  const hoveredPlacement = hoveredPreview ?? hoveredItem;
  if (hoveredPlacement) {
    return [hoveredPlacement, ...collisions.filter((collision) => collision.id !== hoveredPlacement.id)];
  }

  if (!hoveredColumn) return closestCorners(args);
  const columnItems = args.droppableContainers.filter((container) => (
    (container.data.current?.type === 'item' || container.data.current?.type === 'task-preview')
    && container.data.current.columnId === columnId
  ));
  const closestItem = closestCorners({ ...args, droppableContainers: columnItems })[0];
  return closestItem
    ? [closestItem, hoveredColumn, ...collisions.filter((collision) => collision.id !== hoveredColumn.id)]
    : collisions;
};

const boardKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  if (args.context.active?.data.current?.type !== 'column') {
    return sortableKeyboardCoordinates(event, args);
  }
  const source = args.context.droppableContainers;
  const enabledColumns = () => source.getEnabled().filter(
    (container) => container.data.current?.type === 'column',
  );
  const droppableContainers = new Map(source) as typeof source;
  droppableContainers.getEnabled = enabledColumns;
  droppableContainers.toArray = enabledColumns;
  droppableContainers.getNodeFor = source.getNodeFor.bind(source);
  return sortableKeyboardCoordinates(event, {
    ...args,
    context: { ...args.context, droppableContainers },
  });
};

type Props = {
  document: WorkspaceDocument;
  project: Project;
  saveState: SaveState;
  dirty: boolean;
  onAction: (action: WorkspaceAction) => void;
  onOpenTask: (item: WorkItem) => void;
  onCreateTask?: (preset?: Partial<TaskDraft>) => void;
  onSave: () => void;
  onEditProject: () => void;
  onChangeView: (view: WorkspaceView) => void;
};

type TaskDropPreviewState = {
  itemId: string;
  columnId: string;
  index: number;
  beforeItemId?: string;
};

type TaskDragEvent = DragMoveEvent | DragOverEvent | DragEndEvent;

function activatorClientY(event: Event): number | undefined {
  if ('clientY' in event && typeof event.clientY === 'number') return event.clientY;
  if ('touches' in event) {
    const touchEvent = event as TouchEvent;
    return (touchEvent.touches[0] ?? touchEvent.changedTouches[0])?.clientY;
  }
  return undefined;
}

function isBelowHoveredItem(event: TaskDragEvent): boolean {
  if (!event.over) return false;
  const midpoint = event.over.rect.top + event.over.rect.height / 2;
  const clientY = activatorClientY(event.activatorEvent);
  const initial = event.active.rect.current.initial;
  const translated = event.active.rect.current.translated;
  if (clientY !== undefined && initial && translated) {
    return translated.top + (clientY - initial.top) > midpoint;
  }
  return translated ? translated.top + translated.height / 2 > midpoint : false;
}

function taskDropIndex(event: TaskDragEvent, itemId: string, targetItems: WorkItem[]): number {
  const destinationItems = targetItems.filter((item) => item.id !== itemId);
  const overData = event.over?.data.current as { type?: string; index?: number } | undefined;
  if (overData?.type === 'task-preview') {
    return Math.max(0, Math.min(overData.index ?? destinationItems.length, destinationItems.length));
  }
  if (overData?.type !== 'item') return destinationItems.length;

  const overId = String(event.over?.id);
  if (overId === itemId) {
    const originalIndex = targetItems.findIndex((item) => item.id === itemId);
    return Math.max(0, Math.min(originalIndex, destinationItems.length));
  }

  const overIndex = destinationItems.findIndex((item) => item.id === overId);
  if (overIndex < 0) return destinationItems.length;
  return overIndex + (isBelowHoveredItem(event) ? 1 : 0);
}

type ColumnProps = {
  column: KanbanColumn;
  items: WorkItem[];
  projectId: string;
  allColumns: KanbanColumn[];
  projectById: ReadonlyMap<string, Project>;
  collapsedSubtaskItemIds: ReadonlySet<string>;
  aggregate: boolean;
  dropPreview?: TaskDropPreviewState & { item: WorkItem };
  onAction: (action: WorkspaceAction) => void;
  onOpenTask: (item: WorkItem) => void;
  onCreateTask?: (preset?: Partial<TaskDraft>) => void;
  mobile?: boolean;
};

function TaskDropPreview({ item, columnId, index, subtasksCollapsed, onAction, onOpenTask }: {
  item: WorkItem;
  columnId: string;
  index: number;
  subtasksCollapsed: boolean;
  onAction: (action: WorkspaceAction) => void;
  onOpenTask: (item: WorkItem) => void;
}) {
  const { setNodeRef } = useDroppable({
    id: `task-drop-slot:${item.id}:${columnId}:${index}`,
    data: { type: 'task-preview', columnId, index },
  });
  const setDropSlotRef = useCallback((node: HTMLDivElement | null) => {
    setNodeRef(node);
    if (!node) return;
    const cardHeight = node.firstElementChild instanceof HTMLElement
      ? node.firstElementChild.offsetHeight
      : 0;
    node.style.setProperty('--task-drop-slot-height', `${Math.max(cardHeight, node.scrollHeight)}px`);
  }, [setNodeRef]);

  return (
    <div ref={setDropSlotRef} className="task-drop-slot kanban-task-drop-slot">
      <TaskCard
        item={item}
        dropPreview
        subtasksCollapsed={subtasksCollapsed}
        onOpen={onOpenTask}
        onUpdateSubtasks={(itemId, subtasks) => onAction({ type: 'updateItem', itemId, changes: { subtasks } })}
        onSetSubtasksCollapsed={(itemId, collapsed) => onAction({ type: 'setKanbanSubtasksCollapsed', itemId, collapsed })}
      />
    </div>
  );
}

function BoardColumn({ column, items, projectId, allColumns, projectById, collapsedSubtaskItemIds, aggregate, dropPreview, onAction, onOpenTask, onCreateTask, mobile = false }: ColumnProps) {
  const { direction, t } = useI18n();
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({
    id: `column:${column.id}`,
    data: { type: 'column', columnId: column.id },
    disabled: aggregate,
  });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<ColumnMenuPosition | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [columnTitle, setColumnTitle] = useState(column.title);
  const [editingLimit, setEditingLimit] = useState(false);
  const [limitValue, setLimitValue] = useState('');
  const [limitError, setLimitError] = useState(false);
  const composerRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuPopoverRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!aggregate) return;
    setAdding(false);
    setMenuOpen(false);
    setRenaming(false);
  }, [aggregate]);

  useEffect(() => {
    if (menuOpen) return;
    setEditingLimit(false);
    setLimitError(false);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent | FocusEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !menuPopoverRef.current?.contains(target)) setMenuOpen(false);
    };
    const closeWithKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      menuTriggerRef.current?.focus();
    };
    window.addEventListener('pointerdown', closeOutside);
    window.addEventListener('focusin', closeOutside);
    window.addEventListener('keydown', closeWithKeyboard);
    return () => {
      window.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('focusin', closeOutside);
      window.removeEventListener('keydown', closeWithKeyboard);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const updatePosition = () => {
      if (menuTriggerRef.current) setMenuPosition(columnMenuPosition(menuTriggerRef.current.getBoundingClientRect(), direction));
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [direction, menuOpen]);

  const toggleMenu = () => {
    if (!menuOpen && menuTriggerRef.current) {
      setMenuPosition(columnMenuPosition(menuTriggerRef.current.getBoundingClientRect(), direction));
    }
    setMenuOpen((open) => !open);
  };

  const addTask = () => {
    const clean = title.trim();
    if (!clean) return;
    onAction({
      type: 'addItem',
      item: createWorkItem(projectId, column.id, clean, (items.length + 1) * 1000),
    });
    setTitle('');
    setAdding(false);
  };

  const requestTask = () => {
    if (mobile && onCreateTask) {
      onCreateTask({ columnId: column.id });
      return;
    }
    setAdding(true);
    window.setTimeout(() => composerRef.current?.focus(), 0);
  };

  const renameColumn = () => {
    const clean = columnTitle.trim();
    if (clean && clean !== column.title) {
      onAction({ type: 'updateColumn', projectId, columnId: column.id, changes: { title: clean } });
    }
    setRenaming(false);
  };

  const assignRule = (rule: KanbanColumnRule) => {
    onAction({ type: 'setColumnRule', projectId, columnId: column.id, rule });
  };

  const openLimitEditor = () => {
    setLimitValue(column.limit?.toString() ?? '');
    setLimitError(false);
    setEditingLimit(true);
  };

  const saveLimit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const clean = limitValue.trim();
    const nextLimit = clean ? Number(clean) : undefined;
    if (nextLimit !== undefined && (!Number.isInteger(nextLimit) || nextLimit < 1)) {
      setLimitError(true);
      return;
    }
    onAction({ type: 'updateColumn', projectId, columnId: column.id, changes: { limit: nextLimit } });
    setMenuOpen(false);
  };

  const deleteColumn = () => {
    const destination = allColumns.find((candidate) => candidate.id !== column.id);
    if (!destination) return;
    const carriesRules = KANBAN_COLUMN_RULES.some((rule) => columnForRule(allColumns, rule)?.id === column.id);
    const message = carriesRules
      ? t('Delete “{{column}}”? Its cards and column rules will move to “{{destination}}”.', { column: t(column.title), destination: t(destination.title) })
      : t('Delete “{{column}}”? Its cards will move to “{{destination}}”.', { column: t(column.title), destination: t(destination.title) });
    if (window.confirm(message)) {
      onAction({
        type: 'deleteColumn',
        projectId,
        columnId: column.id,
        moveToColumnId: destination.id,
      });
    }
    setMenuOpen(false);
  };

  const newTasksStartHere = columnForRule(allColumns, 'new-task')?.id === column.id;
  const tasksAreCompletedHere = columnForRule(allColumns, 'completed')?.id === column.id;
  const atLimit = column.limit !== undefined && items.length >= column.limit;

  return (
    <section
      ref={setNodeRef}
      className={`board-column ${isOver ? 'column-over' : ''} ${isDragging ? 'column-dragging' : ''} ${menuOpen ? 'menu-open' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition, '--column-color': column.color } as CSSProperties}
    >
      <header className="column-header">
        <div className="column-heading">
          {!aggregate && (
            <button
              ref={setActivatorNodeRef}
              type="button"
              className="column-drag-handle"
              {...attributes}
              {...listeners}
              aria-label={t('Reorder {{name}} column', { name: t(column.title) })}
              title={t('Drag column to reorder')}
            ><GripVertical size={16} /></button>
          )}
          <i style={{ background: column.color }} />
          {!aggregate && renaming ? (
            <input
              className="column-title-input"
              value={columnTitle}
              onChange={(event) => setColumnTitle(event.target.value)}
              onBlur={renameColumn}
              onKeyDown={(event) => {
                if (event.key === 'Enter') renameColumn();
                if (event.key === 'Escape') setRenaming(false);
              }}
              autoFocus
            />
          ) : <h2>{t(column.title)}</h2>}
          <span>{items.length}</span>
          {!aggregate && column.limit && <small className={atLimit ? 'limit-reached' : ''}>{items.length}/{column.limit}</small>}
        </div>
        {!aggregate && (
          <div className="column-actions">
            <button
              className="icon-button column-add-task-button"
              aria-label={t('Add task to {{name}}', { name: t(column.title) })}
              title={t('Add task to {{name}}', { name: t(column.title) })}
              onClick={requestTask}
            ><Plus size={16} /></button>
            <div ref={menuRef} className="relative column-menu-host">
              <button
                ref={menuTriggerRef}
                className="icon-button"
                aria-label={t('Column options')}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={toggleMenu}
              ><Ellipsis size={17} /></button>
              {menuOpen && menuPosition && createPortal(
                <div
                  ref={menuPopoverRef}
                  className="popover column-menu column-menu-portal scale-in"
                  role="menu"
                  style={{
                    position: 'fixed',
                    top: menuPosition.top,
                    left: menuPosition.left,
                    maxHeight: `calc(100vh - ${COLUMN_MENU_GUTTER * 2}px)`,
                    overflowY: 'auto',
                  }}
                >
                  {editingLimit ? (
                    <form className="wip-limit-editor" aria-label={t('Set WIP limit')} onSubmit={saveLimit} noValidate>
                      <label>
                        <span>{t('Work-in-progress limit (leave empty for none)')}</span>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={limitValue}
                          aria-invalid={limitError}
                          onChange={(event) => {
                            setLimitValue(event.target.value);
                            setLimitError(false);
                          }}
                          autoFocus
                        />
                      </label>
                      {limitError && <p role="alert">{t('Enter a whole number of at least 1.')}</p>}
                      <div className="wip-limit-actions">
                        <button type="button" onClick={() => setEditingLimit(false)}>{t('Cancel')}</button>
                        <button type="submit" className="button-primary">{t('Save changes')}</button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <button onClick={() => { setRenaming(true); setMenuOpen(false); }}>{t('Rename column')}</button>
                      <button onClick={openLimitEditor}>{t('Set WIP limit')}</button>
                      <div className="popover-separator" />
                      <p className="column-rule-title">{t('Column behavior')}</p>
                      <small className="column-rule-help">{t('Tell Kanbanos what this column means. Each behavior can be assigned to one column.')}</small>
                  <button
                    className={`column-rule-option ${newTasksStartHere ? 'selected' : ''}`}
                    role="menuitemcheckbox"
                    aria-label={t('Default home for new tasks')}
                    aria-checked={newTasksStartHere}
                    onClick={() => assignRule('new-task')}
                  >
                    <Plus size={18} />
                    <span className="column-rule-copy">
                      <strong>{t('Default home for new tasks')}</strong>
                      <small>{t('New tasks are added here unless you choose another column.')}</small>
                    </span>
                    <b>{newTasksStartHere && <Check size={14} />}</b>
                  </button>
                  <button
                    className={`column-rule-option ${tasksAreCompletedHere ? 'selected' : ''}`}
                    role="menuitemcheckbox"
                    aria-label={t('Count tasks as complete')}
                    aria-checked={tasksAreCompletedHere}
                    onClick={() => assignRule('completed')}
                  >
                    <CheckCircle2 size={18} />
                    <span className="column-rule-copy">
                      <strong>{t('Count tasks as complete')}</strong>
                      <small>{t('Tasks here count as completed in List and Roadmap progress.')}</small>
                    </span>
                    <b>{tasksAreCompletedHere && <Check size={14} />}</b>
                  </button>
                      {allColumns.length > 1 && <><div className="popover-separator" /><button className="danger-option" onClick={deleteColumn}>{t('Delete column')}</button></>}
                    </>
                  )}
                </div>,
                window.document.body,
              )}
            </div>
          </div>
        )}
      </header>

      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <div className="task-list">
          {items.map((item) => (
            <Fragment key={item.id}>
              {dropPreview?.beforeItemId === item.id && (
                <TaskDropPreview
                  item={dropPreview.item}
                  columnId={dropPreview.columnId}
                  index={dropPreview.index}
                  subtasksCollapsed={collapsedSubtaskItemIds.has(dropPreview.item.id)}
                  onAction={onAction}
                  onOpenTask={onOpenTask}
                />
              )}
              <TaskCard
                item={item}
                project={aggregate ? projectById.get(item.projectId) : undefined}
                dragDisabled={aggregate}
                subtasksCollapsed={collapsedSubtaskItemIds.has(item.id)}
                onOpen={onOpenTask}
                onUpdateSubtasks={(itemId, subtasks) => onAction({
                  type: 'updateItem',
                  itemId,
                  changes: { subtasks },
                })}
                onSetSubtasksCollapsed={(itemId, collapsed) => onAction({
                  type: 'setKanbanSubtasksCollapsed',
                  itemId,
                  collapsed,
                })}
              />
            </Fragment>
          ))}
          {dropPreview && (!dropPreview.beforeItemId || !items.some((item) => item.id === dropPreview.beforeItemId)) && (
            <TaskDropPreview
              item={dropPreview.item}
              columnId={dropPreview.columnId}
              index={dropPreview.index}
              subtasksCollapsed={collapsedSubtaskItemIds.has(dropPreview.item.id)}
              onAction={onAction}
              onOpenTask={onOpenTask}
            />
          )}
          {items.length === 0 && !adding && !dropPreview && (aggregate ? (
            <div className="empty-column aggregate-empty">
              <Sparkles size={18} />
              <span>{t('No missions in this column')}</span>
            </div>
          ) : (
            <button className="empty-column" onClick={requestTask}>
              <Sparkles size={18} />
              <span>{t('Clear space for what’s next')}</span>
              <small>{t('Add the first task')}</small>
            </button>
          ))}
        </div>
      </SortableContext>

      {!aggregate && (adding ? (
        <div className="quick-add slide-up">
          <input
            ref={composerRef}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t('What needs to be done?')}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addTask();
              if (event.key === 'Escape') setAdding(false);
            }}
            autoFocus
          />
          <div><span>{t('Press Enter to add')}</span><button onClick={() => setAdding(false)}><X size={14} /></button><button className="quick-add-submit" onClick={addTask}>{t('Add task')}</button></div>
        </div>
      ) : (
        <button className="add-task-button" onClick={requestTask}><Plus size={15} /> {t('Add task')}</button>
      ))}
    </section>
  );
}

export function KanbanBoard({ document, project, saveState, dirty, onAction, onOpenTask, onCreateTask, onSave, onEditProject, onChangeView }: Props) {
  const { t } = useI18n();
  const compactLayout = useCompactLayout();
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [priorities, setPriorities] = useState<Priority[]>([]);
  const [addingColumn, setAddingColumn] = useState(false);
  const [columnName, setColumnName] = useState('');
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [draggingColumnId, setDraggingColumnId] = useState<string | null>(null);
  const [taskDropPreview, setTaskDropPreview] = useState<TaskDropPreviewState | null>(null);
  const [scope, setScope] = useState<ProjectScope>('current');
  const [mobileBoardOrientation, setMobileBoardOrientation] = useState<'stacked' | 'horizontal'>('stacked');
  const filterRef = useRef<HTMLDivElement>(null);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const addColumnRef = useRef<HTMLDivElement>(null);
  const addColumnTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setScope('current'), [project.id]);

  useEffect(() => {
    if (!filterOpen) return;
    const closeOutside = (event: PointerEvent | FocusEvent) => {
      if (!filterRef.current?.contains(event.target as Node)) setFilterOpen(false);
    };
    const closeWithKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setFilterOpen(false);
      filterTriggerRef.current?.focus();
    };
    window.addEventListener('pointerdown', closeOutside);
    window.addEventListener('focusin', closeOutside);
    window.addEventListener('keydown', closeWithKeyboard);
    return () => {
      window.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('focusin', closeOutside);
      window.removeEventListener('keydown', closeWithKeyboard);
    };
  }, [filterOpen]);

  useEffect(() => {
    if (!addingColumn) return;
    const closeOutside = (event: PointerEvent | FocusEvent) => {
      if (addColumnRef.current?.contains(event.target as Node)) return;
      setAddingColumn(false);
    };
    const closeWithKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setAddingColumn(false);
      window.setTimeout(() => addColumnTriggerRef.current?.focus(), 0);
    };
    window.addEventListener('pointerdown', closeOutside);
    window.addEventListener('focusin', closeOutside);
    window.addEventListener('keydown', closeWithKeyboard);
    return () => {
      window.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('focusin', closeOutside);
      window.removeEventListener('keydown', closeWithKeyboard);
    };
  }, [addingColumn]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: boardKeyboardCoordinates }),
  );

  const showAllProjects = scope === 'all';
  const activeColumns = document.modules.kanban.projects[project.id]?.columns ?? [];
  const scopedProjects = useMemo(() => showAllProjects
    ? [project, ...document.projects.filter((candidate) => candidate.id !== project.id && !candidate.archived)]
    : [project], [document.projects, project, showAllProjects]);
  const scopedProjectIds = useMemo(() => new Set(scopedProjects.map((candidate) => candidate.id)), [scopedProjects]);
  const projectById = useMemo(() => new Map(document.projects.map((candidate) => [candidate.id, candidate])), [document.projects]);
  const collapsedSubtaskItemIds = useMemo(
    () => new Set(document.preferences.collapsedKanbanSubtaskItemIds ?? []),
    [document.preferences.collapsedKanbanSubtaskItemIds],
  );
  const projectOrder = useMemo(() => new Map(scopedProjects.map((candidate, index) => [candidate.id, index])), [scopedProjects]);
  const columns = useMemo(() => {
    const seen = new Set<string>();
    return scopedProjects.flatMap((candidate) => document.modules.kanban.projects[candidate.id]?.columns ?? [])
      .filter((column) => {
        if (seen.has(column.id)) return false;
        seen.add(column.id);
        return true;
      });
  }, [document.modules.kanban.projects, scopedProjects]);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleItems = useMemo(() => {
    return Object.values(document.items).filter((item) => {
      if (!scopedProjectIds.has(item.projectId)) return false;
      if (priorities.length > 0 && !priorities.includes(item.priority)) return false;
      if (!normalizedSearch) return true;
      return [item.title, item.description, ...item.labels].join(' ').toLocaleLowerCase().includes(normalizedSearch);
    });
  }, [document.items, normalizedSearch, priorities, scopedProjectIds]);

  const filteredColumnItems = (columnId: string) => visibleItems
    .filter((item) => item.moduleData.kanban.columnId === columnId)
    .sort((left, right) => {
      const projectDifference = (projectOrder.get(left.projectId) ?? Number.MAX_SAFE_INTEGER)
        - (projectOrder.get(right.projectId) ?? Number.MAX_SAFE_INTEGER);
      return projectDifference || left.moduleData.kanban.rank - right.moduleData.kanban.rank;
    });

  const clearDragState = () => {
    setDraggingItemId(null);
    setDraggingColumnId(null);
    setTaskDropPreview(null);
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    const data = active.data.current as { type?: string; columnId?: string } | undefined;
    if (data?.type === 'column') {
      setDraggingColumnId(data.columnId ?? null);
      setDraggingItemId(null);
      setTaskDropPreview(null);
      return;
    }
    const itemId = String(active.id);
    const item = document.items[itemId];
    setDraggingItemId(itemId);
    setDraggingColumnId(null);
    setTaskDropPreview(null);
  };

  const updateTaskDropPreview = (event: DragMoveEvent | DragOverEvent) => {
    const { active, over } = event;
    const activeData = active.data.current as { type?: string } | undefined;
    if (activeData?.type === 'column') {
      setTaskDropPreview(null);
      return;
    }
    if (!over) return;
    const itemId = String(active.id);
    const item = document.items[itemId];
    const overData = over.data.current as { type?: string; columnId?: string } | undefined;
    const columnId = overData?.columnId ?? String(over.id).replace('column:', '');
    const itemColumns = item ? document.modules.kanban.projects[item.projectId]?.columns ?? [] : [];
    if (!item || !itemColumns.some((column) => column.id === columnId)) {
      setTaskDropPreview(null);
      return;
    }

    const targetItems = itemsForColumn(document, item.projectId, columnId);
    const destinationItems = targetItems.filter((target) => target.id !== itemId);
    const index = taskDropIndex(event, itemId, targetItems);
    const originalIndex = targetItems.findIndex((target) => target.id === itemId);
    if (columnId === item.moduleData.kanban.columnId && index === originalIndex) {
      setTaskDropPreview(null);
      return;
    }
    const nextPreview = { itemId, columnId, index, beforeItemId: destinationItems[index]?.id };
    setTaskDropPreview((current) => current?.itemId === nextPreview.itemId
      && current.columnId === nextPreview.columnId
      && current.index === nextPreview.index
      && current.beforeItemId === nextPreview.beforeItemId
      ? current
      : nextPreview);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    clearDragState();
    if (!over) return;
    const activeData = active.data.current as { type?: string; columnId?: string } | undefined;
    const overData = over.data.current as { type?: string; columnId?: string } | undefined;

    if (activeData?.type === 'column') {
      const activeColumnId = activeData.columnId;
      const overColumnId = overData?.columnId ?? String(over.id).replace('column:', '');
      const oldIndex = activeColumns.findIndex((column) => column.id === activeColumnId);
      const newIndex = activeColumns.findIndex((column) => column.id === overColumnId);
      if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
        onAction({
          type: 'reorderColumns',
          projectId: project.id,
          columnIds: arrayMove(activeColumns, oldIndex, newIndex).map((column) => column.id),
        });
      }
      return;
    }

    const item = document.items[String(active.id)];
    if (!item) return;
    const columnId = overData?.columnId ?? String(over.id).replace('column:', '');
    const itemColumns = document.modules.kanban.projects[item.projectId]?.columns ?? [];
    if (!itemColumns.some((column) => column.id === columnId)) return;
    const targetItems = itemsForColumn(document, item.projectId, columnId);
    onAction({ type: 'moveItem', itemId: item.id, columnId, index: taskDropIndex(event, item.id, targetItems) });
  };

  const addColumn = () => {
    const title = columnName.trim();
    if (!title) return;
    const colors = ['#6c5ce7', '#e6a44b', '#43a882', '#4c84e8', '#d45d79'];
    onAction({
      type: 'addColumn',
      projectId: project.id,
      column: {
        id: `column-${crypto.randomUUID()}`,
        title,
        color: colors[activeColumns.length % colors.length],
      },
    });
    setColumnName('');
    setAddingColumn(false);
  };

  const draggingItem = draggingItemId ? document.items[draggingItemId] : undefined;
  const draggingColumn = draggingColumnId ? activeColumns.find((column) => column.id === draggingColumnId) : undefined;
  const projectAssignees = Array.from(new Set(
    Object.values(document.items).filter((item) => scopedProjectIds.has(item.projectId)).map((item) => item.assignee).filter(Boolean),
  )).slice(0, 4) as string[];
  const scopeTitle = showAllProjects ? t('All projects') : project.name;

  return (
    <main className={`workspace-main ${compactLayout && mobileBoardOrientation === 'horizontal' ? 'mobile-board-horizontal' : ''}`}>
      <header className="board-topbar">
        <div className="breadcrumbs"><span>{t('Projects')}</span><b>/</b><strong>{scopeTitle}</strong></div>
        <div className="topbar-actions">
          <PreferencesControls />
          <div className="member-stack">
            {projectAssignees.map((assignee) => <span key={assignee}>{assignee}</span>)}
            <button aria-label={t('Invite collaborator')}><Plus size={13} /></button>
          </div>
          <button
            className={`button save-button ${dirty ? 'save-dirty' : ''}`}
            disabled={saveState === 'saving' || (!dirty && saveState === 'synced')}
            onClick={onSave}
          >
            {saveState === 'saving' ? <><span className="spinner spinner-dark" /> {t('Saving')}</> : saveState === 'synced' && !dirty ? <><Check size={16} /> {t('Saved')}</> : t('Save changes')}
          </button>
          <button className="icon-button top-more" onClick={onEditProject}><Ellipsis size={18} /></button>
        </div>
      </header>

      <div className="board-heading-row">
        <div className="board-title">
          <span className="project-icon" style={{ background: `${project.color}18`, color: project.color }}><LayoutGrid size={21} /></span>
          <div><h1>{scopeTitle}</h1><p>{showAllProjects ? t('Missions across every project in this workspace.') : project.description || t('A focused space for moving work forward.')}</p></div>
        </div>
        <div className="board-view-controls">
          <div className="board-view-toggle"><button className="active"><LayoutGrid size={15} /> {t('Board')}</button><button onClick={() => onChangeView('list')}><ListFilter size={15} /> {t('List')}</button></div>
          {compactLayout && <button
            type="button"
            className="mobile-board-orientation"
            aria-label={t(mobileBoardOrientation === 'stacked' ? 'Show columns horizontally' : 'Stack columns vertically')}
            title={t(mobileBoardOrientation === 'stacked' ? 'Show columns horizontally' : 'Stack columns vertically')}
            onClick={() => setMobileBoardOrientation((current) => current === 'stacked' ? 'horizontal' : 'stacked')}
          >{mobileBoardOrientation === 'stacked' ? <Columns3 size={19} /> : <Rows3 size={19} />}</button>}
        </div>
      </div>

      <div className={`board-toolbar ${!showAllProjects ? 'with-add-column' : ''}`}>
        <div className={`search-box ${search ? 'has-value' : ''}`}>
          <Search size={16} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t(showAllProjects ? 'Search all projects' : 'Search this project')} />
          {search && <button onClick={() => setSearch('')}><X size={14} /></button>}
        </div>
        <ProjectScopeSelect project={project} value={scope} onChange={setScope} />
        <div ref={filterRef} className="relative">
          <button ref={filterTriggerRef} className={`toolbar-button ${priorities.length ? 'active' : ''}`} aria-haspopup="menu" aria-expanded={filterOpen} onClick={() => setFilterOpen((open) => !open)}>
            <Filter size={15} /> {t('Filter')} {priorities.length > 0 && <span>{priorities.length}</span>} <ChevronDown size={13} />
          </button>
          {filterOpen && (
            <div className="popover filter-menu scale-in" role="menu">
              <p>{t('Show priority')}</p>
              {(Object.keys(PRIORITY_META) as Priority[]).filter((priority) => priority !== 'none').map((priority) => (
                <button key={priority} onClick={() => setPriorities((current) => current.includes(priority) ? current.filter((value) => value !== priority) : [...current, priority])}>
                  <i style={{ background: PRIORITY_META[priority].color }} />
                  <span>{t(PRIORITY_META[priority].label)}</span>
                  <b className={priorities.includes(priority) ? 'checked' : ''}>{priorities.includes(priority) && <Check size={12} />}</b>
                </button>
              ))}
              {priorities.length > 0 && <button className="clear-filter" onClick={() => setPriorities([])}>{t('Clear filters')}</button>}
            </div>
          )}
        </div>
        {!showAllProjects && (
          <div ref={addColumnRef} className="relative board-add-column-control">
            <button
              ref={addColumnTriggerRef}
              type="button"
              className={`toolbar-button board-add-column-button ${addingColumn ? 'active' : ''}`}
              aria-haspopup="dialog"
              aria-expanded={addingColumn}
              title={t('Add column')}
              onClick={() => setAddingColumn((open) => !open)}
            ><Plus size={16} /> {t('Add column')}</button>
            {addingColumn && (
              <div className="popover add-column-form board-add-column-form scale-in" role="dialog" aria-label={t('Add column')}>
                <input
                  value={columnName}
                  onChange={(event) => setColumnName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') addColumn();
                  }}
                  placeholder={t('Column name')}
                  autoFocus
                />
                <div>
                  <button className="button button-primary" onClick={addColumn}>{t('Add column')}</button>
                  <button className="icon-button" aria-label={t('Close')} onClick={() => setAddingColumn(false)}><X size={16} /></button>
                </div>
              </div>
            )}
          </div>
        )}
        {(search || priorities.length > 0) && <span className="result-count">{t(visibleItems.length === 1 ? '{{count}} matching task' : '{{count}} matching tasks', { count: visibleItems.length })}</span>}
      </div>

      <DndContext
        sensors={sensors}
        autoScroll={compactLayout
          ? { acceleration: 30, interval: 4, threshold: { x: 0.08, y: 0.38 }, layoutShiftCompensation: false }
          : { layoutShiftCompensation: false }}
        collisionDetection={boardCollisionDetection}
        onDragStart={onDragStart}
        onDragMove={updateTaskDropPreview}
        onDragOver={updateTaskDropPreview}
        onDragCancel={clearDragState}
        onDragEnd={onDragEnd}
      >
        <div className="board-scroll">
          <div
            className="board-columns"
            style={{ '--board-column-count': Math.max(columns.length, 1) } as CSSProperties}
          >
            <SortableContext items={columns.map((column) => `column:${column.id}`)} strategy={horizontalListSortingStrategy}>
              {columns.map((column) => (
                <BoardColumn
                  key={column.id}
                  column={column}
                  items={filteredColumnItems(column.id)}
                  projectId={project.id}
                  allColumns={columns}
                  projectById={projectById}
                  collapsedSubtaskItemIds={collapsedSubtaskItemIds}
                  aggregate={showAllProjects}
                  dropPreview={taskDropPreview?.columnId === column.id && draggingItem
                    ? { ...taskDropPreview, item: draggingItem }
                    : undefined}
                  mobile={compactLayout}
                  onAction={onAction}
                  onOpenTask={onOpenTask}
                  onCreateTask={onCreateTask}
                />
              ))}
            </SortableContext>
          </div>
        </div>
        <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' }}>
          {draggingItem ? (
            <article className="task-card drag-card-overlay">
              {draggingItem.labels.length > 0 && (
                <div className="card-labels">
                  {draggingItem.labels.slice(0, 2).map((label) => <span key={label}><i />{label}</span>)}
                </div>
              )}
              <h3>{draggingItem.title}</h3>
              {draggingItem.description && <p className="card-description">{draggingItem.description}</p>}
              <div className="drag-overlay-hint">{t('Drop to move')}</div>
            </article>
          ) : draggingColumn ? (
            <div className="column-drag-overlay">
              <GripVertical size={18} />
              <i style={{ background: draggingColumn.color }} />
              <strong>{t(draggingColumn.title)}</strong>
              <small>{t('Drop to reorder columns')}</small>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      {compactLayout && !showAllProjects && onCreateTask && (
        <button
          type="button"
          className="mobile-board-fab"
          onClick={() => onCreateTask({ columnId: columnForRule(activeColumns, 'new-task')?.id })}
        ><Plus size={20} /> {t('New task')}</button>
      )}
    </main>
  );
}
