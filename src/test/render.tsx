import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { PreferencesProvider } from '../i18n';

export function renderWithPreferences(ui: ReactElement) {
  return render(<PreferencesProvider>{ui}</PreferencesProvider>);
}
