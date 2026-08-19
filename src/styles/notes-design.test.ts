import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync('src/styles/global.css', 'utf8');

function ruleFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = styles.match(new RegExp(`${escaped} \\{([^}]+)\\}`));
  expect(match, `${selector} should have a style rule`).not.toBeNull();
  return match![1];
}

describe('notes card motion', () => {
  it('releases the entrance animation so desktop hover can lift and gently rotate cards', () => {
    const card = ruleFor('.keep-note-card');
    const hover = ruleFor('.keep-note-card:hover');

    expect(card).toContain('animation: keepCardEnter');
    expect(card).toContain('backwards');
    expect(card).toContain('--note-hover-tilt: -.7deg');
    expect(hover).toContain('rotate(var(--note-hover-tilt))');
    expect(hover).toContain('scale(1.008)');
  });

  it('mirrors the rotation in RTL and removes nonessential motion when requested', () => {
    expect(ruleFor("[dir='rtl'] .keep-note-card")).toContain('--note-hover-tilt: .7deg');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('.keep-note-card, .keep-editor-backdrop, .keep-note-dialog { animation: none; }');
  });

  it('forces the editor checkbox to the physical right edge in RTL notes', () => {
    const rtlTasks = ruleFor(".keep-wysiwyg-content[dir='rtl'] ul[data-type='taskList'] li");
    const rtlCopy = ruleFor(".keep-wysiwyg-content[dir='rtl'] ul[data-type='taskList'] li > div");
    expect(rtlTasks).toContain('direction: ltr !important');
    expect(rtlTasks).toContain('flex-direction: row-reverse !important');
    expect(rtlCopy).toContain('direction: rtl');
    expect(rtlCopy).toContain('text-align: right');
  });
});
