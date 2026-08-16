import { describe, expect, it } from 'vitest';
import {
  activeCanvasView,
  canvasViewsForProject,
  createCanvasConnection,
  createCanvasNode,
  createCanvasStroke,
  createCanvasView,
  columnForRule,
  createEmptyWorkspace,
  createWorkItem,
  isWorkspaceDocument,
  itemsForColumn,
  normalizeWorkspaceDocument,
  workspaceReducer,
} from './workspace';

describe('workspace domain', () => {
  it('creates a valid empty workspace with the requested name', () => {
    const workspace = createEmptyWorkspace('Design team');

    expect(workspace.workspace.name).toBe('Design team');
    expect(workspace.projects).toHaveLength(1);
    const columns = workspace.modules.kanban.projects[workspace.projects[0].id].columns;
    expect(columns).toHaveLength(4);
    expect(columnForRule(columns, 'new-task')?.id).toBe('planned');
    expect(columnForRule(columns, 'completed')?.id).toBe('done');
    expect(isWorkspaceDocument(workspace)).toBe(true);
  });

  it('keeps planning details on tasks so timeline and estimate views share one source of truth', () => {
    const workspace = createEmptyWorkspace();
    const projectId = workspace.projects[0].id;
    const task = createWorkItem(projectId, 'planned', 'Plan the release', 1000, {
      startDate: '2026-08-10',
      dueDate: '2026-08-14',
      estimateMinutes: 150,
    });

    expect(task.startDate).toBe('2026-08-10');
    expect(task.dueDate).toBe('2026-08-14');
    expect(task.estimateMinutes).toBe(150);
    expect(task.dependencyIds).toEqual([]);
  });

  it('removes deleted tasks from dependency chains', () => {
    const workspace = createEmptyWorkspace();
    const projectId = workspace.projects[0].id;
    const foundation = createWorkItem(projectId, 'planned', 'Foundation', 1000);
    const launch = createWorkItem(projectId, 'planned', 'Launch', 2000, { dependencyIds: [foundation.id] });
    const document = { ...workspace, items: { [foundation.id]: foundation, [launch.id]: launch } };

    const updated = workspaceReducer(document, { type: 'deleteItem', itemId: foundation.id });

    expect(updated.items[foundation.id]).toBeUndefined();
    expect(updated.items[launch.id].dependencyIds).toEqual([]);
  });

  it('links attachment metadata to tasks and removes it cleanly', () => {
    const workspace = createEmptyWorkspace();
    const projectId = workspace.projects[0].id;
    const task = createWorkItem(projectId, 'planned', 'Review brief', 1000);
    const document = { ...workspace, items: { [task.id]: task } };
    const attachment = {
      id: '21027d83-bfd8-49ee-986a-902dc8deec10',
      name: 'brief.pdf',
      kind: 'file' as const,
      relativePath: '.kanbanos/content/attachments/21027d83-bfd8-49ee-986a-902dc8deec10/brief.pdf',
      sizeBytes: 1024,
      fileCount: 1,
      createdAt: '2026-08-10T12:00:00.000Z',
    };

    const attached = workspaceReducer(document, { type: 'addAttachments', itemId: task.id, attachments: [attachment] });
    expect(attached.items[task.id].attachmentIds).toEqual([attachment.id]);
    expect(attached.resources.attachments[attachment.id]).toEqual(attachment);

    const described = workspaceReducer(attached, {
      type: 'updateAttachment',
      attachmentId: attachment.id,
      changes: { title: 'Launch brief', description: 'Approved copy for the launch.' },
    });
    expect(described.resources.attachments[attachment.id].title).toBe('Launch brief');
    expect(described.resources.attachments[attachment.id].description).toBe('Approved copy for the launch.');

    const removed = workspaceReducer(described, { type: 'removeAttachment', attachmentId: attachment.id });
    expect(removed.items[task.id].attachmentIds).toEqual([]);
    expect(removed.resources.attachments[attachment.id]).toBeUndefined();
  });

  it('stores web links on tasks and validates their metadata', () => {
    const workspace = createEmptyWorkspace();
    const projectId = workspace.projects[0].id;
    const task = createWorkItem(projectId, 'planned', 'Review launch page', 1000, {
      links: [{
        id: 'link-1',
        title: 'example.com',
        url: 'https://example.com/launch',
        createdAt: '2026-08-10T12:00:00.000Z',
      }],
    });
    const document = { ...workspace, items: { [task.id]: task } };

    expect(task.links).toHaveLength(1);
    expect(isWorkspaceDocument(document)).toBe(true);

    const unsafeDocument = {
      ...document,
      items: {
        [task.id]: {
          ...task,
          links: [{ ...task.links![0], url: 'javascript:alert(1)' }],
        },
      },
    };
    expect(isWorkspaceDocument(unsafeDocument)).toBe(false);
  });

  it('normalizes workspaces created before attachment and task-link storage existed', () => {
    const workspace = createEmptyWorkspace();
    const projectId = workspace.projects[0].id;
    const task = createWorkItem(projectId, 'planned', 'Legacy task', 1000);
    const { links: _links, ...legacyTask } = task;
    const legacy = {
      ...workspace,
      items: { [task.id]: legacyTask },
      resources: undefined,
    } as unknown as typeof workspace;
    const normalized = normalizeWorkspaceDocument(legacy);

    expect(normalized.resources.attachments).toEqual({});
    expect(normalized.items[task.id].links).toEqual([]);
  });

  it('migrates legacy column identities into durable rules', () => {
    const workspace = createEmptyWorkspace();
    const projectId = workspace.projects[0].id;
    const legacy = {
      ...workspace,
      modules: {
        ...workspace.modules,
        kanban: {
          ...workspace.modules.kanban,
          projects: {
            ...workspace.modules.kanban.projects,
            [projectId]: {
              columns: workspace.modules.kanban.projects[projectId].columns.map(({ rules: _rules, ...column }) => column),
            },
          },
        },
      },
    };

    const normalized = normalizeWorkspaceDocument(legacy);
    expect(columnForRule(normalized.modules.kanban.projects[projectId].columns, 'new-task')?.id).toBe('planned');
    expect(columnForRule(normalized.modules.kanban.projects[projectId].columns, 'completed')?.id).toBe('done');
    expect(normalized.modules.kanban.projects[projectId].columns.every((column) => Array.isArray(column.rules))).toBe(true);
  });

  it('moves an item into a column and assigns ordered ranks', () => {
    const workspace = createEmptyWorkspace();
    const projectId = workspace.projects[0].id;
    const first = createWorkItem(projectId, 'backlog', 'First task', 1000);
    const existing = createWorkItem(projectId, 'planned', 'Existing task', 1000);
    const document = {
      ...workspace,
      items: { [first.id]: first, [existing.id]: existing },
    };

    const moved = workspaceReducer(document, {
      type: 'moveItem',
      itemId: first.id,
      columnId: 'planned',
      index: 1,
    });
    const plannedItems = itemsForColumn(moved, projectId, 'planned');

    expect(plannedItems.map((item) => item.id)).toEqual([existing.id, first.id]);
    expect(plannedItems.map((item) => item.moduleData.kanban.rank)).toEqual([1000, 2000]);
  });

  it('reorders kanban columns without changing their settings', () => {
    const workspace = createEmptyWorkspace();
    const projectId = workspace.projects[0].id;
    const original = workspace.modules.kanban.projects[projectId].columns;

    const reordered = workspaceReducer(workspace, {
      type: 'reorderColumns',
      projectId,
      columnIds: ['done', 'backlog', 'planned', 'progress'],
    });

    expect(reordered.modules.kanban.projects[projectId].columns.map((column) => column.id)).toEqual([
      'done',
      'backlog',
      'planned',
      'progress',
    ]);
    expect(reordered.modules.kanban.projects[projectId].columns.find((column) => column.id === 'planned')?.limit)
      .toBe(original.find((column) => column.id === 'planned')?.limit);
  });

  it('persists roadmap column order', () => {
    const workspace = createEmptyWorkspace();

    const reordered = workspaceReducer(workspace, {
      type: 'reorderRoadmapColumns',
      horizons: ['Later', 'Now', 'Next'],
    });

    expect(reordered.preferences.roadmapHorizonOrder).toEqual(['Later', 'Now', 'Next']);
  });

  it('normalizes view preferences for older workspaces', () => {
    const workspace = createEmptyWorkspace();
    const legacy = { ...workspace, preferences: { activeProjectId: workspace.preferences.activeProjectId } };
    const normalized = normalizeWorkspaceDocument(legacy);

    expect(normalized.preferences.roadmapHorizonOrder).toEqual(['Now', 'Next', 'Later']);
    expect(normalized.preferences.timelineLayout).toBe('tasks');
    expect(normalized.preferences.collapsedKanbanSubtaskItemIds).toEqual([]);
  });

  it('persists the selected timeline layout in workspace preferences', () => {
    const workspace = createEmptyWorkspace();

    const compact = workspaceReducer(workspace, { type: 'setTimelineLayout', layout: 'compact' });
    expect(compact.preferences.timelineLayout).toBe('compact');

    const taskRows = workspaceReducer(compact, { type: 'setTimelineLayout', layout: 'tasks' });
    expect(taskRows.preferences.timelineLayout).toBe('tasks');
  });

  it('remembers collapsed Kanban subtask cards and cleans up deleted tasks', () => {
    const workspace = createEmptyWorkspace();
    const projectId = workspace.projects[0].id;
    const task = createWorkItem(projectId, 'planned', 'Task with subtasks', 1000, {
      subtasks: [{ id: 'subtask-1', title: 'First step', completed: false }],
    });
    const document = { ...workspace, items: { [task.id]: task } };

    const collapsed = workspaceReducer(document, {
      type: 'setKanbanSubtasksCollapsed',
      itemId: task.id,
      collapsed: true,
    });
    expect(collapsed.preferences.collapsedKanbanSubtaskItemIds).toEqual([task.id]);

    const expanded = workspaceReducer(collapsed, {
      type: 'setKanbanSubtasksCollapsed',
      itemId: task.id,
      collapsed: false,
    });
    expect(expanded.preferences.collapsedKanbanSubtaskItemIds).toEqual([]);

    const deleted = workspaceReducer(collapsed, { type: 'deleteItem', itemId: task.id });
    expect(deleted.preferences.collapsedKanbanSubtaskItemIds).toEqual([]);
  });

  it('uses Kanban ranks as the shared task order', () => {
    const workspace = createEmptyWorkspace();
    const projectId = workspace.projects[0].id;
    const first = createWorkItem(projectId, 'planned', 'First task', 1000);
    const second = createWorkItem(projectId, 'planned', 'Second task', 2000);
    const document = { ...workspace, items: { [first.id]: first, [second.id]: second } };

    const reordered = workspaceReducer(document, { type: 'moveItem', itemId: first.id, columnId: 'planned', index: 1 });
    const plannedItems = itemsForColumn(reordered, projectId, 'planned');

    expect(plannedItems.map((item) => item.id)).toEqual([second.id, first.id]);
    expect(plannedItems.map((item) => item.moduleData.kanban.rank)).toEqual([1000, 2000]);
  });

  it('reorders the shared Kanban sequence without changing task columns', () => {
    const workspace = createEmptyWorkspace();
    const projectId = workspace.projects[0].id;
    const first = createWorkItem(projectId, 'planned', 'First task', 1000);
    const second = createWorkItem(projectId, 'progress', 'Second task', 1000);
    const third = createWorkItem(projectId, 'planned', 'Third task', 2000);
    const document = { ...workspace, items: { [first.id]: first, [second.id]: second, [third.id]: third } };

    const reordered = workspaceReducer(document, {
      type: 'reorderKanbanItems',
      projectId,
      itemIds: [second.id, third.id, first.id],
    });

    expect(reordered.items[second.id].moduleData.kanban.rank).toBe(1000);
    expect(reordered.items[third.id].moduleData.kanban.rank).toBe(2000);
    expect(reordered.items[first.id].moduleData.kanban.rank).toBe(3000);
    expect(reordered.items[second.id].moduleData.kanban.columnId).toBe('progress');
    expect(itemsForColumn(reordered, projectId, 'planned').map((item) => item.id)).toEqual([third.id, first.id]);
  });

  it('persists canvas nodes, connections, drawings, and viewport changes', () => {
    const workspace = createEmptyWorkspace();
    const projectId = workspace.projects[0].id;
    const note = createCanvasNode('note', { x: -120, y: 80 }, { content: 'Launch ideas' });
    const shape = createCanvasNode('shape', { x: 260, y: 120 }, { shape: 'ellipse' });
    const connection = createCanvasConnection(note.id, shape.id);
    const stroke = createCanvasStroke([{ x: 10, y: 20 }, { x: 40, y: 55 }, { x: 90, y: 70 }]);

    const withNote = workspaceReducer(workspace, { type: 'canvasAddNode', projectId, node: note });
    const withShape = workspaceReducer(withNote, { type: 'canvasAddNode', projectId, node: shape });
    const connected = workspaceReducer(withShape, { type: 'canvasAddConnection', projectId, connection });
    const drawn = workspaceReducer(connected, { type: 'canvasAddStroke', projectId, stroke });
    const moved = workspaceReducer(drawn, {
      type: 'canvasUpdateNodes',
      projectId,
      updates: [{ nodeId: note.id, changes: { x: 20, y: 30 } }],
    });
    const viewed = workspaceReducer(moved, {
      type: 'canvasSetViewport',
      projectId,
      viewport: { x: 140, y: -60, zoom: 1.35 },
    });

    expect(viewed.modules.canvas.projects[projectId].nodes[note.id].x).toBe(20);
    expect(viewed.modules.canvas.projects[projectId].connections[connection.id]).toEqual(connection);
    expect(viewed.modules.canvas.projects[projectId].strokes[stroke.id]).toEqual(stroke);
    expect(viewed.modules.canvas.projects[projectId].viewport).toEqual({ x: 140, y: -60, zoom: 1.35 });
    expect(isWorkspaceDocument(viewed)).toBe(true);
  });

  it('persists multiple named canvases with independent content and viewports', () => {
    const workspace = createEmptyWorkspace();
    const projectId = workspace.projects[0].id;
    const planning = createCanvasView('Release planning');
    const note = createCanvasNode('note', { x: 40, y: 70 }, { content: 'Independent plan' });
    const withView = workspaceReducer(workspace, { type: 'canvasAddView', projectId, view: planning });
    const withNote = workspaceReducer(withView, { type: 'canvasAddNode', projectId, canvasViewId: planning.id, node: note });
    const viewed = workspaceReducer(withNote, {
      type: 'canvasSetViewport',
      projectId,
      canvasViewId: planning.id,
      viewport: { x: 125, y: -80, zoom: 1.4 },
    });

    const saved = JSON.parse(JSON.stringify(viewed));
    expect(isWorkspaceDocument(saved)).toBe(true);
    const reloaded = normalizeWorkspaceDocument(saved);
    const canvasProject = reloaded.modules.canvas.projects[projectId];

    expect(canvasViewsForProject(canvasProject).map((view) => view.name)).toEqual(['Canvas 1', 'Release planning']);
    expect(activeCanvasView(canvasProject)).toMatchObject({
      id: planning.id,
      name: 'Release planning',
      viewport: { x: 125, y: -80, zoom: 1.4 },
    });
    expect(activeCanvasView(canvasProject).nodes[note.id]).toEqual(note);
    expect(canvasProject.nodes).toEqual({});
  });

  it('removes connected edges with deleted canvas nodes', () => {
    const workspace = createEmptyWorkspace();
    const projectId = workspace.projects[0].id;
    const first = createCanvasNode('note', { x: 0, y: 0 });
    const second = createCanvasNode('shape', { x: 300, y: 0 });
    const connection = createCanvasConnection(first.id, second.id);
    const withNodes = workspaceReducer(
      workspaceReducer(workspace, { type: 'canvasAddNode', projectId, node: first }),
      { type: 'canvasAddNode', projectId, node: second },
    );
    const connected = workspaceReducer(withNodes, { type: 'canvasAddConnection', projectId, connection });

    const deleted = workspaceReducer(connected, { type: 'canvasDeleteNodes', projectId, nodeIds: [first.id] });

    expect(deleted.modules.canvas.projects[projectId].nodes[first.id]).toBeUndefined();
    expect(deleted.modules.canvas.projects[projectId].nodes[second.id]).toEqual(second);
    expect(deleted.modules.canvas.projects[projectId].connections[connection.id]).toBeUndefined();
  });

  it('stores UML elements and editable technical relationships', () => {
    const workspace = createEmptyWorkspace();
    const projectId = workspace.projects[0].id;
    const service = createCanvasNode('diagram', { x: 20, y: 40 }, { diagramKind: 'class', content: 'OrderService' });
    const repository = createCanvasNode('diagram', { x: 420, y: 40 }, { diagramKind: 'interface', content: 'OrderRepository' });
    const relationship = createCanvasConnection(service.id, repository.id, '#7568d0', 'dependency');
    const withNodes = workspaceReducer(
      workspaceReducer(workspace, { type: 'canvasAddNode', projectId, node: service }),
      { type: 'canvasAddNode', projectId, node: repository },
    );
    const connected = workspaceReducer(withNodes, { type: 'canvasAddConnection', projectId, connection: relationship });
    const labeled = workspaceReducer(connected, {
      type: 'canvasUpdateConnection',
      projectId,
      connectionId: relationship.id,
      changes: { relation: 'realization', label: 'implements', sourceLabel: '1', targetLabel: '*' },
    });

    expect(labeled.modules.canvas.projects[projectId].nodes[service.id].diagramKind).toBe('class');
    expect(labeled.modules.canvas.projects[projectId].connections[relationship.id]).toMatchObject({
      relation: 'realization',
      label: 'implements',
      sourceLabel: '1',
      targetLabel: '*',
    });
    expect(isWorkspaceDocument(labeled)).toBe(true);
  });

  it('stores imported files on the canvas and removes their visual references with the resource', () => {
    const workspace = createEmptyWorkspace();
    const projectId = workspace.projects[0].id;
    const attachment = {
      id: 'canvas-file-1',
      name: 'moodboard.png',
      kind: 'file' as const,
      relativePath: '.kanbanos/content/attachments/canvas-file-1/moodboard.png',
      sizeBytes: 4096,
      fileCount: 1,
      createdAt: '2026-08-11T10:00:00.000Z',
    };
    const node = createCanvasNode('file', { x: 80, y: 120 }, { attachmentId: attachment.id });
    const references = createCanvasView('References');
    const secondNode = createCanvasNode('file', { x: 180, y: 220 }, { attachmentId: attachment.id });
    const withReferences = workspaceReducer(workspace, { type: 'canvasAddView', projectId, view: references });

    const imported = workspaceReducer(withReferences, {
      type: 'canvasAddAttachments',
      projectId,
      canvasViewId: 'canvas-main',
      attachments: [attachment],
      nodes: [node],
    });
    const placedTwice = workspaceReducer(imported, {
      type: 'canvasAddNode',
      projectId,
      canvasViewId: references.id,
      node: secondNode,
    });
    expect(placedTwice.resources.attachments[attachment.id]).toEqual(attachment);
    expect(placedTwice.modules.canvas.projects[projectId].nodes[node.id]).toEqual(node);
    expect(placedTwice.modules.canvas.projects[projectId].views[references.id].nodes[secondNode.id]).toEqual(secondNode);

    const removed = workspaceReducer(placedTwice, { type: 'removeAttachment', attachmentId: attachment.id });
    expect(removed.resources.attachments[attachment.id]).toBeUndefined();
    expect(removed.modules.canvas.projects[projectId].nodes[node.id]).toBeUndefined();
    expect(removed.modules.canvas.projects[projectId].views[references.id].nodes[secondNode.id]).toBeUndefined();
  });

  it('normalizes canvas storage for older workspaces', () => {
    const workspace = createEmptyWorkspace();
    const legacy = {
      ...workspace,
      modules: { kanban: workspace.modules.kanban },
    } as unknown as typeof workspace;

    const normalized = normalizeWorkspaceDocument(legacy);

    expect(normalized.modules.canvas.version).toBe(1);
    expect(normalized.modules.canvas.projects[workspace.projects[0].id]).toEqual({
      name: 'Canvas 1',
      nodes: {},
      connections: {},
      strokes: {},
      viewport: { x: 0, y: 0, zoom: 1 },
      activeViewId: 'canvas-main',
      views: {},
    });
  });

  it('rejects malformed workspace documents', () => {
    expect(isWorkspaceDocument({ schemaVersion: 1 })).toBe(false);
    expect(isWorkspaceDocument(null)).toBe(false);
  });
});
