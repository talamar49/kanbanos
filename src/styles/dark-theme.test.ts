import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const DARK_PANEL = '#424852';
const DARK_OVERLAY = '#514c67';
const DARK_SECTION = '#383e48';
const DARK_INPUT = '#3d444e';

function luminance(color: string) {
  const channels = color.startsWith('#')
    ? color.match(/[\da-f]{2}/gi)?.map((channel) => Number.parseInt(channel, 16))
    : color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Unsupported color: ${color}`);
  const [red, green, blue] = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function contrastRatio(foreground: string, background: string) {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

describe('dark theme text contrast', () => {
  let style: HTMLStyleElement;
  let fixture: HTMLDivElement;

  beforeEach(() => {
    style = document.createElement('style');
    style.textContent = readFileSync('src/styles/global.css', 'utf8');
    document.head.append(style);
    document.documentElement.dataset.theme = 'dark';

    fixture = document.createElement('div');
    fixture.innerHTML = `
      <div class="search-box" style="background: ${DARK_PANEL}"><input aria-label="Search query" value="Visible search text" /></div>
      <div class="task-modal" style="background: ${DARK_PANEL}">
        <div class="modal-context">Task details</div>
        <div class="subtask-composer"><input aria-label="New subtask" value="Visible subtask text" /></div>
        <aside class="task-properties" style="background: ${DARK_SECTION}">
          <h3>Properties</h3>
          <div class="dependency-property"><small>Choose tasks that must finish first.</small></div>
        </aside>
        <footer class="modal-footer" style="background: ${DARK_SECTION}"><span class="autosave-state">Saved automatically</span></footer>
      </div>
      <div class="label-picker" style="background: ${DARK_PANEL}">
        <div class="label-picker-input" style="background: ${DARK_PANEL}"><input aria-label="Search labels" value="Release" /></div>
        <div class="label-picker-menu" style="background: ${DARK_PANEL}"><div class="label-picker-options"><button><strong>Release</strong></button></div></div>
      </div>
      <div class="quick-add" style="background: ${DARK_PANEL}">
        <textarea aria-label="New Kanban task" style="background: ${DARK_INPUT}">A multiline task</textarea>
        <span class="quick-add-label-heading">Labels</span>
        <div class="quick-add-actions"><button>Cancel</button><button class="quick-add-submit">Add task</button></div>
      </div>
      <div class="task-card" style="background: ${DARK_PANEL}"><div class="drag-overlay-hint">Drop to move</div></div>
      <div class="timeline-drag-overlay" style="background: ${DARK_OVERLAY}"><div><span>Drop to update the Kanban order</span></div></div>
      <div class="unscheduled-tasks" style="background: ${DARK_PANEL}">
        <header style="background: ${DARK_SECTION}"><small>3 tasks</small><button class="timeline-add-task-button">Add task</button></header>
        <p class="unscheduled-empty">No unscheduled tasks</p>
      </div>
      <div class="roadmap-card" style="background: ${DARK_PANEL}"><div class="roadmap-progress-label"><strong>75%</strong></div></div>
      <div class="roadmap-empty" style="background: ${DARK_PANEL}"><strong>Nothing planned here yet</strong></div>
      <div class="roadmap-drag-overlay" style="background: ${DARK_PANEL}"><div><strong>Initiative title</strong><small>Choose a planning horizon</small></div></div>
      <div class="roadmap-column" style="background: ${DARK_PANEL}"><header style="background: ${DARK_SECTION}"><em>Drop here</em><p>Work planned for now</p></header></div>
      <div class="roadmap-footnote" style="background: #405851">Roadmap dates stay in sync.</div>
      <div class="task-composer-note" style="background: #405851">You can edit every detail later.</div>
      <div class="attachment-preview-header" style="background: ${DARK_PANEL}"><div class="attachment-preview-heading"><small>Attachment preview</small></div></div>
      <div class="preview-state" style="background: #343943"><p>Preparing your preview.</p></div>
      <div class="text-preview" style="background: #343943"><p>Large file preview was shortened.</p></div>
      <div class="folder-preview" style="background: #343943"><header><small>3 items</small></header></div>
      <div class="folder-preview-list" style="background: ${DARK_PANEL}"><button><span></span><span><small>12 KB</small></span></button></div>
      <div class="markdown-preview" style="background: ${DARK_PANEL}"><blockquote>Quoted preview text</blockquote></div>
      <div class="presentation-slide" style="background: #484f5a"><small>Slide 1</small></div>
      <div class="version-card" style="background: ${DARK_SECTION}"><ul><li><b>Updated</b></li></ul></div>
    `;
    document.body.append(fixture);
  });

  afterEach(() => {
    fixture.remove();
    style.remove();
  });

  it.each(['ltr', 'rtl'] as const)('keeps editable, status, and drag text readable in %s layouts', (direction) => {
    document.documentElement.dir = direction;
    const checks = [
      ['search query', 'input[aria-label="Search query"]', DARK_PANEL],
      ['subtask composer', 'input[aria-label="New subtask"]', DARK_PANEL],
      ['task context', '.modal-context', DARK_PANEL],
      ['property heading', '.task-properties h3', DARK_SECTION],
      ['dependency help', '.dependency-property > small', DARK_SECTION],
      ['autosave status', '.autosave-state', DARK_SECTION],
      ['label search', '.label-picker-input input', DARK_PANEL],
      ['label option', '.label-picker-options strong', DARK_PANEL],
      ['Kanban task composer', '.quick-add > textarea', DARK_INPUT],
      ['Kanban composer label heading', '.quick-add-label-heading', DARK_PANEL],
      ['Kanban drag hint', '.drag-overlay-hint', DARK_PANEL],
      ['timeline drag hint', '.timeline-drag-overlay span', DARK_OVERLAY],
      ['unscheduled count', '.unscheduled-tasks > header small', DARK_SECTION],
      ['timeline add task', '.timeline-add-task-button', DARK_SECTION],
      ['unscheduled empty state', '.unscheduled-empty', DARK_PANEL],
      ['roadmap progress', '.roadmap-progress-label strong', DARK_PANEL],
      ['roadmap empty heading', '.roadmap-empty strong', DARK_PANEL],
      ['roadmap dragged title', '.roadmap-drag-overlay strong', DARK_PANEL],
      ['roadmap drag hint', '.roadmap-drag-overlay small', DARK_PANEL],
      ['roadmap drop hint', '.roadmap-column > header em', DARK_SECTION],
      ['roadmap column description', '.roadmap-column > header p', DARK_SECTION],
      ['roadmap footnote', '.roadmap-footnote', '#405851'],
      ['task composer note', '.task-composer-note', '#405851'],
      ['preview metadata', '.attachment-preview-heading small', DARK_PANEL],
      ['preview status', '.preview-state p', '#343943'],
      ['text preview note', '.text-preview > p', '#343943'],
      ['folder preview count', '.folder-preview > header small', '#343943'],
      ['folder item metadata', '.folder-preview-list > button small', DARK_PANEL],
      ['markdown quote', '.markdown-preview blockquote', DARK_PANEL],
      ['presentation metadata', '.presentation-slide > small', '#484f5a'],
      ['conflict detail label', '.version-card li b', DARK_SECTION],
    ] as const;

    checks.forEach(([label, selector, background]) => {
      const foreground = getComputedStyle(fixture.querySelector<HTMLElement>(selector)!).color;
      expect(contrastRatio(foreground, background), `${label} contrast`).toBeGreaterThanOrEqual(4.5);
    });
  });
});
