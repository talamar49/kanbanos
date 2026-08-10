import { useMemo, useRef, useState } from 'react';
import {
  closestCorners,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import {
  Check,
  ChevronDown,
  Ellipsis,
  Filter,
  LayoutGrid,
  ListFilter,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type { KanbanColumn, Priority, Project, WorkItem, WorkspaceAction, WorkspaceDocument, WorkspaceView } from '../domain/types';
import { createWorkItem, itemsForColumn, PRIORITY_META } from '../domain/workspace';
import { TaskCard } from './TaskCard';

type SaveState = 'idle' | 'saving' | 'synced' | 'error' | 'local';

type Props = {
  document: WorkspaceDocument;
  project: Project;
  saveState: SaveState;
  dirty: boolean;
  onAction: (action: WorkspaceAction) => void;
  onOpenTask: (item: WorkItem) => void;
  onSave: () => void;
  onEditProject: () => void;
  onChangeView: (view: WorkspaceView) => void;
};

type ColumnProps = {
  column: KanbanColumn;
  items: WorkItem[];
  projectId: string;
  allColumns: KanbanColumn[];
  onAction: (action: WorkspaceAction) => void;
  onOpenTask: (item: WorkItem) => void;
};

function BoardColumn({ column, items, projectId, allColumns, onAction, onOpenTask }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${column.id}`,
    data: { type: 'column', columnId: column.id },
  });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [columnTitle, setColumnTitle] = useState(column.title);
  const composerRef = useRef<HTMLInputElement>(null);

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
    if (window.confirm(`Delete “${column.title}”? Its cards will move to “${destination.title}”.`)) {
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
    <section ref={setNodeRef} className={`board-column ${isOver ? 'column-over' : ''}`}>
      <header className="column-header">
        <div className="column-heading">
          <i style={{ background: column.color }} />
          {renaming ? (
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
          ) : <h2>{column.title}</h2>}
          <span>{items.length}</span>
          {column.limit && <small className={atLimit ? 'limit-reached' : ''}>{items.length}/{column.limit}</small>}
        </div>
        <div className="column-actions">
          <button className="icon-button" aria-label={`Add task to ${column.title}`} onClick={() => {
            setAdding(true);
            setTimeout(() => composerRef.current?.focus(), 0);
          }}><Plus size={16} /></button>
          <div className="relative">
            <button className="icon-button" aria-label="Column options" onClick={() => setMenuOpen((open) => !open)}><Ellipsis size={17} /></button>
            {menuOpen && (
              <div className="popover column-menu scale-in">
                <button onClick={() => { setRenaming(true); setMenuOpen(false); }}>Rename column</button>
                <button onClick={() => {
                  const value = window.prompt('Work-in-progress limit (leave empty for none)', column.limit?.toString() ?? '');
                  if (value !== null) {
                    const limit = value.trim() ? Math.max(1, Number(value)) : undefined;
                    if (!value.trim() || Number.isFinite(limit)) onAction({ type: 'updateColumn', projectId, columnId: column.id, changes: { limit } });
                  }
                  setMenuOpen(false);
                }}>Set WIP limit</button>
                {allColumns.length > 1 && <button className="danger-option" onClick={deleteColumn}>Delete column</button>}
              </div>
            )}
          </div>
        </div>
      </header>

      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <div className="task-list">
          {items.map((item) => (
            <TaskCard
              key={item.id}
              item={item}
              onOpen={onOpenTask}
              onToggleSubtask={(itemId, subtaskId) => onAction({
                type: 'updateItem',
                itemId,
                changes: {
                  subtasks: item.subtasks.map((subtask) =>
                    subtask.id === subtaskId ? { ...subtask, completed: !subtask.completed } : subtask,
                  ),
                },
              })}
            />
          ))}
          {items.length === 0 && !adding && (
            <button className="empty-column" onClick={() => setAdding(true)}>
              <Sparkles size={18} />
              <span>Clear space for what’s next</span>
              <small>Add the first task</small>
            </button>
          )}
        </div>
      </SortableContext>

      {adding ? (
        <div className="quick-add slide-up">
          <input
            ref={composerRef}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What needs to be done?"
            onKeyDown={(event) => {
              if (event.key === 'Enter') addTask();
              if (event.key === 'Escape') setAdding(false);
            }}
            autoFocus
          />
          <div><span>Press Enter to add</span><button onClick={() => setAdding(false)}><X size={14} /></button><button className="quick-add-submit" onClick={addTask}>Add task</button></div>
        </div>
      ) : (
        <button className="add-task-button" onClick={() => {
          setAdding(true);
          setTimeout(() => composerRef.current?.focus(), 0);
        }}><Plus size={15} /> Add task</button>
      )}
    </section>
  );
}

export function KanbanBoard({ document, project, saveState, dirty, onAction, onOpenTask, onSave, onEditProject, onChangeView }: Props) {
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [priorities, setPriorities] = useState<Priority[]>([]);
  const [addingColumn, setAddingColumn] = useState(false);
  const [columnName, setColumnName] = useState('');
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const settings = document.modules.kanban.projects[project.id];
  const columns = settings?.columns ?? [];
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleItems = useMemo(() => {
    return Object.values(document.items).filter((item) => {
      if (item.projectId !== project.id) return false;
      if (priorities.length > 0 && !priorities.includes(item.priority)) return false;
      if (!normalizedSearch) return true;
      return [item.title, item.description, ...item.labels].join(' ').toLocaleLowerCase().includes(normalizedSearch);
    });
  }, [document.items, normalizedSearch, priorities, project.id]);

  const filteredColumnItems = (columnId: string) => {
    const order = itemsForColumn(document, project.id, columnId).map((item) => item.id);
    return visibleItems
      .filter((item) => item.moduleData.kanban.columnId === columnId)
      .sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id));
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    setDraggingItemId(String(active.id));
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDraggingItemId(null);
    if (!over) return;
    const item = document.items[String(active.id)];
    if (!item) return;
    const overData = over.data.current as { type?: string; columnId?: string } | undefined;
    const columnId = overData?.columnId ?? String(over.id).replace('column:', '');
    const targetItems = itemsForColumn(document, project.id, columnId);
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
        color: colors[columns.length % colors.length],
      },
    });
    setColumnName('');
    setAddingColumn(false);
  };

  const draggingItem = draggingItemId ? document.items[draggingItemId] : undefined;
  const projectAssignees = Array.from(new Set(
    Object.values(document.items).filter((item) => item.projectId === project.id).map((item) => item.assignee).filter(Boolean),
  )).slice(0, 4) as string[];

  return (
    <main className="workspace-main">
      <header className="board-topbar">
        <div className="breadcrumbs"><span>Projects</span><b>/</b><strong>{project.name}</strong></div>
        <div className="topbar-actions">
          <div className="member-stack">
            {projectAssignees.map((assignee) => <span key={assignee}>{assignee}</span>)}
            <button aria-label="Invite collaborator"><Plus size={13} /></button>
          </div>
          <button
            className={`button save-button ${dirty ? 'save-dirty' : ''}`}
            disabled={saveState === 'saving' || (!dirty && saveState === 'synced')}
            onClick={onSave}
          >
            {saveState === 'saving' ? <><span className="spinner spinner-dark" /> Saving</> : saveState === 'synced' && !dirty ? <><Check size={16} /> Saved</> : 'Save changes'}
          </button>
          <button className="icon-button top-more" onClick={onEditProject}><Ellipsis size={18} /></button>
        </div>
      </header>

      <div className="board-heading-row">
        <div className="board-title">
          <span className="project-icon" style={{ background: `${project.color}18`, color: project.color }}><LayoutGrid size={21} /></span>
          <div><h1>{project.name}</h1><p>{project.description || 'A focused space for moving work forward.'}</p></div>
        </div>
        <div className="board-view-toggle"><button className="active"><LayoutGrid size={15} /> Board</button><button onClick={() => onChangeView('list')}><ListFilter size={15} /> List</button></div>
      </div>

      <div className="board-toolbar">
        <div className={`search-box ${search ? 'has-value' : ''}`}>
          <Search size={16} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search this project" />
          {search && <button onClick={() => setSearch('')}><X size={14} /></button>}
        </div>
        <div className="relative">
          <button className={`toolbar-button ${priorities.length ? 'active' : ''}`} onClick={() => setFilterOpen((open) => !open)}>
            <Filter size={15} /> Filter {priorities.length > 0 && <span>{priorities.length}</span>} <ChevronDown size={13} />
          </button>
          {filterOpen && (
            <div className="popover filter-menu scale-in">
              <p>Show priority</p>
              {(Object.keys(PRIORITY_META) as Priority[]).filter((priority) => priority !== 'none').map((priority) => (
                <button key={priority} onClick={() => setPriorities((current) => current.includes(priority) ? current.filter((value) => value !== priority) : [...current, priority])}>
                  <i style={{ background: PRIORITY_META[priority].color }} />
                  <span>{PRIORITY_META[priority].label}</span>
                  <b className={priorities.includes(priority) ? 'checked' : ''}>{priorities.includes(priority) && <Check size={12} />}</b>
                </button>
              ))}
              {priorities.length > 0 && <button className="clear-filter" onClick={() => setPriorities([])}>Clear filters</button>}
            </div>
          )}
        </div>
        {(search || priorities.length > 0) && <span className="result-count">{visibleItems.length} matching {visibleItems.length === 1 ? 'task' : 'tasks'}</span>}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragCancel={() => setDraggingItemId(null)}
        onDragEnd={onDragEnd}
      >
        <div className="board-scroll">
          <div className="board-columns">
            {columns.map((column) => (
              <BoardColumn
                key={column.id}
                column={column}
                items={filteredColumnItems(column.id)}
                projectId={project.id}
                allColumns={columns}
                onAction={onAction}
                onOpenTask={onOpenTask}
              />
            ))}
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
                    placeholder="Column name"
                    autoFocus
                  />
                  <div><button className="button button-primary" onClick={addColumn}>Add column</button><button className="icon-button" onClick={() => setAddingColumn(false)}><X size={16} /></button></div>
                </div>
              ) : <button className="add-column-button" onClick={() => setAddingColumn(true)}><Plus size={16} /> Add column</button>}
            </div>
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
              <div className="drag-overlay-hint">Drop to move</div>
            </article>
          ) : null}
        </DragOverlay>
      </DndContext>
    </main>
  );
}
