import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HEBREW_TRANSLATIONS, PreferencesProvider, useI18n } from './i18n';
import { PreferencesControls } from './components/PreferencesControls';

function BidiInputProbe() {
  return (
    <div>
      <input aria-label="Mixed title" defaultValue="משימה release" />
      <textarea aria-label="Mixed description" defaultValue="תיאור English" />
      <input aria-label="Repository URL" type="url" defaultValue="https://example.com" />
      <input aria-label="Explicit technical value" dir="ltr" defaultValue="main/ענף" />
    </div>
  );
}

function PreferenceProbe() {
  const { direction, language, locale, setLanguage, setTheme, t, theme, toggleTheme } = useI18n();
  return (
    <div>
      <output>{`${language}|${locale}|${direction}|${theme}`}</output>
      <p>{t('Edited {{date}}', { date: 'today' })}</p>
      <p>{t("Error invoking remote method 'workspace:save': Error: Saved to the local Git repository.")}</p>
      <button onClick={() => setLanguage('he')}>set-he</button>
      <button onClick={() => setTheme('dark')}>set-dark</button>
      <button onClick={toggleTheme}>toggle-theme</button>
    </div>
  );
}

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'test' ? [] : sourceFiles(target);
    return /\.[jt]sx?$/.test(entry.name) && !/\.test\.[jt]sx?$/.test(entry.name) ? [target] : [];
  });
}

function literalTranslationKeys(filePath: string): string[] {
  const source = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const keys: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 't'
      && node.arguments.length > 0
      && (ts.isStringLiteral(node.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))) {
      keys.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return keys;
}

describe('internationalization and themes', () => {
  it('starts in English/light mode and persists document display attributes', async () => {
    render(<PreferencesProvider><PreferenceProbe /></PreferencesProvider>);

    expect(screen.getByText('en|en-US|ltr|light')).toBeInTheDocument();
    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('lang', 'en');
      expect(document.documentElement).toHaveAttribute('dir', 'ltr');
      expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    });
    expect(localStorage.getItem('kanbanos.language')).toBe('en');
    expect(localStorage.getItem('kanbanos.theme')).toBe('light');
  });

  it('restores Hebrew/dark preferences, translates variables, and normalizes IPC errors', async () => {
    const setTheme = vi.fn();
    localStorage.setItem('kanbanos.language', 'he');
    localStorage.setItem('kanbanos.theme', 'dark');
    window.kanbanos = { appearance: { setTheme } } as unknown as Window['kanbanos'];

    render(<PreferencesProvider><PreferenceProbe /></PreferencesProvider>);

    expect(screen.getByText('he|he-IL|rtl|dark')).toBeInTheDocument();
    expect(screen.getByText('נערך ב־today')).toBeInTheDocument();
    expect(screen.getByText('נשמר במאגר Git המקומי.')).toBeInTheDocument();
    await waitFor(() => expect(setTheme).toHaveBeenCalledWith('dark'));
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('automatically follows the first strong character in every text input', () => {
    render(<PreferencesProvider><BidiInputProbe /></PreferencesProvider>);

    expect(screen.getByRole('textbox', { name: 'Mixed title' })).toHaveAttribute('dir', 'auto');
    expect(screen.getByRole('textbox', { name: 'Mixed description' })).toHaveAttribute('dir', 'auto');
    expect(screen.getByRole('textbox', { name: 'Repository URL' })).not.toHaveAttribute('dir');
    expect(screen.getByRole('textbox', { name: 'Explicit technical value' })).toHaveAttribute('dir', 'ltr');
  });

  it('switches language and theme from the shared preference controls', async () => {
    render(<PreferencesProvider><PreferencesControls expanded /></PreferencesProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Hebrew' }));
    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('lang', 'he');
      expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    });
    expect(screen.getByRole('button', { name: 'עברית' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'מעבר לערכת נושא כהה' }));
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'dark'));
    expect(localStorage.getItem('kanbanos.theme')).toBe('dark');
  });

  it('keeps every literal UI translation key covered in Hebrew', () => {
    const root = path.resolve(process.cwd(), 'src');
    const keys = new Set(sourceFiles(root).flatMap(literalTranslationKeys));
    const missing = [...keys].filter((key) => HEBREW_TRANSLATIONS[key] === undefined).sort();

    expect(missing, `Missing Hebrew translations:\n${missing.join('\n')}`).toEqual([]);
  });
});
