import { Fragment, type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import {
  closestCorners,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragOverEvent,
  DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
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
import type { KanbanColumn, Priority, Project, TaskDraft, WorkItem, WorkspaceAction, WorkspaceDocument, WorkspaceView } from '../domain/types';
import { createWorkItem, itemsForColumn, PRIORITY_META } from '../domain/workspace';
import { useI18n } from '../i18n';
import { useCompactLayout } from '../platform/useCompactLayout';
import { PreferencesControls } from './PreferencesControls';
import { ProjectScopeSelect, type ProjectScope } from './ProjectScopeSelect';
import { TaskCard } from './TaskCard';

type SaveState = 'idle' | 'saving' | 'synced' | 'error' | 'local';

const boardCollisionDetection: CollisionDetection = (args) => {
  if (args.active.data.current?.type !== 'column') return closestCorners(args);
  return closestCorners({
    ...args,
    droppableContainers: args.droppableContainers.filter(
      (container) => container.data.current?.type === 'column',
    ),
  });
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
  beforeItemId?: string;
};

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

function TaskDropPreview({ item }: { item: WorkItem }) {
  const { t } = useI18n();
  return (
    <div className="task-drop-preview" aria-hidden="true">
      <span style={{ background: PRIORITY_META[item.priority].color }} />
      <div><strong>{item.title}</strong><small>{t('Drop to move')}</small></div>
    </div>
  );
}

function BoardColumn({ column, items, projectId, allColumns, projectById, collapsedSubtaskItemIds, aggregate, dropPreview, onAction, onOpenTask, onCreateTask, mobile = false }: ColumnProps) {
  const { t } = useI18n();
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
  const [renaming, setRenaming] = useState(false);
  const [columnTitle, setColumnTitle] = useState(column.title);
  const composerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!aggregate) return;
    setAdding(false);
    setMenuOpen(false);
    setRenaming(false);
  }, [aggregate]);

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

  const deleteColumn = () => {
    const destination = allColumns.find((candidate) => candidate.id !== column.id);
    if (!destination) return;
    if (window.confirm(t('Delete “{{column}}”? Its cards will move to “{{destination}}”.', { column: t(column.title), destination: t(destination.title) }))) {
      onAction({
        type: 'deleteColumn',
        projectId,
        columnId: column.id,
        moveToColumnId: destination.id,
      });
    }
    setMenuOpen(false);
  };

  const atLimit = column.limit !== undefined && items.length >= column.limit;

  return (
    <section
      ref={setNodeRef}
      className={`board-column ${isOver ? 'column-over' : ''} ${isDragging ? 'column-dragging' : ''}`}
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
            <button className="icon-button" aria-label={t('Add task to {{name}}', { name: t(column.title) })} onClick={requestTask}><Plus size={16} /></button>
            <div className="relative">
              <button className="icon-button" aria-label={t('Column options')} onClick={() => setMenuOpen((open) => !open)}><Ellipsis size={17} /></button>
              {menuOpen && (
                <div className="popover column-menu scale-in">
                  <button onClick={() => { setRenaming(true); setMenuOpen(false); }}>{t('Rename column')}</button>
                  <button onClick={() => {
                    const value = window.prompt(t('Work-in-progress limit (leave empty for none)'), column.limit?.toString() ?? '');
                    if (value !== null) {
                      const limit = value.trim() ? Math.max(1, Number(value)) : undefined;
                      if (!value.trim() || Number.isFinite(limit)) onAction({ type: 'updateColumn', projectId, columnId: column.id, changes: { limit } });
                    }
                    setMenuOpen(false);
                  }}>{t('Set WIP limit')}</button>
                  {allColumns.length > 1 && <button className="danger-option" onClick={deleteColumn}>{t('Delete column')}</button>}
                </div>
              )}
            </div>
          </div>
        )}
      </header>

      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <div className="task-list">
          {items.map((item) => (
            <Fragment key={item.id}>
              {dropPreview?.beforeItemId === item.id && <TaskDropPreview item={dropPreview.item} />}
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
            <TaskDropPreview item={dropPreview.item} />
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

  useEffect(() => setScope('current'), [project.id]);

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
    setTaskDropPreview(item ? { itemId, columnId: item.moduleData.kanban.columnId, beforeItemId: itemId } : null);
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    const activeData = active.data.current as { type?: string } | undefined;
    if (!over || activeData?.type === 'column') {
      setTaskDropPreview(null);
      return;
    }
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
    const overIndex = overData?.type === 'item'
      ? Math.max(0, targetItems.findIndex((target) => target.id === String(over.id)))
      : targetItems.length;
    const destinationItems = targetItems.filter((target) => target.id !== itemId);
    setTaskDropPreview({ itemId, columnId, beforeItemId: destinationItems[overIndex]?.id });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
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
    const overIndex = overData?.type === 'item'
      ? Math.max(0, targetItems.findIndex((target) => target.id === String(over.id)))
      : targetItems.length;
    onAction({ type: 'moveItem', itemId: item.id, columnId, index: overIndex });
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

      <div className="board-toolbar">
        <div className={`search-box ${search ? 'has-value' : ''}`}>
          <Search size={16} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t(showAllProjects ? 'Search all projects' : 'Search this project')} />
          {search && <button onClick={() => setSearch('')}><X size={14} /></button>}
        </div>
        <ProjectScopeSelect project={project} value={scope} onChange={setScope} />
        <div className="relative">
          <button className={`toolbar-button ${priorities.length ? 'active' : ''}`} onClick={() => setFilterOpen((open) => !open)}>
            <Filter size={15} /> {t('Filter')} {priorities.length > 0 && <span>{priorities.length}</span>} <ChevronDown size={13} />
          </button>
          {filterOpen && (
            <div className="popover filter-menu scale-in">
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
        {(search || priorities.length > 0) && <span className="result-count">{t(visibleItems.length === 1 ? '{{count}} matching task' : '{{count}} matching tasks', { count: visibleItems.length })}</span>}
      </div>

      <DndContext
        sensors={sensors}
        autoScroll={compactLayout ? { acceleration: 30, interval: 4, threshold: { x: 0.08, y: 0.38 } } : true}
        collisionDetection={boardCollisionDetection}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragCancel={clearDragState}
        onDragEnd={onDragEnd}
      >
        <div className="board-scroll">
          <div className="board-columns">
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
            {!showAllProjects && (
              <div className="add-column-wrap">
                {addingColumn ? (
                  <div className="add-column-form slide-up">
                    <input
                      value={columnName}
                      onChange={(event) => setColumnName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') addColumn();
                        if (event.key === 'Escape') setAddingColumn(false);
                      }}
                      placeholder={t('Column name')}
                      autoFocus
                    />
                    <div><button className="button button-primary" onClick={addColumn}>{t('Add column')}</button><button className="icon-button" onClick={() => setAddingColumn(false)}><X size={16} /></button></div>
                  </div>
                ) : <button className="add-column-button" onClick={() => setAddingColumn(true)}><Plus size={16} /> {t('Add column')}</button>}
              </div>
            )}
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
          onClick={() => onCreateTask({ columnId: activeColumns.find((column) => column.id === 'planned')?.id ?? activeColumns[0]?.id })}
        ><Plus size={20} /> {t('New task')}</button>
      )}
    </main>
  );
}
