import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PreferencesProvider } from './i18n';
import { COMPACT_LAYOUT_QUERY, isNativeMobile } from './platform/runtime';
import './styles/global.css';

async function bootstrap() {
  document.documentElement.classList.toggle(
    'compact-layout',
    window.matchMedia(COMPACT_LAYOUT_QUERY).matches,
  );
  const nativeMobile = isNativeMobile();
  if (nativeMobile) {
    const { installMobileBridge } = await import('./platform/mobile');
    installMobileBridge();
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <PreferencesProvider>
        <App />
      </PreferencesProvider>
    </React.StrictMode>,
  );

  if (nativeMobile) {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      void import('@capacitor/splash-screen').then(({ SplashScreen }) => SplashScreen.hide()).catch(() => undefined);
    }));
  }
}

void bootstrap();
