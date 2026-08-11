import { describe, expect, it } from 'vitest';
import {
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
    expect(workspace.modules.kanban.projects[workspace.projects[0].id].columns).toHaveLength(4);
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

    const removed = workspaceReducer(attached, { type: 'removeAttachment', attachmentId: attachment.id });
    expect(removed.items[task.id].attachmentIds).toEqual([]);
    expect(removed.resources.attachments[attachment.id]).toBeUndefined();
  });

  it('normalizes workspaces created before attachment storage existed', () => {
    const workspace = createEmptyWorkspace();
    const legacy = { ...workspace, resources: undefined } as unknown as typeof workspace;
    const normalized = normalizeWorkspaceDocument(legacy);

    expect(normalized.resources.attachments).toEqual({});
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

  it('rejects malformed workspace documents', () => {
    expect(isWorkspaceDocument({ schemaVersion: 1 })).toBe(false);
    expect(isWorkspaceDocument(null)).toBe(false);
  });
});
