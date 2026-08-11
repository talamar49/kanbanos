import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PreferencesProvider } from './i18n';
import { isCompactLayout, isNativeMobile } from './platform/runtime';
import './styles/global.css';

async function bootstrap() {
  document.documentElement.classList.toggle('compact-layout', isCompactLayout());
  const nativeMobile = isNativeMobile();
  if (nativeMobile) {
    const [{ installMobileBridge }, { installMobileKeyboardHandling }] = await Promise.all([
      import('./platform/mobile'),
      import('./platform/mobile-keyboard'),
    ]);
    installMobileBridge();
    void installMobileKeyboardHandling().catch(() => undefined);
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
