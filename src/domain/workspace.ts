import type {
  KanbanColumn,
  KanbanProjectSettings,
  Priority,
  Project,
  WorkItem,
  WorkspaceAction,
  WorkspaceDocument,
} from './types';

export const PROJECT_COLORS = ['#6c5ce7', '#1f9d78', '#e58b4a', '#4c84e8', '#d45d79', '#7c879e'];

export const DEFAULT_COLUMNS: KanbanColumn[] = [
  { id: 'backlog', title: 'Backlog', color: '#a4a9b4' },
  { id: 'planned', title: 'Planned', color: '#7c6ee6', limit: 5 },
  { id: 'progress', title: 'In progress', color: '#e6a44b', limit: 4 },
  { id: 'done', title: 'Done', color: '#43a882' },
];

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

export function createProject(name: string, color: string, description = ''): Project {
  return { id: id(), name, description, color, createdAt: now(), archived: false };
}

export function createProjectSettings(): KanbanProjectSettings {
  return { columns: DEFAULT_COLUMNS.map((column) => ({ ...column })) };
}

export function createWorkItem(
  projectId: string,
  columnId: string,
  title: string,
  rank: number,
  options: Partial<Pick<WorkItem, 'description' | 'priority' | 'estimateMinutes' | 'startDate' | 'dueDate' | 'dependencyIds' | 'labels' | 'assignee' | 'subtasks'>> = {},
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
    },
    resources: { attachments: {} },
    preferences: { activeProjectId: project.id },
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
    },
    resources: { attachments: {} },
    preferences: { activeProjectId: product.id },
  };
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
      typeof item.moduleData?.kanban?.columnId === 'string' &&
      typeof item.moduleData?.kanban?.rank === 'number',
    );
  const kanbanProjects = candidate.modules?.kanban?.projects;
  const kanbanValid = Boolean(kanbanProjects) &&
    typeof kanbanProjects === 'object' &&
    Object.values(kanbanProjects ?? {}).every((settings) =>
      Array.isArray(settings.columns) && settings.columns.every((column) =>
        typeof column.id === 'string' && typeof column.title === 'string',
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
      (attachment.kind === 'file' || attachment.kind === 'folder') &&
      typeof attachment.relativePath === 'string' &&
      typeof attachment.sizeBytes === 'number' &&
      typeof attachment.fileCount === 'number' &&
      typeof attachment.createdAt === 'string',
    )
  );

  return (
    candidate.schemaVersion === 1 &&
    Boolean(candidate.workspace?.id) &&
    projectsValid &&
    itemsValid &&
    kanbanValid &&
    attachmentsValid &&
    typeof candidate.preferences?.activeProjectId === 'string'
  );
}

export function normalizeWorkspaceDocument(document: WorkspaceDocument): WorkspaceDocument {
  return {
    ...document,
    items: Object.fromEntries(Object.entries(document.items).map(([itemId, item]) => [
      itemId,
      { ...item, dependencyIds: item.dependencyIds ?? [], attachmentIds: item.attachmentIds ?? [] },
    ])),
    resources: {
      ...(document.resources ?? {}),
      attachments: document.resources?.attachments ?? {},
    },
  };
}

function touch(document: WorkspaceDocument): WorkspaceDocument {
  return {
    ...document,
    workspace: { ...document.workspace, updatedAt: now() },
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
    return touch({ ...document, items, resources: { ...document.resources, attachments } });
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
    return touch({ ...document, items, resources: { ...document.resources, attachments } });
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
              columns: settings.columns.map((column) =>
                column.id === action.columnId ? { ...column, ...action.changes } : column,
              ),
            },
          },
        },
      },
    });
  }

  if (action.type === 'deleteColumn') {
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
              columns: settings.columns.filter((column) => column.id !== action.columnId),
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

export const PRIORITY_META: Record<Priority, { label: string; color: string }> = {
  none: { label: 'No priority', color: '#a4a9b4' },
  low: { label: 'Low', color: '#6f94c9' },
  medium: { label: 'Medium', color: '#d9a441' },
  high: { label: 'High', color: '#e07857' },
  urgent: { label: 'Urgent', color: '#d94f64' },
};
