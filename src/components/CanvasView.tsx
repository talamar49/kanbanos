import {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Box,
  Boxes,
  Braces,
  CalendarDays,
  Check,
  CheckCircle2,
  Circle,
  Cloud,
  Copy,
  Database,
  Diamond,
  ExternalLink,
  File,
  Folder,
  GitBranch,
  HardDrive,
  GripVertical,
  ListTodo,
  Maximize2,
  MousePointer2,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Server,
  Shapes,
  Sparkles,
  Square,
  StickyNote,
  Trash2,
  UserRound,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  CanvasConnection,
  CanvasNode,
  CanvasPoint,
  CanvasProject,
  CanvasRelation,
  CanvasShape,
  CanvasStroke,
  CanvasViewport,
  DiagramKind,
  Project,
  WorkItem,
  WorkspaceAction,
  WorkspaceAttachment,
  WorkspaceDocument,
} from '../domain/types';
import {
  CANVAS_NODE_COLORS,
  createCanvasConnection,
  createCanvasNode,
  createCanvasStroke,
  PRIORITY_META,
} from '../domain/workspace';
import { useI18n } from '../i18n';
import { PreferencesControls } from './PreferencesControls';

type SaveState = 'idle' | 'saving' | 'synced' | 'error' | 'local';
type CanvasTool = 'select' | 'pen';
type LibraryPanel = 'tasks' | 'files' | 'shapes' | 'diagrams' | null;
type NodePreview = Record<string, Pick<CanvasNode, 'x' | 'y'>>;
type ResizePreview = { nodeId: string; width: number; height: number } | null;

type Gesture =
  | { type: 'pan'; pointerId: number; start: CanvasPoint; viewport: CanvasViewport }
  | { type: 'nodes'; pointerId: number; start: CanvasPoint; origins: Record<string, CanvasPoint> }
  | { type: 'resize'; pointerId: number; start: CanvasPoint; node: CanvasNode }
  | { type: 'select'; pointerId: number; start: CanvasPoint; current: CanvasPoint }
  | { type: 'connect'; pointerId: number; sourceNodeId: string }
  | { type: 'pen'; pointerId: number; points: CanvasPoint[] };

type Props = {
  document: WorkspaceDocument;
  project: Project;
  saveState: SaveState;
  dirty: boolean;
  onAction: (action: WorkspaceAction) => void;
  onSave: () => void;
  onOpenTask: (item: WorkItem) => void;
  onCreateTask: (point: CanvasPoint) => void;
  onAddFiles: (point: CanvasPoint, kind: 'files' | 'folders' | 'references') => void;
  onPreviewAttachment: (attachment: WorkspaceAttachment) => void;
  onOpenAttachment: (attachment: WorkspaceAttachment) => void;
  mobile?: boolean;
};

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.2;
const GRID_SIZE = 24;
const EMPTY_CANVAS: CanvasProject = {
  nodes: {},
  connections: {},
  strokes: {},
  viewport: { x: 0, y: 0, zoom: 1 },
};

type DiagramCategory = 'UML structure' | 'UML behavior' | 'Architecture & data' | 'Flow & sequence';
type DiagramDefinition = { kind: DiagramKind; label: string; category: DiagramCategory; width?: number; height?: number };

const DIAGRAM_ELEMENTS: DiagramDefinition[] = [
  { kind: 'class', label: 'Class', category: 'UML structure', width: 290, height: 220 },
  { kind: 'abstract-class', label: 'Abstract class', category: 'UML structure', width: 290, height: 220 },
  { kind: 'interface', label: 'Interface', category: 'UML structure', width: 290, height: 210 },
  { kind: 'enum', label: 'Enumeration', category: 'UML structure', width: 270, height: 200 },
  { kind: 'object', label: 'Object instance', category: 'UML structure', width: 270, height: 180 },
  { kind: 'package', label: 'Package', category: 'UML structure', width: 300, height: 210 },
  { kind: 'component', label: 'Component', category: 'UML structure', width: 270, height: 170 },
  { kind: 'artifact', label: 'Artifact', category: 'UML structure', width: 250, height: 170 },
  { kind: 'actor', label: 'Actor', category: 'UML behavior', width: 180, height: 230 },
  { kind: 'use-case', label: 'Use case', category: 'UML behavior', width: 280, height: 160 },
  { kind: 'state', label: 'State', category: 'UML behavior', width: 260, height: 160 },
  { kind: 'activity', label: 'Activity', category: 'UML behavior', width: 260, height: 160 },
  { kind: 'decision', label: 'Decision', category: 'UML behavior', width: 190, height: 190 },
  { kind: 'system-boundary', label: 'System boundary', category: 'UML behavior', width: 390, height: 300 },
  { kind: 'entity', label: 'ER entity', category: 'Architecture & data', width: 290, height: 220 },
  { kind: 'database', label: 'Database', category: 'Architecture & data', width: 220, height: 210 },
  { kind: 'service', label: 'Service', category: 'Architecture & data', width: 270, height: 170 },
  { kind: 'api', label: 'API', category: 'Architecture & data', width: 250, height: 160 },
  { kind: 'queue', label: 'Message queue', category: 'Architecture & data', width: 270, height: 150 },
  { kind: 'cloud', label: 'Cloud', category: 'Architecture & data', width: 270, height: 170 },
  { kind: 'server', label: 'Server', category: 'Architecture & data', width: 230, height: 190 },
  { kind: 'deployment-node', label: 'Deployment node', category: 'Architecture & data', width: 290, height: 210 },
  { kind: 'process', label: 'Process', category: 'Flow & sequence', width: 270, height: 150 },
  { kind: 'terminator', label: 'Start / end', category: 'Flow & sequence', width: 240, height: 120 },
  { kind: 'document', label: 'Document', category: 'Flow & sequence', width: 250, height: 180 },
  { kind: 'lifeline', label: 'Sequence lifeline', category: 'Flow & sequence', width: 210, height: 360 },
];

const DIAGRAM_CATEGORIES: DiagramCategory[] = ['UML structure', 'UML behavior', 'Architecture & data', 'Flow & sequence'];
const RELATIONSHIPS: Array<{ relation: CanvasRelation; label: string }> = [
  { relation: 'association', label: 'Association' },
  { relation: 'dependency', label: 'Dependency' },
  { relation: 'inheritance', label: 'Inheritance' },
  { relation: 'realization', label: 'Realization' },
  { relation: 'aggregation', label: 'Aggregation' },
  { relation: 'composition', label: 'Composition' },
  { relation: 'message', label: 'Message' },
  { relation: 'data-flow', label: 'Data flow' },
];

function relationMarkers(relation: CanvasRelation = 'association'): { markerStart?: string; markerEnd?: string } {
  if (relation === 'inheritance' || relation === 'realization') return { markerEnd: 'url(#canvas-triangle)' };
  if (relation === 'aggregation') return { markerStart: 'url(#canvas-diamond-open)' };
  if (relation === 'composition') return { markerStart: 'url(#canvas-diamond-filled)' };
  if (relation === 'data-flow') return { markerEnd: 'url(#canvas-arrow-filled)' };
  return { markerEnd: 'url(#canvas-arrow-open)' };
}

function diagramDefinition(kind?: DiagramKind): DiagramDefinition | undefined {
  return DIAGRAM_ELEMENTS.find((definition) => definition.kind === kind);
}

function clampZoom(value: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

function strokePath(points: CanvasPoint[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    path += ` Q ${current.x} ${current.y} ${(current.x + next.x) / 2} ${(current.y + next.y) / 2}`;
  }
  const last = points[points.length - 1];
  path += ` L ${last.x} ${last.y}`;
  return path;
}

function nodeCenter(node: CanvasNode): CanvasPoint {
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

function nodeAnchor(node: CanvasNode, toward: CanvasPoint): CanvasPoint {
  const center = nodeCenter(node);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) return center;
  const scale = 1 / Math.max(Math.abs(dx) / Math.max(1, node.width / 2), Math.abs(dy) / Math.max(1, node.height / 2));
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

function connectionAnchors(from: CanvasNode, toPoint: CanvasPoint, to?: CanvasNode): { start: CanvasPoint; end: CanvasPoint } {
  const fromCenter = nodeCenter(from);
  const toCenter = to ? nodeCenter(to) : toPoint;
  return {
    start: nodeAnchor(from, toCenter),
    end: to ? nodeAnchor(to, fromCenter) : toPoint,
  };
}

function connectionPath(from: CanvasNode, toPoint: CanvasPoint, to?: CanvasNode): string {
  const { start, end } = connectionAnchors(from, toPoint, to);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) >= Math.abs(dy) * 0.55) {
    const bend = Math.max(58, Math.abs(dx) * 0.42);
    const direction = dx >= 0 ? 1 : -1;
    return `M ${start.x} ${start.y} C ${start.x + bend * direction} ${start.y}, ${end.x - bend * direction} ${end.y}, ${end.x} ${end.y}`;
  }
  const bend = Math.max(58, Math.abs(dy) * 0.42);
  const direction = dy >= 0 ? 1 : -1;
  return `M ${start.x} ${start.y} C ${start.x} ${start.y + bend * direction}, ${end.x} ${end.y - bend * direction}, ${end.x} ${end.y}`;
}

function formatFileSize(bytes: number, locale: string): string {
  if (bytes < 1024) return `${bytes.toLocaleString(locale)} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString(locale, { maximumFractionDigits: value >= 10 ? 0 : 1 })} ${units[unit]}`;
}

function CanvasToolButton({
  active,
  label,
  shortcut,
  children,
  library,
  onClick,
}: {
  active?: boolean;
  label: string;
  shortcut?: string;
  children: React.ReactNode;
  library?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`canvas-tool ${active ? 'active' : ''}`}
      aria-label={label}
      title={shortcut ? `${label} · ${shortcut}` : label}
      data-library={library ? 'true' : undefined}
      onClick={onClick}
    >
      {children}
      <span className="canvas-tool-tooltip">{label}{shortcut && <kbd>{shortcut}</kbd>}</span>
    </button>
  );
}

function EditableNote({ node, focus, onChange }: { node: CanvasNode; focus: boolean; onChange: (content: string) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(node.content);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setDraft(node.content), [node.content]);
  useEffect(() => {
    if (focus) window.setTimeout(() => inputRef.current?.focus(), 60);
  }, [focus]);

  return (
    <textarea
      ref={inputRef}
      className="canvas-node-interactive canvas-note-input"
      value={draft}
      placeholder={t('Write down a thought…')}
      aria-label={t('Note text')}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== node.content) onChange(draft);
      }}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

function EditableShape({ node, onChange }: { node: CanvasNode; onChange: (content: string) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(node.content);
  useEffect(() => setDraft(node.content), [node.content]);
  return (
    <textarea
      className="canvas-node-interactive canvas-shape-input"
      value={draft}
      placeholder={t('Add a label')}
      aria-label={t('Shape label')}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== node.content) onChange(draft);
      }}
    />
  );
}

function DiagramIcon({ kind, size = 22 }: { kind: DiagramKind; size?: number }) {
  if (kind === 'actor') return <UserRound size={size} />;
  if (kind === 'database' || kind === 'entity') return <Database size={size} />;
  if (kind === 'cloud') return <Cloud size={size} />;
  if (kind === 'server' || kind === 'deployment-node') return <Server size={size} />;
  if (kind === 'component' || kind === 'service') return <Boxes size={size} />;
  if (kind === 'api') return <Braces size={size} />;
  if (kind === 'package' || kind === 'artifact' || kind === 'document') return <Box size={size} />;
  return <Workflow size={size} />;
}

function EditableDiagram({ node, focus, onChange }: { node: CanvasNode; focus: boolean; onChange: (content: string) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(node.content);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const detailInputRef = useRef<HTMLTextAreaElement>(null);
  const definition = diagramDefinition(node.diagramKind);
  const classLike = ['class', 'abstract-class', 'interface', 'enum', 'object', 'entity'].includes(node.diagramKind ?? '');
  const rawCompartments = draft.split(/\n-{3,}\n/);
  const legacyLines = rawCompartments.length === 1 ? draft.split('\n') : [];
  const compartments = rawCompartments.length > 1
    ? [rawCompartments[0] ?? '', rawCompartments[1] ?? '', rawCompartments.slice(2).join('\n---\n')]
    : [legacyLines[0] ?? '', legacyLines.slice(1).join('\n'), ''];

  useEffect(() => setDraft(node.content), [node.content]);
  useEffect(() => {
    if (focus) window.setTimeout(() => (classLike ? nameInputRef.current : detailInputRef.current)?.focus(), 70);
  }, [classLike, focus]);

  const commit = () => {
    if (draft !== node.content) onChange(draft);
  };
  const updateCompartment = (index: number, value: string) => {
    const next = [...compartments];
    next[index] = value;
    setDraft(next.join('\n---\n'));
  };
  const secondLabel = node.diagramKind === 'enum'
    ? 'Values'
    : node.diagramKind === 'entity'
      ? 'Fields'
      : node.diagramKind === 'interface'
        ? 'Properties'
        : 'Attributes';
  const secondPlaceholder = node.diagramKind === 'enum'
    ? 'VALUE'
    : node.diagramKind === 'entity'
      ? 'field: Type'
      : node.diagramKind === 'interface'
        ? '+ property: Type'
        : '+ attribute: Type';

  return (
    <div className="canvas-diagram-content">
      <header>
        <span><DiagramIcon kind={node.diagramKind ?? 'class'} size={17} /></span>
        <small>{t(definition?.label ?? 'Diagram element')}</small>
      </header>
      {classLike ? (
        <div className="canvas-diagram-compartments">
          <input
            ref={nameInputRef}
            className="canvas-node-interactive diagram-name-compartment"
            value={compartments[0]}
            placeholder={t('Element name')}
            aria-label={t('{{type}} name', { type: t(definition?.label ?? 'Diagram element') })}
            spellCheck="false"
            onChange={(event) => updateCompartment(0, event.target.value)}
            onBlur={commit}
          />
          <label className="diagram-detail-compartment">
            <span>{t(secondLabel)}</span>
            <textarea
              className="canvas-node-interactive"
              value={compartments[1]}
              placeholder={t(secondPlaceholder)}
              aria-label={t(secondLabel)}
              spellCheck="false"
              onChange={(event) => updateCompartment(1, event.target.value)}
              onBlur={commit}
            />
          </label>
          <label className="diagram-detail-compartment">
            <span>{t('Operations')}</span>
            <textarea
              className="canvas-node-interactive"
              value={compartments[2]}
              placeholder={t('+ operation(): Return')}
              aria-label={t('Operations')}
              spellCheck="false"
              onChange={(event) => updateCompartment(2, event.target.value)}
              onBlur={commit}
            />
          </label>
        </div>
      ) : (
        <textarea
          ref={detailInputRef}
          className="canvas-node-interactive canvas-diagram-input"
          value={draft}
          placeholder={node.diagramKind === 'lifeline' ? t('Participant name') : `${t('Element name')}\n${t('Add responsibilities or details…')}`}
          aria-label={t('{{type}} details', { type: t(definition?.label ?? 'Diagram element') })}
          spellCheck="false"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      )}
    </div>
  );
}

function ConnectionInspector({
  connection,
  onUpdate,
  onDelete,
}: {
  connection: CanvasConnection;
  onUpdate: (changes: Partial<Pick<CanvasConnection, 'relation' | 'label' | 'sourceLabel' | 'targetLabel'>>) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="canvas-relation-inspector slide-up" onPointerDown={(event) => event.stopPropagation()}>
      <label>
        <span>{t('Relationship')}</span>
        <select value={connection.relation ?? 'association'} onChange={(event) => onUpdate({ relation: event.target.value as CanvasRelation })}>
          {RELATIONSHIPS.map((item) => <option key={item.relation} value={item.relation}>{t(item.label)}</option>)}
        </select>
      </label>
      <label className="relation-name-field"><span>{t('Label')}</span><input key={`${connection.id}:label`} defaultValue={connection.label} placeholder={t('e.g. creates')} onBlur={(event) => onUpdate({ label: event.target.value })} /></label>
      <label><span>{t('From')}</span><input key={`${connection.id}:source`} defaultValue={connection.sourceLabel} placeholder="1" onBlur={(event) => onUpdate({ sourceLabel: event.target.value })} /></label>
      <label><span>{t('To')}</span><input key={`${connection.id}:target`} defaultValue={connection.targetLabel} placeholder="*" onBlur={(event) => onUpdate({ targetLabel: event.target.value })} /></label>
      <button className="relation-delete" onClick={onDelete} aria-label={t('Remove connection')} title={t('Remove connection')}><Trash2 size={16} /></button>
    </div>
  );
}

function MiniMap({
  canvasProject,
  viewport,
  stageSize,
  onNavigate,
  label,
}: {
  canvasProject: CanvasProject;
  viewport: CanvasViewport;
  stageSize: { width: number; height: number };
  onNavigate: (point: CanvasPoint) => void;
  label: string;
}) {
  const nodes = Object.values(canvasProject.nodes);
  const view = {
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
    width: stageSize.width / viewport.zoom,
    height: stageSize.height / viewport.zoom,
  };
  const minX = Math.min(view.x, ...nodes.map((node) => node.x)) - 90;
  const minY = Math.min(view.y, ...nodes.map((node) => node.y)) - 90;
  const maxX = Math.max(view.x + view.width, ...nodes.map((node) => node.x + node.width)) + 90;
  const maxY = Math.max(view.y + view.height, ...nodes.map((node) => node.y + node.height)) + 90;
  const worldWidth = Math.max(1, maxX - minX);
  const worldHeight = Math.max(1, maxY - minY);
  const width = 176;
  const height = 108;
  const scale = Math.min(width / worldWidth, height / worldHeight);
  const offsetX = (width - worldWidth * scale) / 2;
  const offsetY = (height - worldHeight * scale) / 2;
  const left = (x: number) => offsetX + (x - minX) * scale;
  const top = (y: number) => offsetY + (y - minY) * scale;

  return (
    <button
      type="button"
      className="canvas-minimap"
      aria-label={label}
      onClick={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        onNavigate({
          x: minX + (event.clientX - bounds.left - offsetX) / scale,
          y: minY + (event.clientY - bounds.top - offsetY) / scale,
        });
      }}
    >
      {nodes.map((node) => (
        <i
          key={node.id}
          className={`canvas-minimap-node type-${node.type}`}
          style={{ left: left(node.x), top: top(node.y), width: Math.max(3, node.width * scale), height: Math.max(3, node.height * scale), background: node.color }}
        />
      ))}
      <span
        className="canvas-minimap-viewport"
        style={{ left: left(view.x), top: top(view.y), width: Math.max(8, view.width * scale), height: Math.max(6, view.height * scale) }}
      />
    </button>
  );
}

export function CanvasView({
  document,
  project,
  saveState,
  dirty,
  onAction,
  onSave,
  onOpenTask,
  onCreateTask,
  onAddFiles,
  onPreviewAttachment,
  onOpenAttachment,
  mobile = false,
}: Props) {
  const { locale, t } = useI18n();
  const canvasProject = document.modules.canvas.projects[project.id] ?? EMPTY_CANVAS;
  const [viewport, setViewport] = useState<CanvasViewport>(canvasProject.viewport);
  const [tool, setTool] = useState<CanvasTool>('select');
  const [libraryPanel, setLibraryPanel] = useState<LibraryPanel>(null);
  const [taskSearch, setTaskSearch] = useState('');
  const [diagramSearch, setDiagramSearch] = useState('');
  const [activeRelation, setActiveRelation] = useState<CanvasRelation>('association');
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [selectedStrokeId, setSelectedStrokeId] = useState<string | null>(null);
  const [connectorSourceId, setConnectorSourceId] = useState<string | null>(null);
  const [connectorTargetId, setConnectorTargetId] = useState<string | null>(null);
  const [pointerWorld, setPointerWorld] = useState<CanvasPoint>({ x: 0, y: 0 });
  const [nodePreview, setNodePreview] = useState<NodePreview>({});
  const [resizePreview, setResizePreview] = useState<ResizePreview>(null);
  const [selectionBox, setSelectionBox] = useState<{ start: CanvasPoint; current: CanvasPoint } | null>(null);
  const [liveStroke, setLiveStroke] = useState<CanvasStroke | null>(null);
  const [placingShape, setPlacingShape] = useState<CanvasShape | null>(null);
  const [placingDiagram, setPlacingDiagram] = useState<DiagramKind | null>(null);
  const [freshNodeId, setFreshNodeId] = useState<string | null>(null);
  const [stageSize, setStageSize] = useState({ width: 1000, height: 650 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const viewportRef = useRef(viewport);
  const selectedRef = useRef(selectedNodeIds);

  viewportRef.current = viewport;
  selectedRef.current = selectedNodeIds;

  const nodes = useMemo(() => Object.values(canvasProject.nodes).sort((left, right) => left.zIndex - right.zIndex), [canvasProject.nodes]);
  const taskNodes = useMemo(() => new Set(nodes.map((node) => node.taskId).filter(Boolean)), [nodes]);
  const fileNodes = useMemo(() => new Set(nodes.map((node) => node.attachmentId).filter(Boolean)), [nodes]);
  const projectTasks = useMemo(() => Object.values(document.items)
    .filter((item) => item.projectId === project.id)
    .sort((left, right) => left.moduleData.kanban.rank - right.moduleData.kanban.rank), [document.items, project.id]);
  const searchedTasks = projectTasks.filter((item) => item.title.toLocaleLowerCase().includes(taskSearch.trim().toLocaleLowerCase()));
  const attachments = Object.values(document.resources.attachments).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const normalizedDiagramSearch = diagramSearch.trim().toLocaleLowerCase();
  const visibleDiagramElements = DIAGRAM_ELEMENTS.filter((definition) => !normalizedDiagramSearch || `${definition.label} ${definition.category}`.toLocaleLowerCase().includes(normalizedDiagramSearch));
  const maxZIndex = Math.max(0, ...nodes.map((node) => node.zIndex));
  const selectedNode = selectedNodeIds.length === 1 ? canvasProject.nodes[selectedNodeIds[0]] : undefined;
  const selectedConnection = selectedConnectionId ? canvasProject.connections[selectedConnectionId] : undefined;
  const isEmpty = nodes.length === 0 && Object.keys(canvasProject.strokes).length === 0;

  useEffect(() => {
    setViewport(canvasProject.viewport);
    setSelectedNodeIds([]);
    setSelectedConnectionId(null);
    setSelectedStrokeId(null);
    setConnectorSourceId(null);
    setConnectorTargetId(null);
    setPlacingDiagram(null);
    setLibraryPanel(null);
  }, [project.id]);

  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = canvasProject.viewport;
      if (Math.abs(stored.x - viewport.x) > 0.5 || Math.abs(stored.y - viewport.y) > 0.5 || Math.abs(stored.zoom - viewport.zoom) > 0.002) {
        onAction({ type: 'canvasSetViewport', projectId: project.id, viewport });
      }
    }, 550);
    return () => window.clearTimeout(timer);
  }, [canvasProject.viewport, onAction, project.id, viewport]);

  const screenToWorld = (clientX: number, clientY: number): CanvasPoint => {
    const bounds = stageRef.current?.getBoundingClientRect();
    const current = viewportRef.current;
    return {
      x: ((clientX - (bounds?.left ?? 0)) - current.x) / current.zoom,
      y: ((clientY - (bounds?.top ?? 0)) - current.y) / current.zoom,
    };
  };

  const centerWorld = (width = 0, height = 0): CanvasPoint => {
    const current = viewportRef.current;
    return {
      x: (stageSize.width / 2 - current.x) / current.zoom - width / 2,
      y: (stageSize.height / 2 - current.y) / current.zoom - height / 2,
    };
  };

  const addNode = (node: CanvasNode, focus = false) => {
    onAction({ type: 'canvasAddNode', projectId: project.id, node });
    setSelectedNodeIds([node.id]);
    setSelectedConnectionId(null);
    setSelectedStrokeId(null);
    setFreshNodeId(focus ? node.id : null);
    setLibraryPanel(null);
  };

  const addNote = () => {
    const point = centerWorld(260, 220);
    const offset = (nodes.length % 5) * 12;
    addNode(createCanvasNode('note', { x: point.x + offset, y: point.y + offset }, {
      zIndex: maxZIndex + 1,
      color: CANVAS_NODE_COLORS[nodes.length % CANVAS_NODE_COLORS.length],
    }), true);
    setTool('select');
  };

  const addTaskNode = (item: WorkItem) => {
    const point = centerWorld(300, 174);
    addNode(createCanvasNode('task', { x: point.x + (nodes.length % 4) * 14, y: point.y + (nodes.length % 4) * 14 }, {
      taskId: item.id,
      zIndex: maxZIndex + 1,
      color: project.color,
    }));
  };

  const addFileNode = (attachment: WorkspaceAttachment) => {
    const point = centerWorld(276, 138);
    addNode(createCanvasNode('file', { x: point.x + (nodes.length % 4) * 14, y: point.y + (nodes.length % 4) * 14 }, {
      attachmentId: attachment.id,
      zIndex: maxZIndex + 1,
    }));
  };

  const selectTool = (nextTool: CanvasTool) => {
    setTool(nextTool);
    setLibraryPanel(null);
    setPlacingShape(null);
    setPlacingDiagram(null);
    setConnectorSourceId(null);
    setConnectorTargetId(null);
  };

  const selectNode = (nodeId: string, additive = false) => {
    setSelectedNodeIds((current) => additive
      ? current.includes(nodeId) ? current.filter((id) => id !== nodeId) : [...current, nodeId]
      : [nodeId]);
    setSelectedConnectionId(null);
    setSelectedStrokeId(null);
  };

  const beginNodeGesture = (event: ReactPointerEvent, node: CanvasNode) => {
    event.stopPropagation();
    if (tool !== 'select' || event.button !== 0) return;
    const interactive = (event.target as HTMLElement).closest('.canvas-node-interactive, button, textarea, input');
    const wasSelected = selectedRef.current.includes(node.id);
    if (event.shiftKey) selectNode(node.id, true);
    else if (!wasSelected) selectNode(node.id);
    if (interactive || (event.shiftKey && wasSelected)) return;
    const movingIds = wasSelected ? selectedRef.current : [node.id];
    const origins = Object.fromEntries(movingIds.map((nodeId) => {
      const movingNode = canvasProject.nodes[nodeId];
      return [nodeId, { x: movingNode.x, y: movingNode.y }];
    }));
    gestureRef.current = { type: 'nodes', pointerId: event.pointerId, start: screenToWorld(event.clientX, event.clientY), origins };
    stageRef.current?.setPointerCapture(event.pointerId);
  };

  const beginResize = (event: ReactPointerEvent, node: CanvasNode) => {
    event.stopPropagation();
    gestureRef.current = { type: 'resize', pointerId: event.pointerId, start: screenToWorld(event.clientX, event.clientY), node };
    setResizePreview({ nodeId: node.id, width: node.width, height: node.height });
    stageRef.current?.setPointerCapture(event.pointerId);
  };

  const nodeAtPoint = (point: CanvasPoint, excludedNodeId?: string): CanvasNode | undefined => [...nodes]
    .reverse()
    .find((node) => node.id !== excludedNodeId && point.x >= node.x && point.x <= node.x + node.width && point.y >= node.y && point.y <= node.y + node.height);

  const beginConnection = (event: ReactPointerEvent, node: CanvasNode) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const point = screenToWorld(event.clientX, event.clientY);
    gestureRef.current = { type: 'connect', pointerId: event.pointerId, sourceNodeId: node.id };
    setPointerWorld(point);
    setConnectorSourceId(node.id);
    setConnectorTargetId(null);
    stageRef.current?.setPointerCapture(event.pointerId);
  };

  const handleStagePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    setLibraryPanel(null);
    setFreshNodeId(null);
    setConnectorSourceId(null);
    setConnectorTargetId(null);
    const point = screenToWorld(event.clientX, event.clientY);
    setPointerWorld(point);

    const beginPan = () => {
      event.preventDefault();
      gestureRef.current = {
        type: 'pan' as const,
        pointerId: event.pointerId,
        start: { x: event.clientX, y: event.clientY },
        viewport: viewportRef.current,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    };

    if (event.button === 1 || spaceHeld) {
      beginPan();
      return;
    }
    if (placingDiagram) {
      const definition = diagramDefinition(placingDiagram);
      const width = definition?.width ?? 280;
      const height = definition?.height ?? 210;
      const node = createCanvasNode('diagram', { x: point.x - width / 2, y: point.y - height / 2 }, {
        diagramKind: placingDiagram,
        width,
        height,
        zIndex: maxZIndex + 1,
        color: CANVAS_NODE_COLORS[3],
      });
      addNode(node, true);
      setPlacingDiagram(null);
      setTool('select');
      return;
    }
    if (placingShape) {
      const node = createCanvasNode('shape', { x: point.x - 115, y: point.y - 80 }, {
        shape: placingShape,
        zIndex: maxZIndex + 1,
        color: CANVAS_NODE_COLORS[4],
      });
      addNode(node);
      setPlacingShape(null);
      setTool('select');
      return;
    }
    if (tool === 'pen') {
      const stroke = createCanvasStroke([point], '#5147a6', 4);
      gestureRef.current = { type: 'pen', pointerId: event.pointerId, points: [point] };
      setLiveStroke(stroke);
      event.currentTarget.setPointerCapture(event.pointerId);
      setSelectedNodeIds([]);
      setSelectedConnectionId(null);
      setSelectedStrokeId(null);
      return;
    }

    setSelectedNodeIds([]);
    setSelectedConnectionId(null);
    setSelectedStrokeId(null);
    if (event.shiftKey) {
      gestureRef.current = { type: 'select', pointerId: event.pointerId, start: point, current: point };
      setSelectionBox({ start: point, current: point });
      event.currentTarget.setPointerCapture(event.pointerId);
    } else {
      beginPan();
    }
  };

  const handleStagePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const point = screenToWorld(event.clientX, event.clientY);
    setPointerWorld(point);
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.type === 'pan') {
      setViewport({
        ...gesture.viewport,
        x: gesture.viewport.x + event.clientX - gesture.start.x,
        y: gesture.viewport.y + event.clientY - gesture.start.y,
      });
      return;
    }
    if (gesture.type === 'nodes') {
      const dx = point.x - gesture.start.x;
      const dy = point.y - gesture.start.y;
      setNodePreview(Object.fromEntries(Object.entries(gesture.origins).map(([nodeId, origin]) => [nodeId, { x: origin.x + dx, y: origin.y + dy }])));
      return;
    }
    if (gesture.type === 'resize') {
      setResizePreview({
        nodeId: gesture.node.id,
        width: Math.max(140, gesture.node.width + point.x - gesture.start.x),
        height: Math.max(96, gesture.node.height + point.y - gesture.start.y),
      });
      return;
    }
    if (gesture.type === 'select') {
      gesture.current = point;
      setSelectionBox({ start: gesture.start, current: point });
      return;
    }
    if (gesture.type === 'connect') {
      setConnectorTargetId(nodeAtPoint(point, gesture.sourceNodeId)?.id ?? null);
      return;
    }
    const previous = gesture.points[gesture.points.length - 1];
    if (Math.hypot(point.x - previous.x, point.y - previous.y) < 2.2 / viewportRef.current.zoom) return;
    gesture.points.push(point);
    setLiveStroke((current) => current ? { ...current, points: [...gesture.points] } : current);
  };

  const finishGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.type === 'nodes' && Object.keys(nodePreview).length > 0) {
      onAction({
        type: 'canvasUpdateNodes',
        projectId: project.id,
        updates: Object.entries(nodePreview).map(([nodeId, changes]) => ({ nodeId, changes })),
      });
    } else if (gesture.type === 'resize' && resizePreview) {
      onAction({ type: 'canvasUpdateNode', projectId: project.id, nodeId: resizePreview.nodeId, changes: { width: resizePreview.width, height: resizePreview.height } });
    } else if (gesture.type === 'select') {
      const left = Math.min(gesture.start.x, gesture.current.x);
      const top = Math.min(gesture.start.y, gesture.current.y);
      const right = Math.max(gesture.start.x, gesture.current.x);
      const bottom = Math.max(gesture.start.y, gesture.current.y);
      if (right - left > 3 && bottom - top > 3) {
        setSelectedNodeIds(nodes.filter((node) => node.x < right && node.x + node.width > left && node.y < bottom && node.y + node.height > top).map((node) => node.id));
      }
    } else if (gesture.type === 'connect') {
      const target = event.type === 'pointercancel'
        ? undefined
        : nodeAtPoint(screenToWorld(event.clientX, event.clientY), gesture.sourceNodeId);
      if (target) {
        onAction({ type: 'canvasAddConnection', projectId: project.id, connection: createCanvasConnection(gesture.sourceNodeId, target.id, '#7568d0', activeRelation) });
        setSelectedNodeIds([target.id]);
      }
    } else if (gesture.type === 'pen' && liveStroke && liveStroke.points.length > 1) {
      onAction({ type: 'canvasAddStroke', projectId: project.id, stroke: liveStroke });
      setSelectedStrokeId(liveStroke.id);
    }
    gestureRef.current = null;
    setConnectorSourceId(null);
    setConnectorTargetId(null);
    setNodePreview({});
    setResizePreview(null);
    setSelectionBox(null);
    setLiveStroke(null);
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* Pointer capture may already be released. */ }
  };

  const zoomAt = (nextZoom: number, clientX?: number, clientY?: number) => {
    const zoom = clampZoom(nextZoom);
    const bounds = stageRef.current?.getBoundingClientRect();
    const screen = {
      x: clientX === undefined ? stageSize.width / 2 : clientX - (bounds?.left ?? 0),
      y: clientY === undefined ? stageSize.height / 2 : clientY - (bounds?.top ?? 0),
    };
    const current = viewportRef.current;
    const world = { x: (screen.x - current.x) / current.zoom, y: (screen.y - current.y) / current.zoom };
    setViewport({ x: screen.x - world.x * zoom, y: screen.y - world.y * zoom, zoom });
  };

  const handleWheel = (event: WheelEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.canvas-library-panel, .canvas-shape-panel, .canvas-relation-inspector, input, textarea, select')) {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
      return;
    }
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      zoomAt(viewportRef.current.zoom * Math.exp(-event.deltaY * 0.0025), event.clientX, event.clientY);
    } else {
      setViewport((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
    }
  };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let gestureStartZoom = viewportRef.current.zoom;
    const wheel = (event: WheelEvent) => handleWheel(event);
    const gestureStart = (event: Event) => {
      event.preventDefault();
      gestureStartZoom = viewportRef.current.zoom;
    };
    const gestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as Event & { scale?: number; clientX?: number; clientY?: number };
      zoomAt(gestureStartZoom * (gesture.scale ?? 1), gesture.clientX, gesture.clientY);
    };
    stage.addEventListener('wheel', wheel, { passive: false });
    stage.addEventListener('gesturestart', gestureStart, { passive: false });
    stage.addEventListener('gesturechange', gestureChange, { passive: false });
    return () => {
      stage.removeEventListener('wheel', wheel);
      stage.removeEventListener('gesturestart', gestureStart);
      stage.removeEventListener('gesturechange', gestureChange);
    };
  }, []);

  const fitCanvas = () => {
    if (nodes.length === 0) {
      setViewport({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const minX = Math.min(...nodes.map((node) => node.x));
    const minY = Math.min(...nodes.map((node) => node.y));
    const maxX = Math.max(...nodes.map((node) => node.x + node.width));
    const maxY = Math.max(...nodes.map((node) => node.y + node.height));
    const padding = 150;
    const zoom = clampZoom(Math.min(stageSize.width / (maxX - minX + padding * 2), stageSize.height / (maxY - minY + padding * 2), 1.15));
    setViewport({
      x: stageSize.width / 2 - ((minX + maxX) / 2) * zoom,
      y: stageSize.height / 2 - ((minY + maxY) / 2) * zoom,
      zoom,
    });
  };

  const deleteSelection = () => {
    if (selectedNodeIds.length > 0) {
      onAction({ type: 'canvasDeleteNodes', projectId: project.id, nodeIds: selectedNodeIds });
      setSelectedNodeIds([]);
    }
    if (selectedConnectionId) {
      onAction({ type: 'canvasDeleteConnection', projectId: project.id, connectionId: selectedConnectionId });
      setSelectedConnectionId(null);
    }
    if (selectedStrokeId) {
      onAction({ type: 'canvasDeleteStroke', projectId: project.id, strokeId: selectedStrokeId });
      setSelectedStrokeId(null);
    }
  };

  const duplicateSelection = () => {
    if (!selectedNode) return;
    const duplicate = createCanvasNode(selectedNode.type, { x: selectedNode.x + 32, y: selectedNode.y + 32 }, {
      width: selectedNode.width,
      height: selectedNode.height,
      rotation: selectedNode.rotation,
      zIndex: maxZIndex + 1,
      color: selectedNode.color,
      content: selectedNode.content,
      taskId: selectedNode.taskId,
      attachmentId: selectedNode.attachmentId,
      shape: selectedNode.shape,
      diagramKind: selectedNode.diagramKind,
    });
    addNode(duplicate, duplicate.type === 'note');
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = Boolean(target?.closest('input, textarea, select, [contenteditable="true"]'));
      if (event.code === 'Space' && !editing) {
        event.preventDefault();
        setSpaceHeld(true);
      }
      if (editing) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelection();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && selectedNodeIds.length === 1) {
        event.preventDefault();
        duplicateSelection();
      } else if (event.key === 'Escape') {
        setConnectorSourceId(null);
        setConnectorTargetId(null);
        gestureRef.current = null;
        setPlacingShape(null);
        setPlacingDiagram(null);
        setLibraryPanel(null);
        setTool('select');
      } else if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        const key = event.key.toLowerCase();
        if (key === 'v') selectTool('select');
        else if (key === 'p') selectTool('pen');
        else if (key === 'n') addNote();
        else if (key === 't') setLibraryPanel('tasks');
        else if (key === 'f') setLibraryPanel('files');
        else if (key === '0') fitCanvas();
        else if (key === '+' || key === '=') zoomAt(viewportRef.current.zoom * 1.15);
        else if (key === '-') zoomAt(viewportRef.current.zoom / 1.15);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceHeld(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  });

  const renderedNodes = Object.fromEntries(nodes.map((node) => {
    const position = nodePreview[node.id];
    const size = resizePreview?.nodeId === node.id ? resizePreview : null;
    return [node.id, { ...node, ...(position ?? {}), ...(size ? { width: size.width, height: size.height } : {}) }];
  }));

  const selectedCount = selectedNodeIds.length + Number(Boolean(selectedConnectionId)) + Number(Boolean(selectedStrokeId));

  return (
    <main className="workspace-main canvas-view page-enter">
      <header className="board-topbar canvas-topbar">
        <div className="breadcrumbs"><span>{t('Workspace')}</span><b>/</b><span>{project.name}</span><b>/</b><strong>{t('Canvas')}</strong></div>
        <div className="canvas-topbar-center"><Sparkles size={15} /><span>{t('A space to think, connect, and create')}</span></div>
        <div className="topbar-actions">
          <PreferencesControls />
          <button className={`button save-button ${dirty ? 'save-dirty' : ''}`} disabled={saveState === 'saving' || (!dirty && saveState === 'synced')} onClick={onSave}>
            {saveState === 'saving' ? <><span className="spinner spinner-dark" /> {t('Saving')}</> : saveState === 'synced' && !dirty ? <><Check size={16} /> {t('Saved')}</> : t('Save now')}
          </button>
        </div>
      </header>

      <div
        ref={stageRef}
        className={`canvas-stage tool-${tool} ${spaceHeld ? 'pan-ready' : ''} ${gestureRef.current?.type === 'pan' ? 'is-panning' : ''} ${selectionBox ? 'is-selecting' : ''}`}
        style={{
          '--canvas-grid-x': `${viewport.x}px`,
          '--canvas-grid-y': `${viewport.y}px`,
          '--canvas-grid-size': `${GRID_SIZE * viewport.zoom}px`,
        } as CSSProperties}
        tabIndex={0}
        onPointerDown={handleStagePointerDown}
        onPointerMove={handleStagePointerMove}
        onPointerUp={finishGesture}
        onPointerCancel={finishGesture}
      >
        <div className="canvas-ambient canvas-ambient-one" />
        <div className="canvas-ambient canvas-ambient-two" />

        <div className="canvas-project-chip">
          <i style={{ background: project.color }} />
          <div><strong>{project.name}</strong><span>{t(nodes.length === 1 ? '{{count}} object' : '{{count}} objects', { count: nodes.length })}</span></div>
        </div>

        <div className="canvas-toolbar" onPointerDown={(event) => event.stopPropagation()}>
          <CanvasToolButton active={tool === 'select'} label={t('Move & select')} shortcut="V" onClick={() => selectTool('select')}><MousePointer2 size={20} /></CanvasToolButton>
          <span className="canvas-toolbar-separator" />
          <CanvasToolButton label={t('Add note')} shortcut="N" onClick={addNote}><StickyNote size={20} /></CanvasToolButton>
          <CanvasToolButton active={libraryPanel === 'tasks'} label={t('Add task')} shortcut="T" library onClick={() => setLibraryPanel((current) => current === 'tasks' ? null : 'tasks')}><ListTodo size={20} /></CanvasToolButton>
          <CanvasToolButton active={libraryPanel === 'files'} label={t('Add file')} shortcut="F" library onClick={() => setLibraryPanel((current) => current === 'files' ? null : 'files')}><Paperclip size={20} /></CanvasToolButton>
          <CanvasToolButton active={libraryPanel === 'shapes' || Boolean(placingShape)} label={t('Add shape')} library onClick={() => setLibraryPanel((current) => current === 'shapes' ? null : 'shapes')}><Shapes size={20} /></CanvasToolButton>
          <CanvasToolButton active={libraryPanel === 'diagrams' || Boolean(placingDiagram)} label={t('Technical diagrams')} library onClick={() => setLibraryPanel((current) => current === 'diagrams' ? null : 'diagrams')}><Workflow size={20} /></CanvasToolButton>
          <span className="canvas-toolbar-separator" />
          <CanvasToolButton active={tool === 'pen'} label={t('Draw')} shortcut="P" onClick={() => selectTool('pen')}><Pencil size={20} /></CanvasToolButton>
        </div>

        {libraryPanel === 'tasks' && (
          <div className="canvas-library-panel task-library scale-in" onPointerDown={(event) => event.stopPropagation()}>
            <header><div><span><ListTodo size={18} /></span><div><strong>{t('Tasks')}</strong><small>{t('Bring project work into your thinking space')}</small></div></div><button onClick={() => setLibraryPanel(null)} aria-label={t('Close')}><X size={17} /></button></header>
            <button className="canvas-library-primary" onClick={() => { onCreateTask(centerWorld(300, 174)); setLibraryPanel(null); }}><Plus size={17} /><span><strong>{t('Create a new task')}</strong><small>{t('It will stay in sync with your board')}</small></span></button>
            {projectTasks.length > 4 && <label className="canvas-library-search"><Search size={15} /><input value={taskSearch} onChange={(event) => setTaskSearch(event.target.value)} placeholder={t('Search tasks')} /></label>}
            <div className="canvas-library-list">
              {searchedTasks.map((item) => {
                const column = document.modules.kanban.projects[project.id]?.columns.find((candidate) => candidate.id === item.moduleData.kanban.columnId);
                const alreadyPlaced = taskNodes.has(item.id);
                return <button key={item.id} onClick={() => addTaskNode(item)}><i style={{ background: column?.color ?? project.color }} /><span><strong>{item.title}</strong><small>{column ? t(column.title) : t('Task')}</small></span>{alreadyPlaced && <em><Check size={12} /> {t('On canvas')}</em>}</button>;
              })}
              {searchedTasks.length === 0 && <p>{t('No matching tasks')}</p>}
            </div>
          </div>
        )}

        {libraryPanel === 'files' && (
          <div className="canvas-library-panel file-library scale-in" onPointerDown={(event) => event.stopPropagation()}>
            <header><div><span><Paperclip size={18} /></span><div><strong>{t('Files')}</strong><small>{t('Keep references close to the ideas they support')}</small></div></div><button onClick={() => setLibraryPanel(null)} aria-label={t('Close')}><X size={17} /></button></header>
            <div className="canvas-import-actions">
              <button onClick={() => { onAddFiles(centerWorld(276, 138), 'files'); setLibraryPanel(null); }}><File size={17} /><span><strong>{t('Import files')}</strong><small>{t('Choose from this device')}</small></span></button>
              <button onClick={() => { onAddFiles(centerWorld(276, 138), 'folders'); setLibraryPanel(null); }}><Folder size={17} /><span><strong>{t('Import folder')}</strong><small>{t('Keep a folder together')}</small></span></button>
              {!mobile && <button onClick={() => { onAddFiles(centerWorld(276, 138), 'references'); setLibraryPanel(null); }}><HardDrive size={17} /><span><strong>{t('Add local file reference')}</strong><small>{t('Keep the path, not the file')}</small></span></button>}
            </div>
            {attachments.length > 0 && <p className="canvas-library-label">{t('Already in this workspace')}</p>}
            <div className="canvas-library-list">
              {attachments.map((attachment) => {
                const alreadyPlaced = fileNodes.has(attachment.id);
                return <button key={attachment.id} onClick={() => addFileNode(attachment)}>{attachment.kind === 'folder' ? <Folder size={17} /> : attachment.kind === 'reference' ? <HardDrive size={17} /> : <File size={17} />}<span><strong><bdi>{attachment.name}</bdi></strong><small>{attachment.kind === 'reference' ? t('Not backed up') : formatFileSize(attachment.sizeBytes, locale)}</small></span>{alreadyPlaced && <em><Check size={12} /> {t('On canvas')}</em>}</button>;
              })}
            </div>
          </div>
        )}

        {libraryPanel === 'shapes' && (
          <div className="canvas-shape-panel scale-in" onPointerDown={(event) => event.stopPropagation()}>
            <p>{t('Choose a shape, then place it anywhere')}</p>
            <button onClick={() => { setPlacingShape('rectangle'); setLibraryPanel(null); }}><Square size={22} /><span>{t('Rectangle')}</span></button>
            <button onClick={() => { setPlacingShape('ellipse'); setLibraryPanel(null); }}><Circle size={22} /><span>{t('Ellipse')}</span></button>
            <button onClick={() => { setPlacingShape('diamond'); setLibraryPanel(null); }}><Diamond size={22} /><span>{t('Diamond')}</span></button>
          </div>
        )}

        {libraryPanel === 'diagrams' && (
          <div className="canvas-library-panel canvas-diagram-panel scale-in" onPointerDown={(event) => event.stopPropagation()}>
            <header><div><span><Workflow size={19} /></span><div><strong>{t('Technical diagrams')}</strong><small>{t('Plan systems with UML and architecture notation')}</small></div></div><button onClick={() => setLibraryPanel(null)} aria-label={t('Close')}><X size={17} /></button></header>
            <label className="canvas-library-search"><Search size={15} /><input value={diagramSearch} onChange={(event) => setDiagramSearch(event.target.value)} placeholder={t('Search diagram elements')} /></label>
            <section className="diagram-relationship-picker">
              <header><span>{t('Default relationship')}</span><small>{t('Drag from any object dot')}</small></header>
              <div>{RELATIONSHIPS.map((item) => <button key={item.relation} className={activeRelation === item.relation ? 'active' : ''} onClick={() => setActiveRelation(item.relation)}><i className={`relation-preview relation-${item.relation}`} />{t(item.label)}</button>)}</div>
            </section>
            <div className="diagram-element-scroll">
              {DIAGRAM_CATEGORIES.map((category) => {
                const categoryItems = visibleDiagramElements.filter((definition) => definition.category === category);
                if (categoryItems.length === 0) return null;
                return <section className="diagram-element-category" key={category}><h3>{t(category)}</h3><div>{categoryItems.map((definition) => <button key={definition.kind} onClick={() => { setPlacingDiagram(definition.kind); setPlacingShape(null); setLibraryPanel(null); }}><span className={`diagram-library-symbol diagram-${definition.kind}`}><DiagramIcon kind={definition.kind} size={19} /></span><em>{t(definition.label)}</em></button>)}</div></section>;
              })}
              {visibleDiagramElements.length === 0 && <p className="diagram-library-empty">{t('No matching diagram elements')}</p>}
            </div>
          </div>
        )}

        {connectorSourceId && (
          <div className="canvas-mode-hint slide-up"><GitBranch size={16} /><span>{t(connectorTargetId ? 'Release to connect the objects' : 'Drag the line onto another object')}</span><kbd>Esc</kbd></div>
        )}
        {placingShape && <div className="canvas-mode-hint slide-up"><Shapes size={16} /><span>{t('Click anywhere to place the shape')}</span><kbd>Esc</kbd></div>}
        {placingDiagram && <div className="canvas-mode-hint slide-up"><Workflow size={16} /><span>{t('Click anywhere to place the diagram element')}</span><kbd>Esc</kbd></div>}

        <div
          className="canvas-world"
          style={{ transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.zoom})` }}
        >
          <svg className="canvas-connections" aria-label={t('Object connections')}>
            <defs>
              <marker id="canvas-arrow-open" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto"><path d="M 1 1 L 10 6 L 1 11" /></marker>
              <marker id="canvas-arrow-filled" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto"><path d="M 1 1 L 11 6 L 1 11 z" /></marker>
              <marker id="canvas-triangle" viewBox="0 0 14 14" refX="12" refY="7" markerWidth="10" markerHeight="10" orient="auto"><path d="M 1 1 L 13 7 L 1 13 z" /></marker>
              <marker id="canvas-diamond-open" viewBox="0 0 16 12" refX="2" refY="6" markerWidth="11" markerHeight="9" orient="auto"><path d="M 1 6 L 7 1 L 13 6 L 7 11 z" /></marker>
              <marker id="canvas-diamond-filled" viewBox="0 0 16 12" refX="2" refY="6" markerWidth="11" markerHeight="9" orient="auto"><path d="M 1 6 L 7 1 L 13 6 L 7 11 z" /></marker>
            </defs>
            {Object.values(canvasProject.connections).map((connection) => {
              const from = renderedNodes[connection.fromNodeId];
              const to = renderedNodes[connection.toNodeId];
              if (!from || !to) return null;
              const path = connectionPath(from, nodeCenter(to), to);
              const anchors = connectionAnchors(from, nodeCenter(to), to);
              const relation = connection.relation ?? 'association';
              const markers = relationMarkers(relation);
              return (
                <g key={connection.id} className={`canvas-connection relation-${relation} ${selectedConnectionId === connection.id ? 'selected' : ''}`}>
                  <path className="canvas-connection-hit" d={path} onPointerDown={(event) => { event.stopPropagation(); setSelectedConnectionId(connection.id); setSelectedNodeIds([]); setSelectedStrokeId(null); }} />
                  <path className="canvas-connection-line" d={path} style={{ stroke: connection.color }} {...markers} />
                  {connection.label && <text className="canvas-connection-label" x={(anchors.start.x + anchors.end.x) / 2} y={(anchors.start.y + anchors.end.y) / 2 - 9}>{connection.label}</text>}
                  {connection.sourceLabel && <text className="canvas-connection-multiplicity" x={anchors.start.x} y={anchors.start.y - 9}>{connection.sourceLabel}</text>}
                  {connection.targetLabel && <text className="canvas-connection-multiplicity" x={anchors.end.x} y={anchors.end.y - 9}>{connection.targetLabel}</text>}
                </g>
              );
            })}
            {connectorSourceId && renderedNodes[connectorSourceId] && <path className={`canvas-connection-preview relation-${activeRelation}`} {...relationMarkers(activeRelation)} d={connectorTargetId && renderedNodes[connectorTargetId]
              ? connectionPath(renderedNodes[connectorSourceId], nodeCenter(renderedNodes[connectorTargetId]), renderedNodes[connectorTargetId])
              : connectionPath(renderedNodes[connectorSourceId], pointerWorld)} />}
          </svg>

          {selectionBox && <div className="canvas-selection-box" style={{ left: Math.min(selectionBox.start.x, selectionBox.current.x), top: Math.min(selectionBox.start.y, selectionBox.current.y), width: Math.abs(selectionBox.current.x - selectionBox.start.x), height: Math.abs(selectionBox.current.y - selectionBox.start.y) }} />}

          <svg className="canvas-drawings" aria-label={t('Canvas drawings')}>
            {Object.values(canvasProject.strokes).map((stroke) => (
              <g key={stroke.id} className={`canvas-stroke ${selectedStrokeId === stroke.id ? 'selected' : ''}`}>
                <path className="canvas-stroke-hit" d={strokePath(stroke.points)} onPointerDown={(event) => { if (tool !== 'select') return; event.stopPropagation(); setSelectedStrokeId(stroke.id); setSelectedNodeIds([]); setSelectedConnectionId(null); }} />
                <path d={strokePath(stroke.points)} style={{ stroke: stroke.color, strokeWidth: stroke.width }} />
              </g>
            ))}
            {liveStroke && <path className="canvas-live-stroke" d={strokePath(liveStroke.points)} style={{ stroke: liveStroke.color, strokeWidth: liveStroke.width }} />}
          </svg>

          {nodes.map((storedNode) => {
            const node = renderedNodes[storedNode.id];
            const selected = selectedNodeIds.includes(node.id);
            const item = node.taskId ? document.items[node.taskId] : undefined;
            const attachment = node.attachmentId ? document.resources.attachments[node.attachmentId] : undefined;
            const column = item ? document.modules.kanban.projects[item.projectId]?.columns.find((candidate) => candidate.id === item.moduleData.kanban.columnId) : undefined;
            const completedSubtasks = item?.subtasks.filter((subtask) => subtask.completed).length ?? 0;
            const progress = item?.subtasks.length ? Math.round((completedSubtasks / item.subtasks.length) * 100) : 0;
            return (
              <article
                key={node.id}
                className={`canvas-node canvas-node-${node.type} canvas-${node.type} ${node.shape ? `shape-${node.shape}` : ''} ${node.diagramKind ? `diagram-${node.diagramKind}` : ''} ${selected ? 'selected' : ''} ${connectorSourceId === node.id ? 'connector-source' : ''} ${connectorTargetId === node.id ? 'connector-target' : ''} ${nodePreview[node.id] ? 'dragging' : ''}`}
                style={{
                  left: node.x,
                  top: node.y,
                  width: node.width,
                  height: node.height,
                  zIndex: node.zIndex,
                  transform: `rotate(${node.rotation}deg)`,
                  '--node-color': node.color,
                } as CSSProperties}
                aria-label={t('{{type}} object', { type: t(node.type === 'note' ? 'Note' : node.type === 'task' ? 'Task' : node.type === 'file' ? 'File' : node.type === 'diagram' ? 'Diagram element' : 'Shape') })}
                onPointerDown={(event) => beginNodeGesture(event, node)}
                onDoubleClick={() => {
                  if (item) onOpenTask(item);
                  if (attachment) onPreviewAttachment(attachment);
                }}
              >
                <div className="canvas-node-drag-zone" aria-hidden="true"><GripVertical size={15} /></div>
                {selected && (
                  <div className="canvas-node-actions canvas-node-interactive" onPointerDown={(event) => event.stopPropagation()}>
                    <button onClick={duplicateSelection} aria-label={t('Duplicate')} title={t('Duplicate')}><Copy size={15} /></button>
                    <button className="danger" onClick={deleteSelection} aria-label={t('Remove from canvas')} title={t('Remove from canvas')}><Trash2 size={15} /></button>
                  </div>
                )}

                {node.type === 'note' && (
                  <div className="canvas-note-content">
                    <span className="canvas-note-tape" />
                    <EditableNote node={node} focus={freshNodeId === node.id} onChange={(content) => onAction({ type: 'canvasUpdateNode', projectId: project.id, nodeId: node.id, changes: { content } })} />
                    <small>{t('NOTE')}</small>
                  </div>
                )}

                {node.type === 'task' && item && (
                  <div className="canvas-task-content">
                    <header><span style={{ color: column?.color ?? project.color, background: `${column?.color ?? project.color}1a` }}><CheckCircle2 size={15} /> {column ? t(column.title) : t('Task')}</span><i style={{ background: PRIORITY_META[item.priority].color }} title={t('{{priority}} priority', { priority: t(PRIORITY_META[item.priority].label) })} /></header>
                    <h3>{item.title}</h3>
                    {item.description && <p>{item.description}</p>}
                    <footer>
                      {item.subtasks.length > 0 ? <span><b><i style={{ width: `${progress}%` }} /></b>{completedSubtasks}/{item.subtasks.length}</span> : <span className="canvas-task-project"><i style={{ background: project.color }} />{project.name}</span>}
                      {item.dueDate && <time><CalendarDays size={14} />{new Date(`${item.dueDate}T12:00:00`).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}</time>}
                      <button className="canvas-node-interactive" onClick={() => onOpenTask(item)}>{t('Open')}</button>
                    </footer>
                  </div>
                )}

                {node.type === 'file' && attachment && (
                  <div className="canvas-file-content">
                    <span className={`canvas-file-icon ${attachment.kind}`}>{attachment.kind === 'folder' ? <Folder size={26} /> : attachment.kind === 'reference' ? <HardDrive size={26} /> : <File size={26} />}</span>
                    <div><small>{t(attachment.kind === 'folder' ? 'Folder' : attachment.kind === 'reference' ? 'Local file reference' : 'File')}</small><h3><bdi>{attachment.name}</bdi></h3><p>{attachment.kind === 'reference' ? t('Not backed up') : formatFileSize(attachment.sizeBytes, locale)}{attachment.kind === 'folder' ? ` · ${t('{{count}} files', { count: attachment.fileCount })}` : ''}</p></div>
                    <button className="canvas-node-interactive" onClick={() => onOpenAttachment(attachment)} aria-label={t('Open {{name}}', { name: attachment.name })}><ExternalLink size={16} /></button>
                  </div>
                )}

                {node.type === 'shape' && (
                  <div className="canvas-shape-content">
                    <div className="canvas-shape-surface" />
                    <EditableShape node={node} onChange={(content) => onAction({ type: 'canvasUpdateNode', projectId: project.id, nodeId: node.id, changes: { content } })} />
                  </div>
                )}

                {node.type === 'diagram' && (
                  <EditableDiagram node={node} focus={freshNodeId === node.id} onChange={(content) => onAction({ type: 'canvasUpdateNode', projectId: project.id, nodeId: node.id, changes: { content } })} />
                )}

                {selected && <>
                  <button className="canvas-port port-top canvas-node-interactive" aria-label={t('Drag to connect this object')} title={t('Drag to connect')} onPointerDown={(event) => beginConnection(event, node)} />
                  <button className="canvas-port port-end canvas-node-interactive" aria-label={t('Drag to connect this object')} title={t('Drag to connect')} onPointerDown={(event) => beginConnection(event, node)} />
                  <button className="canvas-port port-bottom canvas-node-interactive" aria-label={t('Drag to connect this object')} title={t('Drag to connect')} onPointerDown={(event) => beginConnection(event, node)} />
                  <button className="canvas-port port-start canvas-node-interactive" aria-label={t('Drag to connect this object')} title={t('Drag to connect')} onPointerDown={(event) => beginConnection(event, node)} />
                  <button className="canvas-resize-handle canvas-node-interactive" aria-label={t('Resize object')} onPointerDown={(event) => beginResize(event, node)} />
                </>}
              </article>
            );
          })}
        </div>

        {isEmpty && (
          <section className="canvas-empty-state" onPointerDown={(event) => event.stopPropagation()}>
            <div className="canvas-empty-orbit"><span><Sparkles size={28} /></span><i /><i /></div>
            <p>{t('YOUR PROJECT THINKING SPACE')}</p>
            <h1>{t('Start with a spark.')}</h1>
            <h2>{t('Capture an idea, map a plan, or simply explore. This space grows with your thinking.')}</h2>
            <div>
              <button onClick={addNote}><StickyNote size={19} /><span><strong>{t('Write a note')}</strong><small>{t('Capture a thought')}</small></span></button>
              <button onClick={() => setLibraryPanel('tasks')}><ListTodo size={19} /><span><strong>{t('Place a task')}</strong><small>{t('Make it actionable')}</small></span></button>
              <button onClick={() => setLibraryPanel('files')}><Paperclip size={19} /><span><strong>{t('Add a reference')}</strong><small>{t('Keep context close')}</small></span></button>
            </div>
            <small className="canvas-empty-tip"><MousePointer2 size={14} /> {t('Drag empty space to move · Ctrl + scroll to zoom')}</small>
          </section>
        )}

        {selectedNode && (
          <div className="canvas-style-bar slide-up" onPointerDown={(event) => event.stopPropagation()}>
            <span>{t('Color')}</span>
            {CANVAS_NODE_COLORS.map((color) => <button key={color} className={selectedNode.color === color ? 'active' : ''} style={{ background: color }} aria-label={t('Use color {{color}}', { color })} onClick={() => onAction({ type: 'canvasUpdateNode', projectId: project.id, nodeId: selectedNode.id, changes: { color } })} />)}
            <i />
            <button className="canvas-style-action" onClick={duplicateSelection}><Copy size={15} /> {t('Duplicate')}</button>
            <button className="canvas-style-action danger" onClick={deleteSelection}><Trash2 size={15} /> {t('Remove')}</button>
          </div>
        )}
        {selectedConnection && <ConnectionInspector
          connection={selectedConnection}
          onUpdate={(changes) => onAction({ type: 'canvasUpdateConnection', projectId: project.id, connectionId: selectedConnection.id, changes })}
          onDelete={deleteSelection}
        />}
        {!selectedNode && !selectedConnection && selectedCount > 0 && <div className="canvas-style-bar canvas-delete-bar slide-up" onPointerDown={(event) => event.stopPropagation()}><span>{t('{{count}} selected', { count: selectedCount })}</span><button className="canvas-style-action danger" onClick={deleteSelection}><Trash2 size={15} /> {t('Remove')}</button></div>}

        <div className="canvas-zoom-controls" onPointerDown={(event) => event.stopPropagation()}>
          <button onClick={() => zoomAt(viewport.zoom / 1.15)} aria-label={t('Zoom out')} title={t('Zoom out')}><ZoomOut size={18} /></button>
          <button className="canvas-zoom-value" onClick={() => zoomAt(1)} title={t('Reset zoom')}>{Math.round(viewport.zoom * 100)}%</button>
          <button onClick={() => zoomAt(viewport.zoom * 1.15)} aria-label={t('Zoom in')} title={t('Zoom in')}><ZoomIn size={18} /></button>
          <i />
          <button onClick={fitCanvas} aria-label={t('Fit to content')} title={t('Fit to content')}><Maximize2 size={17} /></button>
        </div>

        {!isEmpty && <MiniMap canvasProject={canvasProject} viewport={viewport} stageSize={stageSize} label={t('Navigate canvas overview')} onNavigate={(point) => setViewport((current) => ({ ...current, x: stageSize.width / 2 - point.x * current.zoom, y: stageSize.height / 2 - point.y * current.zoom }))} />}
        <div className="canvas-navigation-tip"><MousePointer2 size={13} /><span>{t('Drag empty space to move · Shift + drag to select')}</span></div>
      </div>
    </main>
  );
}
