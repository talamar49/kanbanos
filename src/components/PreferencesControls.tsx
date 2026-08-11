import { Moon, Sun } from 'lucide-react';
import { useI18n } from '../i18n';

type Props = {
  className?: string;
  expanded?: boolean;
};

export function PreferencesControls({ className = '', expanded = false }: Props) {
  const { language, setLanguage, theme, toggleTheme, t } = useI18n();

  return (
    <div className={`preferences-controls ${expanded ? 'preferences-expanded' : ''} ${className}`.trim()} aria-label={t('Display preferences')}>
      <div className="language-toggle" role="group" aria-label={`${t('English')} / ${t('Hebrew')}`}>
        <button className={language === 'en' ? 'active' : ''} aria-pressed={language === 'en'} aria-label={t('English')} onClick={() => setLanguage('en')}>{expanded ? 'English' : 'EN'}</button>
        <button className={language === 'he' ? 'active' : ''} aria-pressed={language === 'he'} aria-label={t('Hebrew')} onClick={() => setLanguage('he')}>{expanded ? 'עברית' : 'עב'}</button>
      </div>
      <button
        className="theme-toggle"
        onClick={toggleTheme}
        aria-label={t(theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme')}
        title={t(theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme')}
      >
        {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
      </button>
    </div>
  );
}
