import { describe, expect, it } from 'vitest';
import type { CanvasNode, WorkspaceAttachment, WorkspaceDocument } from './types';
import {
  CANVAS_NODE_COLORS,
  DEFAULT_COLUMNS,
  PRIORITY_META,
  PROJECT_COLORS,
  ROADMAP_HORIZONS,
  createCanvasConnection,
  activeCanvasView,
  canvasViewsForProject,
  createCanvasNode,
  createCanvasProject,
  createCanvasStroke,
  createCanvasView,
  columnForRule,
  createDefaultWorkspace,
  createEmptyWorkspace,
  createProject,
  createProjectSettings,
  createWorkItem,
  isWorkspaceDocument,
  itemsForColumn,
  normalizeWorkspaceDocument,
  workspaceReducer,
} from './workspace';

function workspaceWithTasks(): { document: WorkspaceDocument; projectId: string; firstId: string; secondId: string } {
  const document = createEmptyWorkspace('Regression workspace');
  const projectId = document.projects[0].id;
  const first = createWorkItem(projectId, 'backlog', 'First', 1000);
  const second = createWorkItem(projectId, 'planned', 'Second', 2000);
  return {
    document: { ...document, items: { [first.id]: first, [second.id]: second } },
    projectId,
    firstId: first.id,
    secondId: second.id,
  };
}

function attachment(id = '10000000-0000-4000-8000-000000000001'): WorkspaceAttachment {
  return {
    id,
    name: 'brief.pdf',
    kind: 'file',
    relativePath: `.kanbanos/content/attachments/${id}/brief.pdf`,
    sizeBytes: 512,
    fileCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('workspace factories', () => {
  it('keeps factory defaults independent and exposes complete metadata', () => {
    const first = createProjectSettings();
    const second = createProjectSettings();
    first.columns[0].title = 'Changed';

    expect(second.columns).toEqual(DEFAULT_COLUMNS);
    expect(PROJECT_COLORS).toHaveLength(6);
    expect(CANVAS_NODE_COLORS).toHaveLength(6);
    expect(ROADMAP_HORIZONS).toEqual(['Now', 'Next', 'Later']);
    expect(Object.keys(PRIORITY_META)).toEqual(['none', 'low', 'medium', 'high', 'urgent']);
    expect(createCanvasProject()).toEqual({
      name: 'Canvas 1',
      nodes: {},
      connections: {},
      strokes: {},
      viewport: { x: 0, y: 0, zoom: 1 },
      activeViewId: 'canvas-main',
      views: {},
    });
  });

  it('creates projects, tasks, canvas objects, and strokes with safe defaults', () => {
    const project = createProject('Launch', '#123456', 'Ship it');
    const task = createWorkItem(project.id, 'planned', 'Prepare', 1000);
    const note = createCanvasNode('note', { x: 10, y: 20 });
    const shape = createCanvasNode('shape', { x: 30, y: 40 });
    const connection = createCanvasConnection(note.id, shape.id);
    const stroke = createCanvasStroke([{ x: 0, y: 0 }, { x: 5, y: 5 }]);

    expect(project).toMatchObject({ name: 'Launch', description: 'Ship it', archived: false });
    expect(task).toMatchObject({ description: '', priority: 'none', labels: [], subtasks: [], attachmentIds: [], links: [] });
    expect(note).toMatchObject({ width: 260, height: 220, rotation: 0, zIndex: 1, color: CANVAS_NODE_COLORS[0] });
    expect(shape).toMatchObject({ width: 230, height: 160, shape: 'rectangle' });
    expect(connection).toMatchObject({ relation: 'association', label: '', sourceLabel: '', targetLabel: '' });
    expect(stroke).toMatchObject({ color: '#5147a6', width: 4 });
  });

  it('creates a realistic demo workspace whose projects all have board and canvas settings', () => {
    const document = createDefaultWorkspace('Demo');

    expect(document.workspace.name).toBe('Demo');
    expect(document.projects).toHaveLength(3);
    expect(Object.keys(document.items).length).toBeGreaterThan(10);
    for (const project of document.projects) {
      expect(document.modules.kanban.projects[project.id].columns).toHaveLength(4);
      expect(document.modules.canvas.projects[project.id]).toBeDefined();
    }
    expect(isWorkspaceDocument(document)).toBe(true);
  });
});

describe('project, task, and column actions', () => {
  it('selects, adds, and updates projects while provisioning every module', () => {
    const document = createEmptyWorkspace();
    const project = createProject('Second project', '#abcdef');
    const added = workspaceReducer(document, { type: 'addProject', project, settings: createProjectSettings() });
    const updated = workspaceReducer(added, {
      type: 'updateProject',
      projectId: project.id,
      changes: { name: 'Renamed', targetDate: '2027-06-01' },
    });
    const selected = workspaceReducer(updated, { type: 'selectProject', projectId: document.projects[0].id });

    expect(added.preferences.activeProjectId).toBe(project.id);
    expect(added.modules.kanban.projects[project.id]).toBeDefined();
    expect(added.modules.canvas.projects[project.id]).toEqual(createCanvasProject());
    expect(updated.projects.find((value) => value.id === project.id)).toMatchObject({ name: 'Renamed', targetDate: '2027-06-01' });
    expect(selected.preferences.activeProjectId).toBe(document.projects[0].id);
  });

  it('adds and updates tasks without replacing unrelated records', () => {
    const { document, projectId, firstId } = workspaceWithTasks();
    const addedTask = createWorkItem(projectId, 'progress', 'Third', 3000);
    const added = workspaceReducer(document, { type: 'addItem', item: addedTask });
    const updated = workspaceReducer(added, {
      type: 'updateItem',
      itemId: firstId,
      changes: { title: 'Updated', priority: 'urgent', assignee: 'QA' },
    });

    expect(added.items[addedTask.id]).toEqual(addedTask);
    expect(updated.items[firstId]).toMatchObject({ title: 'Updated', priority: 'urgent', assignee: 'QA' });
    expect(updated.items[addedTask.id]).toEqual(addedTask);
    expect(workspaceReducer(updated, { type: 'updateItem', itemId: 'missing', changes: { title: 'Nope' } })).toBe(updated);
  });

  it('adds, updates, reorders, and deletes columns while moving affected tasks', () => {
    const { document, projectId, firstId } = workspaceWithTasks();
    const added = workspaceReducer(document, {
      type: 'addColumn',
      projectId,
      column: { id: 'review', title: 'Review', color: '#334455', limit: 2 },
    });
    const updated = workspaceReducer(added, {
      type: 'updateColumn',
      projectId,
      columnId: 'review',
      changes: { title: 'Peer review', limit: 3 },
    });
    const reordered = workspaceReducer(updated, {
      type: 'reorderColumns',
      projectId,
      columnIds: ['review', 'review', 'done'],
    });
    const deleted = workspaceReducer(reordered, {
      type: 'deleteColumn',
      projectId,
      columnId: 'backlog',
      moveToColumnId: 'planned',
    });

    expect(updated.modules.kanban.projects[projectId].columns.find((column) => column.id === 'review')).toMatchObject({ title: 'Peer review', limit: 3 });
    expect(reordered.modules.kanban.projects[projectId].columns.map((column) => column.id)).toEqual(['review', 'done', 'backlog', 'planned', 'progress']);
    expect(deleted.modules.kanban.projects[projectId].columns.some((column) => column.id === 'backlog')).toBe(false);
    expect(deleted.items[firstId].moduleData.kanban.columnId).toBe('planned');
  });

  it('keeps each column rule unique and transfers rules when a column is deleted', () => {
    const { document, projectId } = workspaceWithTasks();
    const assigned = workspaceReducer(document, {
      type: 'setColumnRule',
      projectId,
      columnId: 'progress',
      rule: 'completed',
    });

    expect(columnForRule(assigned.modules.kanban.projects[projectId].columns, 'completed')?.id).toBe('progress');
    expect(assigned.modules.kanban.projects[projectId].columns.find((column) => column.id === 'done')?.rules).not.toContain('completed');

    const deleted = workspaceReducer(assigned, {
      type: 'deleteColumn',
      projectId,
      columnId: 'progress',
      moveToColumnId: 'backlog',
    });
    expect(columnForRule(deleted.modules.kanban.projects[projectId].columns, 'completed')?.id).toBe('backlog');
  });

  it('moves tasks with clamped indexes and keeps other projects out of the target order', () => {
    const { document, projectId, firstId, secondId } = workspaceWithTasks();
    const other = createProject('Other', '#111111');
    const otherTask = createWorkItem(other.id, 'planned', 'Other task', 500);
    const withOther = {
      ...document,
      projects: [...document.projects, other],
      items: { ...document.items, [otherTask.id]: otherTask },
    };

    const moved = workspaceReducer(withOther, { type: 'moveItem', itemId: firstId, columnId: 'planned', index: 999 });

    expect(itemsForColumn(moved, projectId, 'planned').map((item) => item.id)).toEqual([secondId, firstId]);
    expect(moved.items[otherTask.id]).toEqual(otherTask);
    expect(workspaceReducer(moved, { type: 'moveItem', itemId: 'missing', columnId: 'done', index: 0 })).toBe(moved);
  });

  it('deduplicates requested shared order, ignores foreign ids, and appends omitted tasks', () => {
    const { document, projectId, firstId, secondId } = workspaceWithTasks();
    const third = createWorkItem(projectId, 'done', 'Third', 500);
    const other = createProject('Other', '#111111');
    const foreign = createWorkItem(other.id, 'done', 'Foreign', 100);
    const populated = { ...document, items: { ...document.items, [third.id]: third, [foreign.id]: foreign } };

    const reordered = workspaceReducer(populated, {
      type: 'reorderKanbanItems',
      projectId,
      itemIds: [secondId, secondId, foreign.id],
    });

    expect([secondId, third.id, firstId].map((id) => reordered.items[id].moduleData.kanban.rank)).toEqual([1000, 2000, 3000]);
    expect(reordered.items[foreign.id]).toEqual(foreign);
  });

  it('filters and orders column items by project and rank', () => {
    const { document, projectId, firstId, secondId } = workspaceWithTasks();
    const moved = workspaceReducer(document, { type: 'moveItem', itemId: firstId, columnId: 'planned', index: 0 });

    expect(itemsForColumn(moved, projectId, 'planned').map((item) => item.id)).toEqual([firstId, secondId]);
    expect(itemsForColumn(moved, 'missing', 'planned')).toEqual([]);
  });
});

describe('attachments and deletion cleanup', () => {
  it('deduplicates attachments and leaves invalid attachment actions unchanged', () => {
    const { document, firstId } = workspaceWithTasks();
    const file = attachment();
    const attached = workspaceReducer(document, { type: 'addAttachments', itemId: firstId, attachments: [file, file] });

    expect(attached.items[firstId].attachmentIds).toEqual([file.id]);
    expect(workspaceReducer(attached, { type: 'addAttachments', itemId: firstId, attachments: [] })).toBe(attached);
    expect(workspaceReducer(attached, { type: 'addAttachments', itemId: 'missing', attachments: [file] })).toBe(attached);
    expect(workspaceReducer(attached, { type: 'updateAttachment', attachmentId: 'missing', changes: { title: 'No' } })).toBe(attached);
    expect(workspaceReducer(attached, { type: 'removeAttachment', attachmentId: 'missing' })).toBe(attached);
  });

  it('deleting a task removes dependencies, attachments, canvas references, and collapse preferences', () => {
    const { document, projectId, firstId, secondId } = workspaceWithTasks();
    const file = attachment();
    const taskNode = createCanvasNode('task', { x: 0, y: 0 }, { taskId: firstId });
    const fileNode = createCanvasNode('file', { x: 300, y: 0 }, { attachmentId: file.id });
    const connection = createCanvasConnection(taskNode.id, fileNode.id);
    const populated: WorkspaceDocument = {
      ...document,
      items: {
        ...document.items,
        [firstId]: { ...document.items[firstId], attachmentIds: [file.id] },
        [secondId]: { ...document.items[secondId], dependencyIds: [firstId] },
      },
      resources: { attachments: { [file.id]: file } },
      modules: {
        ...document.modules,
        canvas: {
          version: 1,
          projects: {
            [projectId]: {
              ...createCanvasProject(),
              nodes: { [taskNode.id]: taskNode, [fileNode.id]: fileNode },
              connections: { [connection.id]: connection },
            },
          },
        },
      },
      preferences: { ...document.preferences, collapsedKanbanSubtaskItemIds: [firstId] },
    };

    const deleted = workspaceReducer(populated, { type: 'deleteItem', itemId: firstId });

    expect(deleted.items[firstId]).toBeUndefined();
    expect(deleted.items[secondId].dependencyIds).toEqual([]);
    expect(deleted.resources.attachments[file.id]).toBeUndefined();
    expect(deleted.modules.canvas.projects[projectId].nodes).toEqual({});
    expect(deleted.modules.canvas.projects[projectId].connections).toEqual({});
    expect(deleted.preferences.collapsedKanbanSubtaskItemIds).toEqual([]);
  });
});

describe('preferences and normalization', () => {
  it('persists the shared Kanban and timeline project scope when the workspace is reloaded', () => {
    const document = createEmptyWorkspace();
    const allProjects = workspaceReducer(document, { type: 'setProjectScope', scope: 'all' });

    expect(allProjects.preferences.projectScope).toBe('all');
    expect(isWorkspaceDocument(JSON.parse(JSON.stringify(allProjects)))).toBe(true);
    const reloaded = normalizeWorkspaceDocument(JSON.parse(JSON.stringify(allProjects)) as WorkspaceDocument);
    expect(reloaded.preferences.projectScope).toBe('all');
  });

  it('persists timeline positions when the workspace is saved and reloaded', () => {
    const document = createEmptyWorkspace();
    const zoomed = workspaceReducer(document, { type: 'setTimelineZoom', zoom: 'four-weeks' });
    const positioned = workspaceReducer(zoomed, {
      type: 'setTimelineWindowStart',
      zoom: 'two-weeks',
      startDate: '2026-08-23',
    });

    expect(positioned.preferences.timelineZoom).toBe('four-weeks');
    expect(positioned.preferences.timelineWindowStarts).toEqual({ 'two-weeks': '2026-08-23' });
    expect(isWorkspaceDocument(JSON.parse(JSON.stringify(positioned)))).toBe(true);
    const reloaded = normalizeWorkspaceDocument(JSON.parse(JSON.stringify(positioned)) as WorkspaceDocument);
    expect(reloaded.preferences.timelineZoom).toBe('four-weeks');
    expect(reloaded.preferences.timelineWindowStarts).toEqual({ 'two-weeks': '2026-08-23' });
  });

  it('persists valid timeline working days and restores safe defaults for legacy data', () => {
    const document = createEmptyWorkspace();
    const weekdays = workspaceReducer(document, { type: 'setTimelineWorkingDays', days: [5, 1, 3, 2, 4] });

    expect(weekdays.preferences.timelineWorkingDays).toEqual([1, 2, 3, 4, 5]);
    expect(isWorkspaceDocument(JSON.parse(JSON.stringify(weekdays)))).toBe(true);
    const reloaded = normalizeWorkspaceDocument(JSON.parse(JSON.stringify(weekdays)) as WorkspaceDocument);
    expect(reloaded.preferences.timelineWorkingDays).toEqual([1, 2, 3, 4, 5]);

    const legacy = { ...document, preferences: { activeProjectId: document.preferences.activeProjectId } } as WorkspaceDocument;
    expect(normalizeWorkspaceDocument(legacy).preferences.timelineWorkingDays).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(workspaceReducer(weekdays, { type: 'setTimelineWorkingDays', days: [] })).toBe(weekdays);
  });

  it('loads and normalizes legacy documents through the reducer', () => {
    const { document, firstId } = workspaceWithTasks();
    const legacy = {
      ...document,
      items: { [firstId]: { ...document.items[firstId], dependencyIds: undefined, attachmentIds: undefined, links: undefined } },
      modules: { kanban: document.modules.kanban },
      resources: undefined,
      preferences: { activeProjectId: document.preferences.activeProjectId },
    } as unknown as WorkspaceDocument;

    const loaded = workspaceReducer(document, { type: 'load', document: legacy });

    expect(loaded.items[firstId]).toMatchObject({ dependencyIds: [], attachmentIds: [], links: [] });
    expect(loaded.modules.canvas.projects[document.projects[0].id]).toEqual(createCanvasProject());
    expect(loaded.resources.attachments).toEqual({});
    expect(loaded.preferences.projectScope).toBe('current');
  });

  it('normalizes horizon order, stale collapse ids, invalid connections, and viewport bounds', () => {
    const { document, projectId, firstId } = workspaceWithTasks();
    const node = createCanvasNode('note', { x: 0, y: 0 });
    const missingNode = createCanvasNode('shape', { x: 10, y: 10 });
    const staleConnection = createCanvasConnection(node.id, missingNode.id);
    const legacy = {
      ...document,
      modules: {
        ...document.modules,
        canvas: {
          version: 1 as const,
          projects: {
            [projectId]: {
              nodes: { [node.id]: node },
              connections: { [staleConnection.id]: staleConnection },
              strokes: {},
              viewport: { x: 10, y: 20, zoom: 99 },
            },
          },
        },
      },
      preferences: {
        ...document.preferences,
        roadmapHorizonOrder: ['Later', 'Later'] as typeof ROADMAP_HORIZONS,
        timelineLayout: 'compact' as const,
        collapsedKanbanSubtaskItemIds: [firstId, firstId, 'missing'],
      },
    } as unknown as WorkspaceDocument;

    const normalized = normalizeWorkspaceDocument(legacy);

    expect(normalized.preferences.roadmapHorizonOrder).toEqual(['Later', 'Now', 'Next']);
    expect(normalized.preferences.collapsedKanbanSubtaskItemIds).toEqual([firstId]);
    expect(normalized.preferences.timelineLayout).toBe('compact');
    expect(normalized.modules.canvas.projects[projectId].connections).toEqual({});
    expect(normalized.modules.canvas.projects[projectId].viewport).toEqual({ x: 10, y: 20, zoom: 2.5 });
  });

  it('does not mutate state for redundant or invalid preference actions', () => {
    const { document, firstId } = workspaceWithTasks();
    const compact = workspaceReducer(document, { type: 'setTimelineLayout', layout: 'compact' });
    const collapsed = workspaceReducer(compact, { type: 'setKanbanSubtasksCollapsed', itemId: firstId, collapsed: true });

    expect(workspaceReducer(compact, { type: 'setTimelineLayout', layout: 'compact' })).toBe(compact);
    expect(workspaceReducer(collapsed, { type: 'setKanbanSubtasksCollapsed', itemId: firstId, collapsed: true })).toBe(collapsed);
    expect(workspaceReducer(collapsed, { type: 'setKanbanSubtasksCollapsed', itemId: 'missing', collapsed: true })).toBe(collapsed);
  });

  it('restores a complete roadmap order from partial or duplicate actions', () => {
    const document = createEmptyWorkspace();
    const reordered = workspaceReducer(document, { type: 'reorderRoadmapColumns', horizons: ['Next', 'Next'] });
    expect(reordered.preferences.roadmapHorizonOrder).toEqual(['Next', 'Now', 'Later']);
  });
});

describe('canvas actions', () => {
  it('creates, switches, renames, and deletes isolated canvas views', () => {
    const document = createEmptyWorkspace();
    const projectId = document.projects[0].id;
    const primaryNote = createCanvasNode('note', { x: 10, y: 20 }, { content: 'Primary idea' });
    const withPrimaryNote = workspaceReducer(document, { type: 'canvasAddNode', projectId, node: primaryNote });
    const secondView = createCanvasView('Launch map');
    const withSecondView = workspaceReducer(withPrimaryNote, { type: 'canvasAddView', projectId, view: secondView });
    const secondNote = createCanvasNode('note', { x: 80, y: 90 }, { content: 'Launch idea' });
    const withSecondNote = workspaceReducer(withSecondView, {
      type: 'canvasAddNode',
      projectId,
      canvasViewId: secondView.id,
      node: secondNote,
    });

    const canvasProject = withSecondNote.modules.canvas.projects[projectId];
    expect(canvasViewsForProject(canvasProject).map((view) => view.name)).toEqual(['Canvas 1', 'Launch map']);
    expect(activeCanvasView(canvasProject).id).toBe(secondView.id);
    expect(canvasProject.nodes[primaryNote.id]).toEqual(primaryNote);
    expect(canvasProject.nodes[secondNote.id]).toBeUndefined();
    expect(canvasProject.views[secondView.id].nodes[secondNote.id]).toEqual(secondNote);

    const promoted = workspaceReducer(withSecondNote, { type: 'canvasDeleteView', projectId, canvasViewId: 'canvas-main' });
    expect(promoted.modules.canvas.projects[projectId]).toMatchObject({ name: 'Launch map', activeViewId: 'canvas-main' });
    expect(promoted.modules.canvas.projects[projectId].nodes[secondNote.id]).toEqual(secondNote);
    expect(promoted.modules.canvas.projects[projectId].views).toEqual({});

    const renamed = workspaceReducer(withSecondNote, {
      type: 'canvasRenameView',
      projectId,
      canvasViewId: secondView.id,
      name: '  Release map  ',
    });
    const selected = workspaceReducer(renamed, { type: 'canvasSelectView', projectId, canvasViewId: 'canvas-main' });
    const deleted = workspaceReducer(selected, { type: 'canvasDeleteView', projectId, canvasViewId: secondView.id });

    expect(renamed.modules.canvas.projects[projectId].views[secondView.id].name).toBe('Release map');
    expect(activeCanvasView(selected.modules.canvas.projects[projectId]).nodes[primaryNote.id]).toEqual(primaryNote);
    expect(canvasViewsForProject(deleted.modules.canvas.projects[projectId])).toHaveLength(1);
    expect(workspaceReducer(deleted, { type: 'canvasDeleteView', projectId, canvasViewId: 'canvas-main' })).toBe(deleted);
  });

  function canvasFixture() {
    const document = createEmptyWorkspace();
    const projectId = document.projects[0].id;
    const first = createCanvasNode('note', { x: 0, y: 0 });
    const second = createCanvasNode('shape', { x: 400, y: 0 });
    const withFirst = workspaceReducer(document, { type: 'canvasAddNode', projectId, node: first });
    const withNodes = workspaceReducer(withFirst, { type: 'canvasAddNode', projectId, node: second });
    return { document: withNodes, projectId, first, second };
  }

  it('updates one or many existing nodes and ignores missing targets', () => {
    const { document, projectId, first, second } = canvasFixture();
    const single = workspaceReducer(document, { type: 'canvasUpdateNode', projectId, nodeId: first.id, changes: { content: 'Idea', rotation: 12 } });
    const many = workspaceReducer(single, {
      type: 'canvasUpdateNodes',
      projectId,
      updates: [{ nodeId: first.id, changes: { x: 50 } }, { nodeId: second.id, changes: { y: 80 } }, { nodeId: 'missing', changes: { x: 9 } }],
    });

    expect(single.modules.canvas.projects[projectId].nodes[first.id]).toMatchObject({ content: 'Idea', rotation: 12 });
    expect(many.modules.canvas.projects[projectId].nodes[first.id].x).toBe(50);
    expect(many.modules.canvas.projects[projectId].nodes[second.id].y).toBe(80);
    expect(workspaceReducer(many, { type: 'canvasUpdateNode', projectId, nodeId: 'missing', changes: { x: 1 } })).toBe(many);
    expect(workspaceReducer(many, { type: 'canvasUpdateNodes', projectId, updates: [] })).toBe(many);
  });

  it('only creates valid, non-duplicate connections and supports editing and deletion', () => {
    const { document, projectId, first, second } = canvasFixture();
    const connection = createCanvasConnection(first.id, second.id, '#111111', 'dependency');
    const connected = workspaceReducer(document, { type: 'canvasAddConnection', projectId, connection });
    const duplicate = workspaceReducer(connected, { type: 'canvasAddConnection', projectId, connection: { ...connection, id: 'duplicate' } });
    const selfConnection = createCanvasConnection(first.id, first.id);
    const edited = workspaceReducer(duplicate, {
      type: 'canvasUpdateConnection',
      projectId,
      connectionId: connection.id,
      changes: { relation: 'composition', label: 'owns' },
    });
    const deleted = workspaceReducer(edited, { type: 'canvasDeleteConnection', projectId, connectionId: connection.id });

    expect(Object.keys(connected.modules.canvas.projects[projectId].connections)).toEqual([connection.id]);
    expect(duplicate).toBe(connected);
    expect(workspaceReducer(connected, { type: 'canvasAddConnection', projectId, connection: selfConnection })).toBe(connected);
    expect(edited.modules.canvas.projects[projectId].connections[connection.id]).toMatchObject({ relation: 'composition', label: 'owns' });
    expect(deleted.modules.canvas.projects[projectId].connections).toEqual({});
    expect(workspaceReducer(deleted, { type: 'canvasDeleteConnection', projectId, connectionId: 'missing' })).toBe(deleted);
  });

  it('adds and deletes valid strokes while rejecting one-point drawings', () => {
    const { document, projectId } = canvasFixture();
    const invalid = createCanvasStroke([{ x: 0, y: 0 }]);
    const valid = createCanvasStroke([{ x: 0, y: 0 }, { x: 1, y: 1 }]);

    expect(workspaceReducer(document, { type: 'canvasAddStroke', projectId, stroke: invalid })).toBe(document);
    const drawn = workspaceReducer(document, { type: 'canvasAddStroke', projectId, stroke: valid });
    expect(drawn.modules.canvas.projects[projectId].strokes[valid.id]).toEqual(valid);
    const erased = workspaceReducer(drawn, { type: 'canvasDeleteStroke', projectId, strokeId: valid.id });
    expect(erased.modules.canvas.projects[projectId].strokes).toEqual({});
    expect(workspaceReducer(erased, { type: 'canvasDeleteStroke', projectId, strokeId: 'missing' })).toBe(erased);
  });

  it('clamps and sanitizes viewport changes and provisions unknown canvas projects', () => {
    const document = createEmptyWorkspace();
    const projectId = document.projects[0].id;
    const moved = workspaceReducer(document, {
      type: 'canvasSetViewport',
      projectId,
      viewport: { x: Number.NaN, y: Number.POSITIVE_INFINITY, zoom: 10 },
    });
    const externalProject = workspaceReducer(document, {
      type: 'canvasSetViewport',
      projectId: 'external',
      viewport: { x: 4, y: 5, zoom: 0.01 },
    });

    expect(moved.modules.canvas.projects[projectId].viewport).toEqual({ x: 0, y: 0, zoom: 2.5 });
    expect(externalProject.modules.canvas.projects.external.viewport).toEqual({ x: 4, y: 5, zoom: 0.15 });
    expect(workspaceReducer(moved, { type: 'canvasSetViewport', projectId, viewport: moved.modules.canvas.projects[projectId].viewport })).toBe(moved);
  });

  it('imports canvas resources atomically and removes all matching resource nodes', () => {
    const { document, projectId } = canvasFixture();
    const file = attachment();
    const firstFileNode = createCanvasNode('file', { x: 10, y: 20 }, { attachmentId: file.id });
    const secondFileNode = createCanvasNode('file', { x: 30, y: 40 }, { attachmentId: file.id });
    const imported = workspaceReducer(document, {
      type: 'canvasAddAttachments',
      projectId,
      attachments: [file],
      nodes: [firstFileNode, secondFileNode],
    });

    expect(imported.resources.attachments[file.id]).toEqual(file);
    expect(imported.modules.canvas.projects[projectId].nodes[firstFileNode.id]).toEqual(firstFileNode);
    const removed = workspaceReducer(imported, { type: 'removeAttachment', attachmentId: file.id });
    expect(removed.modules.canvas.projects[projectId].nodes[firstFileNode.id]).toBeUndefined();
    expect(removed.modules.canvas.projects[projectId].nodes[secondFileNode.id]).toBeUndefined();
    expect(workspaceReducer(document, { type: 'canvasAddAttachments', projectId, attachments: [], nodes: [] })).toBe(document);
  });

  it('deletes multiple selected nodes and every connected edge', () => {
    const { document, projectId, first, second } = canvasFixture();
    const third: CanvasNode = createCanvasNode('note', { x: 800, y: 0 });
    const withThird = workspaceReducer(document, { type: 'canvasAddNode', projectId, node: third });
    const firstConnection = createCanvasConnection(first.id, second.id);
    const secondConnection = createCanvasConnection(second.id, third.id);
    const connected = workspaceReducer(
      workspaceReducer(withThird, { type: 'canvasAddConnection', projectId, connection: firstConnection }),
      { type: 'canvasAddConnection', projectId, connection: secondConnection },
    );

    const deleted = workspaceReducer(connected, { type: 'canvasDeleteNodes', projectId, nodeIds: [first.id, third.id, 'missing'] });

    expect(Object.keys(deleted.modules.canvas.projects[projectId].nodes)).toEqual([second.id]);
    expect(deleted.modules.canvas.projects[projectId].connections).toEqual({});
    expect(workspaceReducer(deleted, { type: 'canvasDeleteNodes', projectId, nodeIds: ['missing'] })).toBe(deleted);
  });
});

describe('workspace document validation', () => {
  it('rejects malformed projects, tasks, columns, resources, preferences, and canvas data', () => {
    const valid = createEmptyWorkspace();
    const projectId = valid.projects[0].id;
    const task = createWorkItem(projectId, 'planned', 'Task', 1000);
    const withTask = { ...valid, items: { [task.id]: task } };
    const cases: unknown[] = [
      { ...valid, projects: [{ ...valid.projects[0], name: 42 }] },
      { ...withTask, items: { [task.id]: { ...task, labels: 'bad' } } },
      { ...withTask, items: { [task.id]: { ...task, links: [{ id: '1', url: 'ftp://example.com', createdAt: 'now' }] } } },
      { ...valid, modules: { ...valid.modules, kanban: { ...valid.modules.kanban, projects: { [projectId]: { columns: [{ id: 1, title: 'Bad' }] } } } } },
      { ...valid, resources: { attachments: { bad: { ...attachment(), kind: 'link' } } } },
      { ...valid, preferences: { ...valid.preferences, timelineLayout: 'wide' } },
      { ...valid, preferences: { ...valid.preferences, projectScope: 'favorites' } },
      { ...valid, preferences: { ...valid.preferences, timelineWorkingDays: [] } },
      { ...valid, preferences: { ...valid.preferences, timelineWorkingDays: [1, 1] } },
      { ...valid, preferences: { ...valid.preferences, collapsedKanbanSubtaskItemIds: [1] } },
      { ...valid, modules: { ...valid.modules, canvas: { version: 2, projects: {} } } },
    ];

    expect(isWorkspaceDocument(valid)).toBe(true);
    for (const candidate of cases) expect(isWorkspaceDocument(candidate)).toBe(false);
  });
});
