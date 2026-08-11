import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

const config: CapacitorConfig = {
  appId: 'com.kanbanos.mobile',
  appName: 'Kanbanos',
  webDir: 'dist',
  backgroundColor: '#f5f6f8',
  loggingBehavior: 'debug',
  zoomEnabled: false,
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  ios: {
    contentInset: 'never',
    webContentsDebuggingEnabled: false,
  },
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor',
  },
  plugins: {
    CapacitorHttp: {
      enabled: false,
    },
    Keyboard: {
      resize: KeyboardResize.Body,
      resizeOnFullScreen: true,
    },
    SplashScreen: {
      launchAutoHide: false,
      launchShowDuration: 700,
      backgroundColor: '#f5f6f8',
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: false,
      style: 'LIGHT',
      backgroundColor: '#f5f6f8',
    },
  },
};

export default config;
