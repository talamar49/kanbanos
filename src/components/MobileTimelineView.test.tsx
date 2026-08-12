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

describe('mobile timeline', () => {
  it('keeps the full timeline available on phones and routes task interactions', async () => {
    const user = userEvent.setup();
    const workspace = createEmptyWorkspace('Phone plan');
    const project = workspace.projects[0];
    const today = dateKey(new Date());
    const scheduled = createWorkItem(project.id, 'planned', 'Ship mobile QA', 1000, { startDate: today, dueDate: today });
    const unscheduled = createWorkItem(project.id, 'planned', 'Gather feedback', 2000);
    workspace.items = { [scheduled.id]: scheduled, [unscheduled.id]: unscheduled };
    const onCreateTask = vi.fn();
    const onOpenTask = vi.fn();
    const onAction = vi.fn();

    renderWithPreferences(
      <MobileTimelineView
        document={workspace}
        project={project}
        saveState="synced"
        dirty={false}
        onCreateTask={onCreateTask}
        onOpenTask={onOpenTask}
        onAction={onAction}
        onSave={vi.fn()}
        onEditProject={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Timeline' })).toBeInTheDocument();
    expect(document.querySelector('.mobile-timeline-view .timeline-chart')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Week' })).toBeInTheDocument();
    const chartScroll = document.querySelector<HTMLElement>('.mobile-timeline-view .timeline-chart-scroll')!;
    chartScroll.scrollLeft = 120;
    await user.click(screen.getByRole('button', { name: 'Month' }));
    expect(screen.getByRole('button', { name: 'Month' })).toHaveClass('active');
    expect(chartScroll.scrollLeft).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Year' }));
    expect(document.querySelector('.timeline-year-board')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Week' }));

    await user.click(screen.getByText('Ship mobile QA'));
    expect(onOpenTask).toHaveBeenCalledWith(scheduled);
    await user.click(screen.getByRole('button', { name: 'Compact lanes' }));
    expect(onAction).toHaveBeenCalledWith({ type: 'setTimelineLayout', layout: 'compact' });

    const unscheduledSection = screen.getByText('Unscheduled work').closest('section')!;
    await user.click(within(unscheduledSection).getByText('Gather feedback'));
    expect(onOpenTask).toHaveBeenCalledWith(unscheduled);
  });

  it('keeps empty-range guidance inside the contained timeline chart', () => {
    const workspace = createEmptyWorkspace('Empty phone plan');
    const project = workspace.projects[0];
    renderWithPreferences(
      <MobileTimelineView
        document={workspace}
        project={project}
        saveState="synced"
        dirty={false}
        onCreateTask={vi.fn()}
        onOpenTask={vi.fn()}
        onAction={vi.fn()}
        onSave={vi.fn()}
        onEditProject={vi.fn()}
      />,
    );

    const chartScroll = document.querySelector('.mobile-timeline-view .timeline-chart-scroll')!;
    expect(chartScroll).toContainElement(document.querySelector('.timeline-empty'));
    expect(screen.getByRole('button', { name: 'Schedule a task' })).toBeInTheDocument();
  });
});
