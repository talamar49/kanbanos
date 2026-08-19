import type {
  CanvasConnection,
  CanvasNode,
  CanvasNodeType,
  CanvasPoint,
  CanvasProject,
  CanvasStroke,
  CanvasViewport,
  CanvasRelation,
  CanvasWorkspaceView,
  KanbanColumn,
  KanbanColumnRule,
  KanbanProjectSettings,
  Priority,
  Project,
  ProjectNote,
  RoadmapHorizon,
  TimelineZoom,
  WorkItem,
  WorkspaceAction,
  WorkspaceDocument,
} from './types';

export const PROJECT_COLORS = ['#6c5ce7', '#1f9d78', '#e58b4a', '#4c84e8', '#d45d79', '#7c879e'];

export const KANBAN_COLUMN_RULES: KanbanColumnRule[] = ['new-task', 'completed'];

export const TIMELINE_ZOOMS: TimelineZoom[] = ['week', 'month', 'two-weeks', 'four-weeks', 'year'];
export const DEFAULT_TIMELINE_WORKING_DAYS = [0, 1, 2, 3, 4, 5, 6];

function isTimelineWorkingDays(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && new Set(value).size === value.length
    && value.every((day) => Number.isInteger(day) && day >= 0 && day <= 6);
}

function normalizeTimelineWorkingDays(value: unknown): number[] {
  return isTimelineWorkingDays(value)
    ? [...value].sort((left, right) => left - right)
    : [...DEFAULT_TIMELINE_WORKING_DAYS];
}

function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` === value;
}

function normalizeTimelineWindowStarts(value: WorkspaceDocument['preferences']['timelineWindowStarts'] | undefined): Partial<Record<TimelineZoom, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(TIMELINE_ZOOMS.flatMap((zoom) => isIsoCalendarDate(value[zoom]) ? [[zoom, value[zoom]]] : []));
}

export const DEFAULT_COLUMNS: KanbanColumn[] = [
  { id: 'backlog', title: 'Backlog', color: '#a4a9b4', rules: ['new-task'] },
  { id: 'planned', title: 'Stuck', color: '#7c6ee6', rules: [] },
  { id: 'progress', title: 'In progress', color: '#e6a44b', rules: [] },
  { id: 'done', title: 'Done', color: '#43a882', rules: ['completed'] },
];

export function columnForRule(columns: KanbanColumn[], rule: KanbanColumnRule): KanbanColumn | undefined {
  const assigned = columns.find((column) => column.rules?.includes(rule));
  if (assigned) return assigned;
  if (rule === 'new-task') return columns.find((column) => column.id === 'planned') ?? columns[0];
  return columns.find((column) => column.id === 'done')
    ?? columns.find((column) => /done|complete/i.test(column.title))
    ?? columns.at(-1);
}

export function isTaskCompleted(document: WorkspaceDocument, item: WorkItem): boolean {
  const columns = document.modules.kanban.projects[item.projectId]?.columns ?? [];
  return columnForRule(columns, 'completed')?.id === item.moduleData.kanban.columnId;
}

export function completionToggleColumn(document: WorkspaceDocument, item: WorkItem): KanbanColumn | undefined {
  const columns = document.modules.kanban.projects[item.projectId]?.columns ?? [];
  const completedColumn = columnForRule(columns, 'completed');
  if (!completedColumn) return undefined;
  if (item.moduleData.kanban.columnId !== completedColumn.id) return completedColumn;
  const newTaskColumn = columnForRule(columns, 'new-task');
  return newTaskColumn?.id !== completedColumn.id
    ? newTaskColumn
    : columns.find((column) => column.id !== completedColumn.id);
}

function normalizeKanbanColumns(columns: KanbanColumn[]): KanbanColumn[] {
  const sanitized = columns.map((column) => ({
    ...column,
    rules: Array.from(new Set((column.rules ?? []).filter((rule): rule is KanbanColumnRule => KANBAN_COLUMN_RULES.includes(rule)))),
  }));
  const targetByRule = new Map<KanbanColumnRule, string>();
  KANBAN_COLUMN_RULES.forEach((rule) => {
    const target = columnForRule(sanitized, rule);
    if (target) targetByRule.set(rule, target.id);
  });
  return sanitized.map((column) => ({
    ...column,
    rules: KANBAN_COLUMN_RULES.filter((rule) => targetByRule.get(rule) === column.id),
  }));
}

export const ROADMAP_HORIZONS: RoadmapHorizon[] = ['Now', 'Next', 'Later'];
export const CANVAS_NODE_COLORS = ['#ffdf72', '#ff9e9e', '#9ee8cf', '#a9c7ff', '#c8b5ff', '#f7b4db'];
export const PRIMARY_CANVAS_VIEW_ID = 'canvas-main';

function emptyCanvasContents(): Pick<CanvasWorkspaceView, 'nodes' | 'connections' | 'strokes' | 'viewport'> {
  return {
    nodes: {},
    connections: {},
    strokes: {},
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

export function createCanvasView(name: string): CanvasWorkspaceView {
  return { id: id(), name: name.trim(), ...emptyCanvasContents() };
}

export function createCanvasProject(): CanvasProject {
  return {
    name: 'Canvas 1',
    ...emptyCanvasContents(),
    activeViewId: PRIMARY_CANVAS_VIEW_ID,
    views: {},
  };
}

function primaryCanvasView(canvasProject: CanvasProject): CanvasWorkspaceView {
  return {
    id: PRIMARY_CANVAS_VIEW_ID,
    name: canvasProject.name,
    nodes: canvasProject.nodes,
    connections: canvasProject.connections,
    strokes: canvasProject.strokes,
    viewport: canvasProject.viewport,
  };
}

export function canvasViewsForProject(canvasProject: CanvasProject): CanvasWorkspaceView[] {
  return [primaryCanvasView(canvasProject), ...Object.values(canvasProject.views)];
}

export function activeCanvasView(canvasProject: CanvasProject): CanvasWorkspaceView {
  return canvasProject.views[canvasProject.activeViewId] ?? primaryCanvasView(canvasProject);
}

const CANVAS_NODE_SIZES: Record<CanvasNodeType, { width: number; height: number }> = {
  note: { width: 260, height: 220 },
  task: { width: 300, height: 174 },
  file: { width: 276, height: 138 },
  shape: { width: 230, height: 160 },
  diagram: { width: 280, height: 210 },
};

export function createCanvasNode(
  type: CanvasNodeType,
  point: CanvasPoint,
  options: Partial<Pick<CanvasNode, 'width' | 'height' | 'rotation' | 'zIndex' | 'color' | 'content' | 'taskId' | 'attachmentId' | 'shape' | 'diagramKind'>> = {},
): CanvasNode {
  const timestamp = now();
  const size = CANVAS_NODE_SIZES[type];
  return {
    id: id(),
    type,
    x: point.x,
    y: point.y,
    width: options.width ?? size.width,
    height: options.height ?? size.height,
    rotation: options.rotation ?? 0,
    zIndex: options.zIndex ?? 1,
    color: options.color ?? (type === 'note' ? CANVAS_NODE_COLORS[0] : type === 'shape' ? CANVAS_NODE_COLORS[4] : '#6759cf'),
    content: options.content ?? '',
    taskId: options.taskId,
    attachmentId: options.attachmentId,
    shape: options.shape ?? (type === 'shape' ? 'rectangle' : undefined),
    diagramKind: options.diagramKind,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createCanvasConnection(
  fromNodeId: string,
  toNodeId: string,
  color = '#7568d0',
  relation: CanvasRelation = 'association',
): CanvasConnection {
  return { id: id(), fromNodeId, toNodeId, color, relation, label: '', sourceLabel: '', targetLabel: '', createdAt: now() };
}

export function createCanvasStroke(points: CanvasPoint[], color = '#5147a6', width = 4): CanvasStroke {
  return { id: id(), points, color, width, createdAt: now() };
}

function normalizeRoadmapHorizonOrder(order?: RoadmapHorizon[]): RoadmapHorizon[] {
  return Array.from(new Set([
    ...(order ?? []).filter((horizon) => ROADMAP_HORIZONS.includes(horizon)),
    ...ROADMAP_HORIZONS,
  ]));
}

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function createProject(name: string, color: string, description = ''): Project {
  return { id: id(), name, description, color, createdAt: now(), archived: false };
}

export function createProjectSettings(): KanbanProjectSettings {
  return { columns: DEFAULT_COLUMNS.map((column) => ({ ...column, rules: [...(column.rules ?? [])] })) };
}

export function createProjectNote(projectId: string, title = 'Untitled note'): ProjectNote {
  const timestamp = now();
  return {
    id: id(),
    projectId,
    title: title.trim() || 'Untitled note',
    content: '',
    labels: [],
    pinned: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createWorkItem(
  projectId: string,
  columnId: string,
  title: string,
  rank: number,
  options: Partial<Pick<WorkItem, 'description' | 'priority' | 'estimateMinutes' | 'startDate' | 'dueDate' | 'dependencyIds' | 'links' | 'labels' | 'assignee' | 'subtasks'>> = {},
): WorkItem {
  const timestamp = now();
  return {
    id: id(),
    projectId,
    type: 'task',
    title,
    description: options.description ?? '',
    priority: options.priority ?? 'none',
    estimateMinutes: options.estimateMinutes,
    startDate: options.startDate,
    dueDate: options.dueDate,
    dependencyIds: options.dependencyIds ?? [],
    attachmentIds: [],
    links: options.links ?? [],
    labels: options.labels ?? [],
    assignee: options.assignee,
    subtasks: options.subtasks ?? [],
    createdAt: timestamp,
    updatedAt: timestamp,
    moduleData: { kanban: { columnId, rank } },
  };
}

function dateAfter(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function createEmptyWorkspace(
  workspaceName = 'My workspace',
  copy: { projectName?: string; projectDescription?: string } = {},
): WorkspaceDocument {
  const project = createProject(
    copy.projectName ?? 'My first project',
    '#6c5ce7',
    copy.projectDescription ?? 'A focused space for what matters next',
  );
  const timestamp = now();
  return {
    schemaVersion: 1,
    workspace: {
      id: id(),
      name: workspaceName,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    projects: [project],
    items: {},
    modules: {
      kanban: {
        version: 1,
        projects: { [project.id]: createProjectSettings() },
      },
      canvas: {
        version: 1,
        projects: { [project.id]: createCanvasProject() },
      },
      notes: { version: 1, notes: {} },
    },
    resources: { attachments: {} },
    preferences: { activeProjectId: project.id, roadmapHorizonOrder: [...ROADMAP_HORIZONS], projectScope: 'current', timelineLayout: 'tasks', collapsedKanbanSubtaskItemIds: [] },
  };
}

export function createDefaultWorkspace(workspaceName = 'My workspace'): WorkspaceDocument {
  const product = createProject('Product launch', '#6c5ce7', 'Shape and ship the next release');
  const website = createProject('Website refresh', '#1f9d78', 'A clearer home for the brand');
  const research = createProject('Customer research', '#e58b4a', 'Turn conversations into insight');
  const projects = [product, website, research];

  const seededItems = [
    createWorkItem(product.id, 'backlog', 'Explore onboarding empty states', 1000, {
      description: 'Find a calm, helpful way to guide first-time users without adding noise.',
      priority: 'low',
      labels: ['Research'],
      assignee: 'AM',
      subtasks: [
        { id: id(), title: 'Collect references', completed: true },
        { id: id(), title: 'Draft three directions', completed: false },
      ],
    }),
    createWorkItem(product.id, 'backlog', 'Keyboard navigation audit', 2000, {
      priority: 'medium',
      labels: ['Accessibility'],
      assignee: 'TN',
    }),
    createWorkItem(product.id, 'planned', 'Finalize launch messaging', 1000, {
      priority: 'high',
      dueDate: dateAfter(2),
      labels: ['Content'],
      assignee: 'SK',
      subtasks: [
        { id: id(), title: 'Review value proposition', completed: true },
        { id: id(), title: 'Polish release notes', completed: false },
        { id: id(), title: 'Get stakeholder sign-off', completed: false },
      ],
    }),
    createWorkItem(product.id, 'planned', 'Prepare product screenshots', 2000, {
      dueDate: dateAfter(4),
      labels: ['Design'],
      assignee: 'AM',
    }),
    createWorkItem(product.id, 'progress', 'Build analytics overview', 1000, {
      description: 'A fast overview of activation, retention, and the signals that need attention.',
      priority: 'urgent',
      dueDate: dateAfter(1),
      labels: ['Product', 'Engineering'],
      assignee: 'RJ',
      subtasks: [
        { id: id(), title: 'Define core metrics', completed: true },
        { id: id(), title: 'Implement chart components', completed: true },
        { id: id(), title: 'Add empty and loading states', completed: false },
        { id: id(), title: 'QA responsive behavior', completed: false },
      ],
    }),
    createWorkItem(product.id, 'progress', 'QA desktop release candidate', 2000, {
      priority: 'high',
      labels: ['Release'],
      assignee: 'TN',
    }),
    createWorkItem(product.id, 'done', 'Define launch success metrics', 1000, {
      labels: ['Strategy'],
      assignee: 'SK',
      subtasks: [
        { id: id(), title: 'Activation target', completed: true },
        { id: id(), title: 'Retention target', completed: true },
      ],
    }),
    createWorkItem(product.id, 'done', 'Approve visual direction', 2000, {
      labels: ['Design'],
      assignee: 'AM',
    }),
    createWorkItem(website.id, 'planned', 'Map the new information architecture', 1000, {
      priority: 'high',
      labels: ['UX'],
      assignee: 'AM',
    }),
    createWorkItem(website.id, 'progress', 'Prototype the new homepage', 1000, {
      dueDate: dateAfter(5),
      labels: ['Design'],
      assignee: 'RJ',
    }),
    createWorkItem(research.id, 'backlog', 'Recruit five power users', 1000, {
      priority: 'medium',
      labels: ['Interviews'],
      assignee: 'SK',
    }),
  ];

  const timestamp = now();
  return {
    schemaVersion: 1,
    workspace: {
      id: id(),
      name: workspaceName,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    projects,
    items: Object.fromEntries(seededItems.map((item) => [item.id, item])),
    modules: {
      kanban: {
        version: 1,
        projects: Object.fromEntries(projects.map((project) => [project.id, createProjectSettings()])),
      },
      canvas: {
        version: 1,
        projects: Object.fromEntries(projects.map((project) => [project.id, createCanvasProject()])),
      },
      notes: { version: 1, notes: {} },
    },
    resources: { attachments: {} },
    preferences: { activeProjectId: product.id, roadmapHorizonOrder: [...ROADMAP_HORIZONS], projectScope: 'current', timelineLayout: 'tasks', collapsedKanbanSubtaskItemIds: [] },
  };
}

function isCanvasContents(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const contents = value as Partial<CanvasWorkspaceView>;
  const viewport = contents.viewport;
  return (
    Boolean(contents.nodes) &&
    typeof contents.nodes === 'object' &&
    !Array.isArray(contents.nodes) &&
    Object.values(contents.nodes).every((node) =>
      Boolean(node) &&
      typeof node.id === 'string' &&
      ['note', 'task', 'file', 'shape', 'diagram'].includes(node.type) &&
      [node.x, node.y, node.width, node.height, node.rotation, node.zIndex].every(Number.isFinite) &&
      typeof node.color === 'string' &&
      typeof node.content === 'string'
    ) &&
    Boolean(contents.connections) &&
    typeof contents.connections === 'object' &&
    !Array.isArray(contents.connections) &&
    Object.values(contents.connections).every((connection) =>
      Boolean(connection) &&
      typeof connection.id === 'string' &&
      typeof connection.fromNodeId === 'string' &&
      typeof connection.toNodeId === 'string' &&
      typeof connection.color === 'string' &&
      (connection.relation === undefined || ['association', 'dependency', 'inheritance', 'realization', 'aggregation', 'composition', 'message', 'data-flow'].includes(connection.relation)) &&
      (connection.label === undefined || typeof connection.label === 'string') &&
      (connection.sourceLabel === undefined || typeof connection.sourceLabel === 'string') &&
      (connection.targetLabel === undefined || typeof connection.targetLabel === 'string')
    ) &&
    Boolean(contents.strokes) &&
    typeof contents.strokes === 'object' &&
    !Array.isArray(contents.strokes) &&
    Object.values(contents.strokes).every((stroke) =>
      Boolean(stroke) &&
      typeof stroke.id === 'string' &&
      Array.isArray(stroke.points) &&
      stroke.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) &&
      typeof stroke.color === 'string' &&
      Number.isFinite(stroke.width)
    ) &&
    Boolean(viewport) &&
    [viewport?.x, viewport?.y, viewport?.zoom].every(Number.isFinite)
  );
}

export function isWorkspaceDocument(value: unknown): value is WorkspaceDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<WorkspaceDocument>;
  const projectsValid = Array.isArray(candidate.projects) && candidate.projects.every((project) =>
    Boolean(project) &&
    typeof project.id === 'string' &&
    typeof project.name === 'string' &&
    typeof project.color === 'string',
  );
  const itemsValid = Boolean(candidate.items) &&
    typeof candidate.items === 'object' &&
    !Array.isArray(candidate.items) &&
    Object.values(candidate.items ?? {}).every((item) =>
      Boolean(item) &&
      typeof item.id === 'string' &&
      typeof item.projectId === 'string' &&
      typeof item.title === 'string' &&
      Array.isArray(item.labels) &&
      Array.isArray(item.subtasks) &&
      (item.attachmentIds === undefined || Array.isArray(item.attachmentIds)) &&
      (item.links === undefined || (
        Array.isArray(item.links) && item.links.every((link) =>
          Boolean(link) &&
          typeof link.id === 'string' &&
          (link.title === undefined || typeof link.title === 'string') &&
          (link.description === undefined || typeof link.description === 'string') &&
          isHttpUrl(link.url) &&
          typeof link.createdAt === 'string'
        )
      )) &&
      typeof item.moduleData?.kanban?.columnId === 'string' &&
      typeof item.moduleData?.kanban?.rank === 'number',
    );
  const kanbanProjects = candidate.modules?.kanban?.projects;
  const kanbanValid = Boolean(kanbanProjects) &&
    typeof kanbanProjects === 'object' &&
    Object.values(kanbanProjects ?? {}).every((settings) =>
      Array.isArray(settings.columns) && settings.columns.every((column) =>
        typeof column.id === 'string' &&
        typeof column.title === 'string' &&
        (column.rules === undefined || (
          Array.isArray(column.rules) && column.rules.every((rule) => KANBAN_COLUMN_RULES.includes(rule))
        )),
      ),
    );
  const attachments = candidate.resources?.attachments;
  const attachmentsValid = attachments === undefined || (
    Boolean(attachments) &&
    typeof attachments === 'object' &&
    !Array.isArray(attachments) &&
    Object.values(attachments).every((attachment) =>
      Boolean(attachment) &&
      typeof attachment.id === 'string' &&
      typeof attachment.name === 'string' &&
      (attachment.title === undefined || typeof attachment.title === 'string') &&
      (attachment.description === undefined || typeof attachment.description === 'string') &&
      (attachment.kind === 'file' || attachment.kind === 'folder' || attachment.kind === 'reference') &&
      (attachment.kind !== 'reference' || typeof attachment.localPath === 'string') &&
      typeof attachment.relativePath === 'string' &&
      typeof attachment.sizeBytes === 'number' &&
      typeof attachment.fileCount === 'number' &&
      typeof attachment.createdAt === 'string',
    )
  );
  const notesCandidate = candidate.modules?.notes as WorkspaceDocument['modules']['notes'] | undefined;
  const notesValid = notesCandidate === undefined || (
    notesCandidate.version === 1 &&
    Boolean(notesCandidate.notes) &&
    typeof notesCandidate.notes === 'object' &&
    !Array.isArray(notesCandidate.notes) &&
    Object.entries(notesCandidate.notes).every(([noteId, note]) =>
      Boolean(note) &&
      note.id === noteId &&
      typeof note.projectId === 'string' &&
      typeof note.title === 'string' &&
      typeof note.content === 'string' &&
      Array.isArray(note.labels) && note.labels.every((label) => typeof label === 'string') &&
      typeof note.pinned === 'boolean' &&
      typeof note.createdAt === 'string' &&
      typeof note.updatedAt === 'string'
    )
  );
  const canvasCandidate = candidate.modules?.canvas as WorkspaceDocument['modules']['canvas'] | undefined;
  const canvasValid = canvasCandidate === undefined || (
    canvasCandidate.version === 1 &&
    Boolean(canvasCandidate.projects) &&
    typeof canvasCandidate.projects === 'object' &&
    !Array.isArray(canvasCandidate.projects) &&
    Object.values(canvasCandidate.projects).every((canvasProject) =>
      isCanvasContents(canvasProject) &&
      (canvasProject.name === undefined || typeof canvasProject.name === 'string') &&
      (canvasProject.activeViewId === undefined || typeof canvasProject.activeViewId === 'string') &&
      (canvasProject.views === undefined || (
        Boolean(canvasProject.views) &&
        typeof canvasProject.views === 'object' &&
        !Array.isArray(canvasProject.views) &&
        Object.entries(canvasProject.views).every(([viewId, canvasView]) =>
          isCanvasContents(canvasView) &&
          canvasView.id === viewId &&
          typeof canvasView.name === 'string'
        )
      ))
    )
  );

  return (
    candidate.schemaVersion === 1 &&
    Boolean(candidate.workspace?.id) &&
    projectsValid &&
    itemsValid &&
    kanbanValid &&
    canvasValid &&
    notesValid &&
    attachmentsValid &&
    typeof candidate.preferences?.activeProjectId === 'string' &&
    (candidate.preferences.roadmapHorizonOrder === undefined || (
      Array.isArray(candidate.preferences.roadmapHorizonOrder) &&
      candidate.preferences.roadmapHorizonOrder.every((horizon) => ROADMAP_HORIZONS.includes(horizon))
    )) &&
    (candidate.preferences.projectScope === undefined || candidate.preferences.projectScope === 'current' || candidate.preferences.projectScope === 'all') &&
    (candidate.preferences.timelineLayout === undefined || candidate.preferences.timelineLayout === 'tasks' || candidate.preferences.timelineLayout === 'compact') &&
    (candidate.preferences.timelineZoom === undefined || TIMELINE_ZOOMS.includes(candidate.preferences.timelineZoom)) &&
    (candidate.preferences.timelineWorkingDays === undefined || isTimelineWorkingDays(candidate.preferences.timelineWorkingDays)) &&
    (candidate.preferences.timelineWindowStarts === undefined || (
      Boolean(candidate.preferences.timelineWindowStarts) &&
      typeof candidate.preferences.timelineWindowStarts === 'object' &&
      !Array.isArray(candidate.preferences.timelineWindowStarts) &&
      Object.entries(candidate.preferences.timelineWindowStarts).every(([zoom, startDate]) =>
        TIMELINE_ZOOMS.includes(zoom as TimelineZoom) && isIsoCalendarDate(startDate)
      )
    )) &&
    (candidate.preferences.collapsedKanbanSubtaskItemIds === undefined || (
      Array.isArray(candidate.preferences.collapsedKanbanSubtaskItemIds) &&
      candidate.preferences.collapsedKanbanSubtaskItemIds.every((itemId) => typeof itemId === 'string')
    ))
  );
}

function normalizeStoredCanvasView(
  stored: Partial<CanvasWorkspaceView> | undefined,
  viewId: string,
  fallbackName: string,
): CanvasWorkspaceView {
  const nodes = stored?.nodes ?? {};
  const connections = Object.fromEntries(Object.entries(stored?.connections ?? {})
    .filter(([, connection]) => Boolean(nodes[connection.fromNodeId]) && Boolean(nodes[connection.toNodeId]))
    .map(([connectionId, connection]) => [connectionId, {
      ...connection,
      relation: connection.relation ?? 'association',
      label: connection.label ?? '',
      sourceLabel: connection.sourceLabel ?? '',
      targetLabel: connection.targetLabel ?? '',
    }]));
  const viewport = stored?.viewport;
  return {
    id: viewId,
    name: stored?.name?.trim() || fallbackName,
    nodes,
    connections,
    strokes: stored?.strokes ?? {},
    viewport: viewport && Number.isFinite(viewport.x) && Number.isFinite(viewport.y) && Number.isFinite(viewport.zoom)
      ? normalizedCanvasViewport(viewport)
      : { x: 0, y: 0, zoom: 1 },
  };
}

type StoredParentLinkedItem = WorkItem & { parentId?: unknown; hierarchyRank?: unknown };

function collapseStoredParentLinks(
  document: WorkspaceDocument,
  kanbanProjects: Record<string, KanbanProjectSettings>,
): { items: Record<string, WorkItem>; collapsedToRoot: Map<string, string> } {
  const storedItems = Object.fromEntries(Object.entries(document.items).map(([itemId, item]) => [
    itemId,
    { ...item, dependencyIds: item.dependencyIds ?? [], attachmentIds: item.attachmentIds ?? [], links: item.links ?? [], subtasks: item.subtasks ?? [] } as StoredParentLinkedItem,
  ]));
  const cleanItem = (item: StoredParentLinkedItem): WorkItem => {
    const clean = { ...item };
    delete clean.parentId;
    delete clean.hierarchyRank;
    return clean;
  };
  const parentByChild = new Map<string, string>();
  const childrenByParent = new Map<string, StoredParentLinkedItem[]>();
  Object.values(storedItems).forEach((item) => {
    const parentId = typeof item.parentId === 'string' ? item.parentId : undefined;
    const parent = parentId ? storedItems[parentId] : undefined;
    if (!parent || parent.id === item.id || parent.projectId !== item.projectId) return;
    parentByChild.set(item.id, parent.id);
    childrenByParent.set(parent.id, [...(childrenByParent.get(parent.id) ?? []), item]);
  });
  childrenByParent.forEach((children) => children.sort((left, right) => {
    const leftRank = Number.isFinite(left.hierarchyRank) ? Number(left.hierarchyRank) : left.moduleData.kanban.rank;
    const rightRank = Number.isFinite(right.hierarchyRank) ? Number(right.hierarchyRank) : right.moduleData.kanban.rank;
    return leftRank - rightRank || left.moduleData.kanban.rank - right.moduleData.kanban.rank || left.createdAt.localeCompare(right.createdAt);
  }));

  const items = Object.fromEntries(Object.entries(storedItems).map(([itemId, item]) => [itemId, cleanItem(item)]));
  const collapsedToRoot = new Map<string, string>();
  const visited = new Set<string>();
  Object.values(storedItems).filter((item) => !parentByChild.has(item.id)).forEach((root) => {
    const descendants: StoredParentLinkedItem[] = [];
    const visit = (parentId: string) => {
      (childrenByParent.get(parentId) ?? []).forEach((child) => {
        if (visited.has(child.id)) return;
        visited.add(child.id);
        descendants.push(child);
        visit(child.id);
      });
    };
    visit(root.id);
    if (descendants.length === 0) return;

    const branchIds = new Set(descendants.map((item) => item.id));
    const rootItem = items[root.id];
    const subtasks = [...rootItem.subtasks];
    const subtaskIds = new Set(subtasks.map((subtask) => subtask.id));
    descendants.forEach((child) => {
      collapsedToRoot.set(child.id, root.id);
      if (!subtaskIds.has(child.id)) {
        const columns = kanbanProjects[child.projectId]?.columns ?? [];
        subtasks.push({
          id: child.id,
          title: child.title,
          completed: columnForRule(columns, 'completed')?.id === child.moduleData.kanban.columnId,
        });
        subtaskIds.add(child.id);
      }
      child.subtasks.forEach((subtask) => {
        if (subtaskIds.has(subtask.id)) return;
        subtasks.push(subtask);
        subtaskIds.add(subtask.id);
      });
      delete items[child.id];
    });
    const branch = [root, ...descendants];
    const attachmentIds = Array.from(new Set(branch.flatMap((item) => item.attachmentIds ?? [])));
    const links = Array.from(new Map(branch.flatMap((item) => item.links ?? []).map((link) => [link.id, link])).values());
    const dependencyIds = Array.from(new Set(branch.flatMap((item) => item.dependencyIds ?? [])))
      .filter((dependencyId) => !branchIds.has(dependencyId) && dependencyId !== root.id);
    items[root.id] = { ...rootItem, subtasks, attachmentIds, links, dependencyIds };
  });

  Object.entries(items).forEach(([itemId, item]) => {
    const dependencyIds = Array.from(new Set((item.dependencyIds ?? []).map((dependencyId) => collapsedToRoot.get(dependencyId) ?? dependencyId)))
      .filter((dependencyId) => dependencyId !== itemId && Boolean(items[dependencyId]));
    items[itemId] = { ...item, dependencyIds };
  });
  return { items, collapsedToRoot };
}

function normalizeLabelsAcrossItems(items: Record<string, WorkItem>): Record<string, WorkItem> {
  const canonicalLabels = new Map<string, string>();
  return Object.fromEntries(Object.entries(items).map(([itemId, item]) => {
    const labels: string[] = [];
    const labelsOnTask = new Set<string>();
    item.labels.forEach((rawLabel) => {
      const label = rawLabel.trim();
      const key = label.toLocaleLowerCase();
      if (!label || labelsOnTask.has(key)) return;
      labelsOnTask.add(key);
      if (!canonicalLabels.has(key)) canonicalLabels.set(key, label);
      labels.push(canonicalLabels.get(key)!);
    });
    return [itemId, { ...item, labels }];
  }));
}

function redirectCollapsedCanvasTasks(canvasProject: CanvasProject, collapsedToRoot: ReadonlyMap<string, string>): CanvasProject {
  if (collapsedToRoot.size === 0) return canvasProject;
  const redirectNodes = (nodes: Record<string, CanvasNode>) => Object.fromEntries(Object.entries(nodes).map(([nodeId, node]) => [
    nodeId,
    node.taskId && collapsedToRoot.has(node.taskId) ? { ...node, taskId: collapsedToRoot.get(node.taskId) } : node,
  ]));
  return {
    ...canvasProject,
    nodes: redirectNodes(canvasProject.nodes),
    views: Object.fromEntries(Object.entries(canvasProject.views).map(([viewId, view]) => [viewId, { ...view, nodes: redirectNodes(view.nodes) }])),
  };
}

export function normalizeWorkspaceDocument(document: WorkspaceDocument): WorkspaceDocument {
  const storedCanvas = document.modules.canvas as WorkspaceDocument['modules']['canvas'] | undefined;
  const kanbanProjects = Object.fromEntries(Object.entries(document.modules.kanban.projects).map(([projectId, settings]) => [
    projectId,
    { ...settings, columns: normalizeKanbanColumns(settings.columns) },
  ]));
  const canvasProjects = Object.fromEntries(document.projects.map((project) => {
    const storedProject = storedCanvas?.projects?.[project.id];
    const primary = normalizeStoredCanvasView(storedProject, PRIMARY_CANVAS_VIEW_ID, 'Canvas 1');
    const views = Object.fromEntries(Object.entries(storedProject?.views ?? {})
      .filter(([viewId]) => viewId !== PRIMARY_CANVAS_VIEW_ID)
      .map(([viewId, storedView]) => [viewId, normalizeStoredCanvasView(storedView, viewId, 'Untitled canvas')]));
    const requestedViewId = storedProject?.activeViewId;
    const activeViewId = requestedViewId && (requestedViewId === PRIMARY_CANVAS_VIEW_ID || Boolean(views[requestedViewId]))
      ? requestedViewId
      : PRIMARY_CANVAS_VIEW_ID;
    return [project.id, {
      name: primary.name,
      nodes: primary.nodes,
      connections: primary.connections,
      strokes: primary.strokes,
      viewport: primary.viewport,
      activeViewId,
      views,
    } satisfies CanvasProject];
  }));
  const { items: collapsedItems, collapsedToRoot } = collapseStoredParentLinks(document, kanbanProjects);
  const items = normalizeLabelsAcrossItems(collapsedItems);
  const redirectedCanvasProjects = Object.fromEntries(Object.entries(canvasProjects).map(([projectId, canvasProject]) => [
    projectId,
    redirectCollapsedCanvasTasks(canvasProject, collapsedToRoot),
  ]));
  const projectIds = new Set(document.projects.map((project) => project.id));
  const canonicalNoteLabels = new Map<string, string>();
  const notes = Object.fromEntries(Object.entries(document.modules.notes?.notes ?? {}).flatMap(([noteId, note]) => {
    if (!note || note.id !== noteId || !projectIds.has(note.projectId)) return [];
    const labels: string[] = [];
    const seen = new Set<string>();
    (note.labels ?? []).forEach((rawLabel) => {
      const label = rawLabel.trim();
      const key = label.toLocaleLowerCase();
      if (!label || seen.has(key)) return;
      seen.add(key);
      if (!canonicalNoteLabels.has(key)) canonicalNoteLabels.set(key, label);
      labels.push(canonicalNoteLabels.get(key)!);
    });
    return [[noteId, {
      ...note,
      title: note.title.trim() || 'Untitled note',
      content: note.content ?? '',
      labels,
      pinned: Boolean(note.pinned),
    } satisfies ProjectNote]];
  }));
  const timelineWindowStarts = normalizeTimelineWindowStarts(document.preferences.timelineWindowStarts);
  const {
    timelineWindowStarts: _storedTimelineWindowStarts,
    timelineZoom: _storedTimelineZoom,
    ...storedPreferences
  } = document.preferences;
  return {
    ...document,
    items,
    modules: {
      ...document.modules,
      kanban: { ...document.modules.kanban, projects: kanbanProjects },
      canvas: { version: 1, projects: redirectedCanvasProjects },
      notes: { version: 1, notes },
    },
    resources: {
      ...(document.resources ?? {}),
      attachments: document.resources?.attachments ?? {},
    },
    preferences: {
      ...storedPreferences,
      roadmapHorizonOrder: normalizeRoadmapHorizonOrder(document.preferences.roadmapHorizonOrder),
      projectScope: document.preferences.projectScope === 'all' ? 'all' : 'current',
      timelineLayout: document.preferences.timelineLayout === 'compact' ? 'compact' : 'tasks',
      timelineWorkingDays: normalizeTimelineWorkingDays(document.preferences.timelineWorkingDays),
      ...(document.preferences.timelineZoom && TIMELINE_ZOOMS.includes(document.preferences.timelineZoom)
        ? { timelineZoom: document.preferences.timelineZoom }
        : {}),
      ...(Object.keys(timelineWindowStarts).length > 0 ? { timelineWindowStarts } : {}),
      collapsedKanbanSubtaskItemIds: Array.from(new Set(
        (document.preferences.collapsedKanbanSubtaskItemIds ?? []).filter((itemId) => Boolean(items[itemId])),
      )),
    },
  };
}

function touch(document: WorkspaceDocument): WorkspaceDocument {
  return {
    ...document,
    workspace: { ...document.workspace, updatedAt: now() },
  };
}

function withCanvasProject(document: WorkspaceDocument, projectId: string, canvasProject: CanvasProject): WorkspaceDocument {
  return {
    ...document,
    modules: {
      ...document.modules,
      canvas: {
        version: 1,
        projects: { ...document.modules.canvas.projects, [projectId]: canvasProject },
      },
    },
  };
}

function canvasViewById(canvasProject: CanvasProject, canvasViewId?: string): CanvasWorkspaceView | undefined {
  const targetId = canvasViewId ?? canvasProject.activeViewId;
  if (targetId === PRIMARY_CANVAS_VIEW_ID) return primaryCanvasView(canvasProject);
  return canvasProject.views[targetId];
}

function replaceCanvasView(canvasProject: CanvasProject, canvasView: CanvasWorkspaceView): CanvasProject {
  if (canvasView.id === PRIMARY_CANVAS_VIEW_ID) {
    return {
      ...canvasProject,
      name: canvasView.name,
      nodes: canvasView.nodes,
      connections: canvasView.connections,
      strokes: canvasView.strokes,
      viewport: canvasView.viewport,
    };
  }
  return {
    ...canvasProject,
    views: { ...canvasProject.views, [canvasView.id]: canvasView },
  };
}

function removeCanvasReferences(
  document: WorkspaceDocument,
  matches: (node: CanvasNode) => boolean,
): WorkspaceDocument['modules']['canvas'] {
  const projects = Object.fromEntries(Object.entries(document.modules.canvas.projects).map(([projectId, canvasProject]) => {
    const cleanView = (canvasView: CanvasWorkspaceView): CanvasWorkspaceView => {
      const removedIds = new Set(Object.values(canvasView.nodes).filter(matches).map((node) => node.id));
      if (removedIds.size === 0) return canvasView;
      return {
        ...canvasView,
        nodes: Object.fromEntries(Object.entries(canvasView.nodes).filter(([nodeId]) => !removedIds.has(nodeId))),
        connections: Object.fromEntries(Object.entries(canvasView.connections).filter(([, connection]) =>
          !removedIds.has(connection.fromNodeId) && !removedIds.has(connection.toNodeId))),
      };
    };
    const primary = cleanView(primaryCanvasView(canvasProject));
    const views = Object.fromEntries(Object.entries(canvasProject.views).map(([viewId, canvasView]) => [viewId, cleanView(canvasView)]));
    return [projectId, {
      ...canvasProject,
      nodes: primary.nodes,
      connections: primary.connections,
      views,
    }];
  }));
  return { version: 1, projects };
}

function normalizedCanvasViewport(viewport: CanvasViewport): CanvasViewport {
  return {
    x: Number.isFinite(viewport.x) ? viewport.x : 0,
    y: Number.isFinite(viewport.y) ? viewport.y : 0,
    zoom: Math.max(0.15, Math.min(2.5, Number.isFinite(viewport.zoom) ? viewport.zoom : 1)),
  };
}

export function workspaceReducer(
  document: WorkspaceDocument,
  action: WorkspaceAction,
): WorkspaceDocument {
  if (action.type === 'load') return normalizeWorkspaceDocument(action.document);

  if (action.type === 'selectProject') {
    return { ...document, preferences: { ...document.preferences, activeProjectId: action.projectId } };
  }

  if (action.type === 'setProjectScope') {
    if (document.preferences.projectScope === action.scope) return document;
    return touch({
      ...document,
      preferences: { ...document.preferences, projectScope: action.scope },
    });
  }

  if (action.type === 'setTimelineLayout') {
    if (document.preferences.timelineLayout === action.layout) return document;
    return touch({
      ...document,
      preferences: { ...document.preferences, timelineLayout: action.layout },
    });
  }

  if (action.type === 'setTimelineZoom') {
    if (!TIMELINE_ZOOMS.includes(action.zoom) || document.preferences.timelineZoom === action.zoom) return document;
    return touch({
      ...document,
      preferences: { ...document.preferences, timelineZoom: action.zoom },
    });
  }

  if (action.type === 'setTimelineWindowStart') {
    if (!TIMELINE_ZOOMS.includes(action.zoom) || !isIsoCalendarDate(action.startDate)) return document;
    if (document.preferences.timelineWindowStarts?.[action.zoom] === action.startDate) return document;
    return touch({
      ...document,
      preferences: {
        ...document.preferences,
        timelineWindowStarts: {
          ...document.preferences.timelineWindowStarts,
          [action.zoom]: action.startDate,
        },
      },
    });
  }

  if (action.type === 'setTimelineWorkingDays') {
    if (!isTimelineWorkingDays(action.days)) return document;
    const days = normalizeTimelineWorkingDays(action.days);
    const current = normalizeTimelineWorkingDays(document.preferences.timelineWorkingDays);
    if (days.length === current.length && days.every((day, index) => day === current[index])) return document;
    return touch({
      ...document,
      preferences: { ...document.preferences, timelineWorkingDays: days },
    });
  }

  if (action.type === 'setKanbanSubtasksCollapsed') {
    if (!document.items[action.itemId]) return document;
    const collapsedItemIds = new Set(document.preferences.collapsedKanbanSubtaskItemIds ?? []);
    if (collapsedItemIds.has(action.itemId) === action.collapsed) return document;
    if (action.collapsed) collapsedItemIds.add(action.itemId);
    else collapsedItemIds.delete(action.itemId);
    return touch({
      ...document,
      preferences: {
        ...document.preferences,
        collapsedKanbanSubtaskItemIds: Array.from(collapsedItemIds),
      },
    });
  }

  if (action.type === 'addNote') {
    if (!document.projects.some((project) => project.id === action.note.projectId) || document.modules.notes.notes[action.note.id]) return document;
    return touch({
      ...document,
      modules: {
        ...document.modules,
        notes: { version: 1, notes: { ...document.modules.notes.notes, [action.note.id]: action.note } },
      },
    });
  }

  if (action.type === 'updateNote') {
    const current = document.modules.notes.notes[action.noteId];
    if (!current) return document;
    const changes = { ...action.changes };
    if (changes.labels !== undefined) {
      const seen = new Set<string>();
      changes.labels = changes.labels.flatMap((rawLabel) => {
        const label = rawLabel.trim();
        const key = label.toLocaleLowerCase();
        if (!label || seen.has(key)) return [];
        seen.add(key);
        return [label];
      });
    }
    return touch({
      ...document,
      modules: {
        ...document.modules,
        notes: {
          version: 1,
          notes: { ...document.modules.notes.notes, [action.noteId]: { ...current, ...changes, updatedAt: now() } },
        },
      },
    });
  }

  if (action.type === 'deleteNote') {
    if (!document.modules.notes.notes[action.noteId]) return document;
    const notes = { ...document.modules.notes.notes };
    delete notes[action.noteId];
    return touch({ ...document, modules: { ...document.modules, notes: { version: 1, notes } } });
  }

  if (action.type === 'reorderRoadmapColumns') {
    return touch({
      ...document,
      preferences: {
        ...document.preferences,
        roadmapHorizonOrder: normalizeRoadmapHorizonOrder(action.horizons),
      },
    });
  }

  if (action.type === 'addProject') {
    return touch({
      ...document,
      projects: [...document.projects, action.project],
      modules: {
        ...document.modules,
        kanban: {
          ...document.modules.kanban,
          projects: {
            ...document.modules.kanban.projects,
            [action.project.id]: action.settings,
          },
        },
        canvas: {
          version: 1,
          projects: {
            ...document.modules.canvas.projects,
            [action.project.id]: createCanvasProject(),
          },
        },
      },
      preferences: { ...document.preferences, activeProjectId: action.project.id },
    });
  }

  if (action.type === 'updateProject') {
    return touch({
      ...document,
      projects: document.projects.map((project) =>
        project.id === action.projectId ? { ...project, ...action.changes } : project,
      ),
    });
  }

  if (action.type === 'addItem') {
    return touch({ ...document, items: { ...document.items, [action.item.id]: action.item } });
  }

  if (action.type === 'updateItem') {
    const current = document.items[action.itemId];
    if (!current) return document;
    return touch({
      ...document,
      items: {
        ...document.items,
        [action.itemId]: { ...current, ...action.changes, updatedAt: now() },
      },
    });
  }

  if (action.type === 'addAttachments') {
    const current = document.items[action.itemId];
    if (!current || action.attachments.length === 0) return document;
    const attachments = { ...document.resources.attachments };
    action.attachments.forEach((attachment) => { attachments[attachment.id] = attachment; });
    return touch({
      ...document,
      items: {
        ...document.items,
        [current.id]: {
          ...current,
          attachmentIds: Array.from(new Set([...(current.attachmentIds ?? []), ...action.attachments.map((attachment) => attachment.id)])),
          updatedAt: now(),
        },
      },
      resources: { ...document.resources, attachments },
    });
  }

  if (action.type === 'updateAttachment') {
    const attachment = document.resources.attachments[action.attachmentId];
    if (!attachment) return document;
    return touch({
      ...document,
      resources: {
        ...document.resources,
        attachments: {
          ...document.resources.attachments,
          [attachment.id]: { ...attachment, ...action.changes },
        },
      },
    });
  }

  if (action.type === 'removeAttachment') {
    const attachments = { ...document.resources.attachments };
    if (!attachments[action.attachmentId]) return document;
    delete attachments[action.attachmentId];
    const items = Object.fromEntries(Object.entries(document.items).map(([itemId, item]) => [
      itemId,
      item.attachmentIds?.includes(action.attachmentId)
        ? { ...item, attachmentIds: item.attachmentIds.filter((attachmentId) => attachmentId !== action.attachmentId), updatedAt: now() }
        : item,
    ]));
    return touch({
      ...document,
      items,
      modules: { ...document.modules, canvas: removeCanvasReferences(document, (node) => node.attachmentId === action.attachmentId) },
      resources: { ...document.resources, attachments },
    });
  }

  if (action.type === 'deleteItem') {
    const deletedAttachmentIds = new Set(document.items[action.itemId]?.attachmentIds ?? []);
    const items = { ...document.items };
    delete items[action.itemId];
    Object.values(items).forEach((item) => {
      if (item.dependencyIds?.includes(action.itemId)) {
        items[item.id] = {
          ...item,
          dependencyIds: item.dependencyIds.filter((dependencyId) => dependencyId !== action.itemId),
          updatedAt: now(),
        };
      }
    });
    const attachments = { ...document.resources.attachments };
    deletedAttachmentIds.forEach((attachmentId) => delete attachments[attachmentId]);
    return touch({
      ...document,
      items,
      modules: {
        ...document.modules,
        canvas: removeCanvasReferences(document, (node) => node.taskId === action.itemId || Boolean(node.attachmentId && deletedAttachmentIds.has(node.attachmentId))),
      },
      resources: { ...document.resources, attachments },
      preferences: {
        ...document.preferences,
        collapsedKanbanSubtaskItemIds: (document.preferences.collapsedKanbanSubtaskItemIds ?? [])
          .filter((itemId) => itemId !== action.itemId),
      },
    });
  }

  if (action.type === 'reorderKanbanItems') {
    const orderedIds = Array.from(new Set(action.itemIds))
      .filter((itemId) => document.items[itemId]?.projectId === action.projectId);
    const included = new Set(orderedIds);
    Object.values(document.items)
      .filter((item) => item.projectId === action.projectId && !included.has(item.id))
      .sort((left, right) => left.moduleData.kanban.rank - right.moduleData.kanban.rank || left.createdAt.localeCompare(right.createdAt))
      .forEach((item) => orderedIds.push(item.id));
    if (orderedIds.length === 0) return document;
    const items = { ...document.items };
    orderedIds.forEach((itemId, index) => {
      const item = items[itemId];
      items[itemId] = {
        ...item,
        moduleData: {
          ...item.moduleData,
          kanban: { ...item.moduleData.kanban, rank: (index + 1) * 1000 },
        },
      };
    });
    return touch({ ...document, items });
  }

  if (action.type === 'moveItem') {
    const moving = document.items[action.itemId];
    if (!moving) return document;
    const targetItems = Object.values(document.items)
      .filter(
        (item) =>
          item.projectId === moving.projectId &&
          item.id !== moving.id &&
          item.moduleData.kanban.columnId === action.columnId,
      )
      .sort((a, b) => a.moduleData.kanban.rank - b.moduleData.kanban.rank);
    targetItems.splice(Math.max(0, Math.min(action.index, targetItems.length)), 0, moving);

    const items = { ...document.items };
    targetItems.forEach((item, index) => {
      items[item.id] = {
        ...item,
        updatedAt: item.id === moving.id ? now() : item.updatedAt,
        moduleData: {
          ...item.moduleData,
          kanban: { columnId: action.columnId, rank: (index + 1) * 1000 },
        },
      };
    });
    return touch({ ...document, items });
  }

  if (action.type === 'canvasAddView') {
    const canvasProject = document.modules.canvas.projects[action.projectId] ?? createCanvasProject();
    const name = action.view.name.trim();
    if (!name || action.view.id === PRIMARY_CANVAS_VIEW_ID || canvasProject.views[action.view.id]) return document;
    return touch(withCanvasProject(document, action.projectId, {
      ...canvasProject,
      activeViewId: action.view.id,
      views: { ...canvasProject.views, [action.view.id]: { ...action.view, name } },
    }));
  }

  if (action.type === 'canvasSelectView') {
    const canvasProject = document.modules.canvas.projects[action.projectId];
    if (!canvasProject || canvasProject.activeViewId === action.canvasViewId || !canvasViewById(canvasProject, action.canvasViewId)) return document;
    return touch(withCanvasProject(document, action.projectId, { ...canvasProject, activeViewId: action.canvasViewId }));
  }

  if (action.type === 'canvasRenameView') {
    const canvasProject = document.modules.canvas.projects[action.projectId];
    const canvasView = canvasProject && canvasViewById(canvasProject, action.canvasViewId);
    const name = action.name.trim();
    if (!canvasProject || !canvasView || !name || canvasView.name === name) return document;
    return touch(withCanvasProject(document, action.projectId, replaceCanvasView(canvasProject, { ...canvasView, name })));
  }

  if (action.type === 'canvasDeleteView') {
    const canvasProject = document.modules.canvas.projects[action.projectId];
    if (!canvasProject || canvasViewsForProject(canvasProject).length <= 1 || !canvasViewById(canvasProject, action.canvasViewId)) return document;
    if (action.canvasViewId === PRIMARY_CANVAS_VIEW_ID) {
      const [replacementId, replacement] = Object.entries(canvasProject.views)[0];
      const views = { ...canvasProject.views };
      delete views[replacementId];
      return touch(withCanvasProject(document, action.projectId, {
        ...canvasProject,
        name: replacement.name,
        nodes: replacement.nodes,
        connections: replacement.connections,
        strokes: replacement.strokes,
        viewport: replacement.viewport,
        activeViewId: canvasProject.activeViewId === PRIMARY_CANVAS_VIEW_ID || canvasProject.activeViewId === replacementId
          ? PRIMARY_CANVAS_VIEW_ID
          : canvasProject.activeViewId,
        views,
      }));
    }
    const views = { ...canvasProject.views };
    delete views[action.canvasViewId];
    return touch(withCanvasProject(document, action.projectId, {
      ...canvasProject,
      activeViewId: canvasProject.activeViewId === action.canvasViewId ? PRIMARY_CANVAS_VIEW_ID : canvasProject.activeViewId,
      views,
    }));
  }

  if (action.type === 'canvasAddNode') {
    const canvasProject = document.modules.canvas.projects[action.projectId] ?? createCanvasProject();
    const canvasView = canvasViewById(canvasProject, action.canvasViewId);
    if (!canvasView) return document;
    const nextView = { ...canvasView, nodes: { ...canvasView.nodes, [action.node.id]: action.node } };
    return touch(withCanvasProject(document, action.projectId, replaceCanvasView(canvasProject, nextView)));
  }

  if (action.type === 'canvasUpdateNode') {
    const canvasProject = document.modules.canvas.projects[action.projectId];
    const canvasView = canvasProject && canvasViewById(canvasProject, action.canvasViewId);
    const current = canvasView?.nodes[action.nodeId];
    if (!canvasProject || !canvasView || !current) return document;
    const nextView = {
      ...canvasView,
      nodes: {
        ...canvasView.nodes,
        [action.nodeId]: { ...current, ...action.changes, updatedAt: now() },
      },
    };
    return touch(withCanvasProject(document, action.projectId, replaceCanvasView(canvasProject, nextView)));
  }

  if (action.type === 'canvasUpdateNodes') {
    const canvasProject = document.modules.canvas.projects[action.projectId];
    const canvasView = canvasProject && canvasViewById(canvasProject, action.canvasViewId);
    if (!canvasProject || !canvasView || action.updates.length === 0) return document;
    const nodes = { ...canvasView.nodes };
    let changed = false;
    action.updates.forEach(({ nodeId, changes }) => {
      if (!nodes[nodeId]) return;
      nodes[nodeId] = { ...nodes[nodeId], ...changes, updatedAt: now() };
      changed = true;
    });
    return changed
      ? touch(withCanvasProject(document, action.projectId, replaceCanvasView(canvasProject, { ...canvasView, nodes })))
      : document;
  }

  if (action.type === 'canvasDeleteNodes') {
    const canvasProject = document.modules.canvas.projects[action.projectId];
    const canvasView = canvasProject && canvasViewById(canvasProject, action.canvasViewId);
    if (!canvasProject || !canvasView) return document;
    const deletedIds = new Set(action.nodeIds.filter((nodeId) => Boolean(canvasView.nodes[nodeId])));
    if (deletedIds.size === 0) return document;
    const nextView = {
      ...canvasView,
      nodes: Object.fromEntries(Object.entries(canvasView.nodes).filter(([nodeId]) => !deletedIds.has(nodeId))),
      connections: Object.fromEntries(Object.entries(canvasView.connections).filter(([, connection]) =>
        !deletedIds.has(connection.fromNodeId) && !deletedIds.has(connection.toNodeId))),
    };
    return touch(withCanvasProject(document, action.projectId, replaceCanvasView(canvasProject, nextView)));
  }

  if (action.type === 'canvasAddConnection') {
    const canvasProject = document.modules.canvas.projects[action.projectId];
    const canvasView = canvasProject && canvasViewById(canvasProject, action.canvasViewId);
    if (!canvasProject || !canvasView || !canvasView.nodes[action.connection.fromNodeId] || !canvasView.nodes[action.connection.toNodeId]) return document;
    const duplicate = Object.values(canvasView.connections).some((connection) =>
      connection.fromNodeId === action.connection.fromNodeId && connection.toNodeId === action.connection.toNodeId);
    if (duplicate || action.connection.fromNodeId === action.connection.toNodeId) return document;
    const nextView = { ...canvasView, connections: { ...canvasView.connections, [action.connection.id]: action.connection } };
    return touch(withCanvasProject(document, action.projectId, replaceCanvasView(canvasProject, nextView)));
  }

  if (action.type === 'canvasDeleteConnection') {
    const canvasProject = document.modules.canvas.projects[action.projectId];
    const canvasView = canvasProject && canvasViewById(canvasProject, action.canvasViewId);
    if (!canvasProject || !canvasView?.connections[action.connectionId]) return document;
    const connections = { ...canvasView.connections };
    delete connections[action.connectionId];
    return touch(withCanvasProject(document, action.projectId, replaceCanvasView(canvasProject, { ...canvasView, connections })));
  }

  if (action.type === 'canvasUpdateConnection') {
    const canvasProject = document.modules.canvas.projects[action.projectId];
    const canvasView = canvasProject && canvasViewById(canvasProject, action.canvasViewId);
    const current = canvasView?.connections[action.connectionId];
    if (!canvasProject || !canvasView || !current) return document;
    const nextView = {
      ...canvasView,
      connections: {
        ...canvasView.connections,
        [action.connectionId]: { ...current, ...action.changes },
      },
    };
    return touch(withCanvasProject(document, action.projectId, replaceCanvasView(canvasProject, nextView)));
  }

  if (action.type === 'canvasAddStroke') {
    const canvasProject = document.modules.canvas.projects[action.projectId];
    const canvasView = canvasProject && canvasViewById(canvasProject, action.canvasViewId);
    if (!canvasProject || !canvasView || action.stroke.points.length < 2) return document;
    const nextView = { ...canvasView, strokes: { ...canvasView.strokes, [action.stroke.id]: action.stroke } };
    return touch(withCanvasProject(document, action.projectId, replaceCanvasView(canvasProject, nextView)));
  }

  if (action.type === 'canvasDeleteStroke') {
    const canvasProject = document.modules.canvas.projects[action.projectId];
    const canvasView = canvasProject && canvasViewById(canvasProject, action.canvasViewId);
    if (!canvasProject || !canvasView?.strokes[action.strokeId]) return document;
    const strokes = { ...canvasView.strokes };
    delete strokes[action.strokeId];
    return touch(withCanvasProject(document, action.projectId, replaceCanvasView(canvasProject, { ...canvasView, strokes })));
  }

  if (action.type === 'canvasSetViewport') {
    const canvasProject = document.modules.canvas.projects[action.projectId] ?? createCanvasProject();
    const canvasView = canvasViewById(canvasProject, action.canvasViewId);
    if (!canvasView) return document;
    const viewport = normalizedCanvasViewport(action.viewport);
    if (canvasView.viewport.x === viewport.x && canvasView.viewport.y === viewport.y && canvasView.viewport.zoom === viewport.zoom) return document;
    return touch(withCanvasProject(document, action.projectId, replaceCanvasView(canvasProject, { ...canvasView, viewport })));
  }

  if (action.type === 'canvasAddAttachments') {
    if (action.attachments.length === 0) return document;
    const canvasProject = document.modules.canvas.projects[action.projectId] ?? createCanvasProject();
    const canvasView = canvasViewById(canvasProject, action.canvasViewId);
    if (!canvasView) return document;
    const attachments = { ...document.resources.attachments };
    action.attachments.forEach((attachment) => { attachments[attachment.id] = attachment; });
    const nodes = { ...canvasView.nodes };
    action.nodes.forEach((node) => { nodes[node.id] = node; });
    const nextProject = replaceCanvasView(canvasProject, { ...canvasView, nodes });
    return touch({
      ...withCanvasProject(document, action.projectId, nextProject),
      resources: { ...document.resources, attachments },
    });
  }

  const kanban = document.modules.kanban;
  const settings = kanban.projects[action.projectId];
  if (!settings) return document;

  if (action.type === 'addColumn') {
    return touch({
      ...document,
      modules: {
        ...document.modules,
        kanban: {
          ...kanban,
          projects: {
            ...kanban.projects,
            [action.projectId]: { ...settings, columns: [...settings.columns, action.column] },
          },
        },
      },
    });
  }

  if (action.type === 'reorderColumns') {
    const columnById = new Map(settings.columns.map((column) => [column.id, column]));
    const orderedIds = Array.from(new Set(action.columnIds));
    const columns = [
      ...orderedIds.map((columnId) => columnById.get(columnId)).filter((column): column is KanbanColumn => Boolean(column)),
      ...settings.columns.filter((column) => !orderedIds.includes(column.id)),
    ];
    return touch({
      ...document,
      modules: {
        ...document.modules,
        kanban: {
          ...kanban,
          projects: {
            ...kanban.projects,
            [action.projectId]: { ...settings, columns },
          },
        },
      },
    });
  }

  if (action.type === 'updateColumn') {
    return touch({
      ...document,
      modules: {
        ...document.modules,
        kanban: {
          ...kanban,
          projects: {
            ...kanban.projects,
            [action.projectId]: {
              ...settings,
              columns: normalizeKanbanColumns(settings.columns.map((column) =>
                column.id === action.columnId ? { ...column, ...action.changes } : column,
              )),
            },
          },
        },
      },
    });
  }

  if (action.type === 'setColumnRule') {
    if (!settings.columns.some((column) => column.id === action.columnId)) return document;
    const columns = normalizeKanbanColumns(settings.columns).map((column) => ({
      ...column,
      rules: column.id === action.columnId
        ? Array.from(new Set([...(column.rules ?? []), action.rule]))
        : (column.rules ?? []).filter((rule) => rule !== action.rule),
    }));
    return touch({
      ...document,
      modules: {
        ...document.modules,
        kanban: {
          ...kanban,
          projects: {
            ...kanban.projects,
            [action.projectId]: { ...settings, columns },
          },
        },
      },
    });
  }

  if (action.type === 'deleteColumn') {
    if (action.columnId === action.moveToColumnId || !settings.columns.some((column) => column.id === action.moveToColumnId)) return document;
    const normalizedColumns = normalizeKanbanColumns(settings.columns);
    const deletedRules = normalizedColumns.find((column) => column.id === action.columnId)?.rules ?? [];
    const columns = normalizedColumns
      .filter((column) => column.id !== action.columnId)
      .map((column) => column.id === action.moveToColumnId
        ? { ...column, rules: Array.from(new Set([...(column.rules ?? []), ...deletedRules])) }
        : column);
    const items = { ...document.items };
    Object.values(items).forEach((item) => {
      if (item.projectId === action.projectId && item.moduleData.kanban.columnId === action.columnId) {
        items[item.id] = {
          ...item,
          moduleData: {
            ...item.moduleData,
            kanban: { ...item.moduleData.kanban, columnId: action.moveToColumnId },
          },
        };
      }
    });
    return touch({
      ...document,
      items,
      modules: {
        ...document.modules,
        kanban: {
          ...kanban,
          projects: {
            ...kanban.projects,
            [action.projectId]: {
              ...settings,
              columns,
            },
          },
        },
      },
    });
  }

  return document;
}

export function itemsForColumn(
  document: WorkspaceDocument,
  projectId: string,
  columnId: string,
): WorkItem[] {
  return Object.values(document.items)
    .filter(
      (item) => item.projectId === projectId && item.moduleData.kanban.columnId === columnId,
    )
    .sort((a, b) => a.moduleData.kanban.rank - b.moduleData.kanban.rank);
}

export type LabelUsage = { label: string; count: number };

export function labelUsageForItems(items: ReadonlyArray<WorkItem>): LabelUsage[] {
  const usages = new Map<string, LabelUsage>();
  items.forEach((item) => {
    const labelsOnTask = new Set<string>();
    item.labels.forEach((rawLabel) => {
      const label = rawLabel.trim();
      const key = label.toLocaleLowerCase();
      if (!label || labelsOnTask.has(key)) return;
      labelsOnTask.add(key);
      const existing = usages.get(key);
      usages.set(key, existing ? { ...existing, count: existing.count + 1 } : { label, count: 1 });
    });
  });
  return Array.from(usages.values()).sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }));
}

export function labelUsageForNotes(notes: ReadonlyArray<ProjectNote>): LabelUsage[] {
  const usages = new Map<string, LabelUsage>();
  notes.forEach((note) => {
    const labelsOnNote = new Set<string>();
    note.labels.forEach((rawLabel) => {
      const label = rawLabel.trim();
      const key = label.toLocaleLowerCase();
      if (!label || labelsOnNote.has(key)) return;
      labelsOnNote.add(key);
      const existing = usages.get(key);
      usages.set(key, existing ? { ...existing, count: existing.count + 1 } : { label, count: 1 });
    });
  });
  return Array.from(usages.values()).sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }));
}

export const PRIORITY_META: Record<Priority, { label: string; color: string }> = {
  none: { label: 'No priority', color: '#a4a9b4' },
  low: { label: 'Low', color: '#6f94c9' },
  medium: { label: 'Medium', color: '#d9a441' },
  high: { label: 'High', color: '#e07857' },
  urgent: { label: 'Urgent', color: '#d94f64' },
};
