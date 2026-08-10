import { describe, expect, it } from 'vitest';
import {
  createEmptyWorkspace,
  createWorkItem,
  isWorkspaceDocument,
  itemsForColumn,
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
