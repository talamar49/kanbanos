import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync('src/styles/global.css', 'utf8');

function declarationsFor(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declarations = Array.from(styles.matchAll(new RegExp(`${escapedSelector} \\{([^}]+)\\}`, 'g')), (match) => match[1]);
  expect(declarations.length, `${selector} should have a style rule`).toBeGreaterThan(0);
  return declarations;
}

describe('Kanban column color surfaces', () => {
  it('shades the full desktop column and its sticky header with the assigned column color', () => {
    expect(declarationsFor('.board-column').some((rule) => rule.includes(
      'background: color-mix(in srgb, var(--column-color), var(--canvas) 94%)',
    ))).toBe(true);
    expect(declarationsFor('.column-header').some((rule) => rule.includes(
      'background: color-mix(in srgb, var(--column-color), var(--canvas) 90%)',
    ))).toBe(true);
  });

  it('keeps the assigned shade across the full compact column in light and dark themes', () => {
    expect(declarationsFor('.compact-layout .board-column').some((rule) => rule.includes(
      'background: color-mix(in srgb, var(--column-color), var(--panel) 94%)',
    ))).toBe(true);
    expect(declarationsFor("[data-theme='dark'].compact-layout .board-column").some((rule) => rule.includes(
      'background: color-mix(in srgb, var(--column-color), #3e454f 90%)',
    ))).toBe(true);
  });
});
