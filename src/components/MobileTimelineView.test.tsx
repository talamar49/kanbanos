import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyWorkspace, createWorkItem } from '../domain/workspace';
import { renderWithPreferences } from '../test/render';
import { MobileTimelineView } from './MobileTimelineView';

function dateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

describe('mobile timeline agenda', () => {
  it('keeps a week of work reachable without a horizontal Gantt chart and creates tasks on the selected day', async () => {
    const user = userEvent.setup();
    const workspace = createEmptyWorkspace('Phone plan');
    const project = workspace.projects[0];
    const today = dateKey(new Date());
    const scheduled = createWorkItem(project.id, 'planned', 'Ship mobile QA', 1000, { startDate: today, dueDate: today });
    const unscheduled = createWorkItem(project.id, 'planned', 'Gather feedback', 2000);
    workspace.items = { [scheduled.id]: scheduled, [unscheduled.id]: unscheduled };
    const onCreateTask = vi.fn();
    const onOpenTask = vi.fn();

    renderWithPreferences(
      <MobileTimelineView
        document={workspace}
        project={project}
        saveState="synced"
        dirty={false}
        onCreateTask={onCreateTask}
        onOpenTask={onOpenTask}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: /Week of/ })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(7);
    expect(document.querySelector('.timeline-chart')).not.toBeInTheDocument();
    expect(document.querySelector('.mobile-week-picker')).toBeInTheDocument();

    await user.click(screen.getByText('Ship mobile QA'));
    expect(onOpenTask).toHaveBeenCalledWith(scheduled);
    await user.click(screen.getByRole('button', { name: 'New task' }));
    expect(onCreateTask).toHaveBeenCalledWith(expect.objectContaining({
      columnId: 'planned',
      startDate: today,
      dueDate: today,
    }));

    const unscheduledSection = screen.getByText('Unscheduled work').closest('section')!;
    await user.click(within(unscheduledSection).getByText('Gather feedback'));
    expect(onOpenTask).toHaveBeenCalledWith(unscheduled);
  });
});
