export type WorkspaceView = 'board' | 'list' | 'timeline' | 'canvas' | 'roadmap' | 'files';

export type RoadmapHorizon = 'Now' | 'Next' | 'Later';
export type TimelineLayout = 'tasks' | 'compact';

export type CanvasPoint = { x: number; y: number };

export type CanvasNodeType = 'note' | 'task' | 'file' | 'shape' | 'diagram';
export type CanvasShape = 'rectangle' | 'ellipse' | 'diamond';

export type DiagramKind =
  | 'class'
  | 'abstract-class'
  | 'interface'
  | 'enum'
  | 'object'
  | 'package'
  | 'component'
  | 'artifact'
  | 'actor'
  | 'use-case'
  | 'state'
  | 'activity'
  | 'decision'
  | 'system-boundary'
  | 'entity'
  | 'database'
  | 'service'
  | 'api'
  | 'queue'
  | 'cloud'
  | 'server'
  | 'deployment-node'
  | 'process'
  | 'terminator'
  | 'document'
  | 'lifeline';

export type CanvasRelation =
  | 'association'
  | 'dependency'
  | 'inheritance'
  | 'realization'
  | 'aggregation'
  | 'composition'
  | 'message'
  | 'data-flow';

export type CanvasNode = {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  color: string;
  content: string;
  taskId?: string;
  attachmentId?: string;
  shape?: CanvasShape;
  diagramKind?: DiagramKind;
  createdAt: string;
  updatedAt: string;
};

export type CanvasConnection = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  color: string;
  relation?: CanvasRelation;
  label?: string;
  sourceLabel?: string;
  targetLabel?: string;
  createdAt: string;
};

export type CanvasStroke = {
  id: string;
  points: CanvasPoint[];
  color: string;
  width: number;
  createdAt: string;
};

export type CanvasViewport = {
  x: number;
  y: number;
  zoom: number;
};

export type CanvasProject = {
  nodes: Record<string, CanvasNode>;
  connections: Record<string, CanvasConnection>;
  strokes: Record<string, CanvasStroke>;
  viewport: CanvasViewport;
};

export type CanvasModule = {
  version: 1;
  projects: Record<string, CanvasProject>;
};

export type Priority = 'none' | 'low' | 'medium' | 'high' | 'urgent';

export type Subtask = {
  id: string;
  title: string;
  completed: boolean;
};

export type WorkspaceAttachment = {
  id: string;
  name: string;
  title?: string;
  description?: string;
  kind: 'file' | 'folder' | 'reference';
  relativePath: string;
  localPath?: string;
  sizeBytes: number;
  fileCount: number;
  createdAt: string;
};

export type TaskLink = {
  id: string;
  title?: string;
  description?: string;
  url: string;
  createdAt: string;
};

export type WorkItem = {
  id: string;
  projectId: string;
  type: 'task';
  title: string;
  description: string;
  priority: Priority;
  estimateMinutes?: number;
  startDate?: string;
  dueDate?: string;
  dependencyIds?: string[];
  attachmentIds?: string[];
  links?: TaskLink[];
  labels: string[];
  assignee?: string;
  subtasks: Subtask[];
  createdAt: string;
  updatedAt: string;
  moduleData: {
    kanban: {
      columnId: string;
      rank: number;
    };
    [moduleId: string]: unknown;
  };
};

export type Project = {
  id: string;
  name: string;
  description: string;
  color: string;
  targetDate?: string;
  createdAt: string;
  archived: boolean;
};

export type KanbanColumn = {
  id: string;
  title: string;
  color: string;
  limit?: number;
};

export type KanbanProjectSettings = {
  columns: KanbanColumn[];
};

export type KanbanModule = {
  version: 1;
  projects: Record<string, KanbanProjectSettings>;
};

export type WorkspaceDocument = {
  schemaVersion: 1;
  workspace: {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  };
  projects: Project[];
  items: Record<string, WorkItem>;
  modules: {
    kanban: KanbanModule;
    canvas: CanvasModule;
    [moduleId: string]: unknown;
  };
  resources: {
    attachments: Record<string, WorkspaceAttachment>;
    [resourceType: string]: unknown;
  };
  preferences: {
    activeProjectId: string;
    roadmapHorizonOrder?: RoadmapHorizon[];
    timelineLayout?: TimelineLayout;
    collapsedKanbanSubtaskItemIds?: string[];
  };
};

export type TaskDraft = {
  title: string;
  columnId: string;
  priority: Priority;
  startDate?: string;
  dueDate?: string;
  estimateMinutes?: number;
};

export type WorkspaceAction =
  | { type: 'load'; document: WorkspaceDocument }
  | { type: 'selectProject'; projectId: string }
  | { type: 'addProject'; project: Project; settings: KanbanProjectSettings }
  | { type: 'updateProject'; projectId: string; changes: Partial<Pick<Project, 'name' | 'description' | 'color' | 'targetDate'>> }
  | { type: 'addItem'; item: WorkItem }
  | { type: 'updateItem'; itemId: string; changes: Partial<Omit<WorkItem, 'id' | 'projectId' | 'createdAt'>> }
  | { type: 'addAttachments'; itemId: string; attachments: WorkspaceAttachment[] }
  | { type: 'updateAttachment'; attachmentId: string; changes: Partial<Pick<WorkspaceAttachment, 'title' | 'description'>> }
  | { type: 'removeAttachment'; attachmentId: string }
  | { type: 'deleteItem'; itemId: string }
  | { type: 'moveItem'; itemId: string; columnId: string; index: number }
  | { type: 'reorderKanbanItems'; projectId: string; itemIds: string[] }
  | { type: 'setTimelineLayout'; layout: TimelineLayout }
  | { type: 'setKanbanSubtasksCollapsed'; itemId: string; collapsed: boolean }
  | { type: 'reorderRoadmapColumns'; horizons: RoadmapHorizon[] }
  | { type: 'canvasAddNode'; projectId: string; node: CanvasNode }
  | { type: 'canvasUpdateNode'; projectId: string; nodeId: string; changes: Partial<Omit<CanvasNode, 'id' | 'createdAt'>> }
  | { type: 'canvasUpdateNodes'; projectId: string; updates: Array<{ nodeId: string; changes: Partial<Omit<CanvasNode, 'id' | 'createdAt'>> }> }
  | { type: 'canvasDeleteNodes'; projectId: string; nodeIds: string[] }
  | { type: 'canvasAddConnection'; projectId: string; connection: CanvasConnection }
  | { type: 'canvasDeleteConnection'; projectId: string; connectionId: string }
  | { type: 'canvasUpdateConnection'; projectId: string; connectionId: string; changes: Partial<Pick<CanvasConnection, 'color' | 'relation' | 'label' | 'sourceLabel' | 'targetLabel'>> }
  | { type: 'canvasAddStroke'; projectId: string; stroke: CanvasStroke }
  | { type: 'canvasDeleteStroke'; projectId: string; strokeId: string }
  | { type: 'canvasSetViewport'; projectId: string; viewport: CanvasViewport }
  | { type: 'canvasAddAttachments'; projectId: string; attachments: WorkspaceAttachment[]; nodes: CanvasNode[] }
  | { type: 'addColumn'; projectId: string; column: KanbanColumn }
  | { type: 'reorderColumns'; projectId: string; columnIds: string[] }
  | { type: 'updateColumn'; projectId: string; columnId: string; changes: Partial<KanbanColumn> }
  | { type: 'deleteColumn'; projectId: string; columnId: string; moveToColumnId: string };
