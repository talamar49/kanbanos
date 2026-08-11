import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import packageManifest from '../package.json';
import capacitorConfig from '../capacitor.config';

describe('macOS distribution', () => {
  it('defines a universal DMG build with the application icon', () => {
    expect(packageManifest.scripts['dist:mac']).toBe(
      'npm run build && electron-builder --mac --universal',
    );
    expect(packageManifest.build.mac).toMatchObject({
      icon: 'build/icon.icns',
      target: ['dmg'],
      artifactName: 'Kanbanos-${version}-macOS-${arch}.${ext}',
    });
    expect(existsSync('build/icon.icns')).toBe(true);
  });

  it('packages and publishes the macOS DMG in the release workflow', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8');

    expect(workflow).toContain('package-macos:');
    expect(workflow).toContain('npm run dist:mac -- --publish never');
    expect(workflow).toContain('release/*-macOS-*.dmg');
    expect(workflow).toContain('- package-macos');
    expect(workflow).toContain('name: macos-package');
  });
});

describe('mobile distribution', () => {
  it('defines Capacitor builds for Android and iOS without replacing Electron', () => {
    expect(capacitorConfig).toMatchObject({
      appId: 'com.kanbanos.mobile',
      appName: 'Kanbanos',
      webDir: 'dist',
      plugins: {
        CapacitorHttp: { enabled: false },
        SplashScreen: { launchAutoHide: false },
      },
    });
    expect(packageManifest.main).toBe('dist-electron/main.js');
    expect(packageManifest.scripts['mobile:sync']).toContain('cap sync');
    expect(packageManifest.scripts['mobile:android']).toContain('assembleDebug');
    expect(packageManifest.scripts['mobile:ios']).toContain('cap sync ios');
    expect(existsSync('android/gradlew')).toBe(true);
    expect(existsSync('android/app/src/main/AndroidManifest.xml')).toBe(true);
    expect(existsSync('ios/App/App.xcodeproj/project.pbxproj')).toBe(true);
    expect(existsSync('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png')).toBe(true);
  });

  it('keeps private mobile data out of Android backup and versions both native projects', () => {
    const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
    const rootIgnore = readFileSync('.gitignore', 'utf8');
    const androidBuild = readFileSync('android/app/build.gradle', 'utf8');
    const androidFilePaths = readFileSync('android/app/src/main/res/xml/file_paths.xml', 'utf8');
    const androidVariables = readFileSync('android/variables.gradle', 'utf8');
    const iosProject = readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8');
    const versionScript = readFileSync('scripts/sync-mobile-version.mjs', 'utf8');

    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('android:usesCleartextTraffic="false"');
    expect(rootIgnore).toContain('*.keystore');
    expect(rootIgnore).toContain('*.p12');
    expect(androidBuild).toMatch(/versionCode \d+/);
    expect(androidVariables).toContain('minSdkVersion = 26');
    expect(androidFilePaths).toContain('<cache-path name="kanbanos_exports" path="kanbanos-exports/" />');
    expect(androidFilePaths).not.toContain('<external-path');
    expect(androidBuild).toMatch(/versionName "\d+\.\d+\.\d+"/);
    expect(iosProject).toMatch(/CURRENT_PROJECT_VERSION = \d+;/);
    expect(iosProject).toMatch(/MARKETING_VERSION = \d+\.\d+\.\d+;/);
    expect(versionScript).toContain('major * 1_000_000 + minor * 1_000 + patch');
    expect(versionScript).toContain('android/app/build.gradle');
    expect(versionScript).toContain('ios/App/App.xcodeproj/project.pbxproj');
  });

  it('builds and publishes Android and iOS artifacts from GitHub Actions', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8');

    expect(workflow).toContain('package-android:');
    expect(workflow).toContain('package-ios:');
    expect(workflow).toContain('Kanbanos-${VERSION}-Android.apk');
    expect(workflow).toContain('Kanbanos-${VERSION}-iOS-Simulator.zip');
    expect(workflow).toContain("ARCHS='arm64 x86_64'");
    expect(workflow).toContain('lipo -verify_arch arm64 x86_64');
    expect(workflow).toContain("sdkmanager 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0'");
    expect(workflow).toContain('testDebugUnitTest');
    expect(workflow).toContain('signing: ${{ steps.android-package.outputs.signing }}');
    expect(workflow).toContain('The Android APK is installable directly and is ${ANDROID_SIGNING}-signed.');
    expect(workflow).toContain('name: android-package');
    expect(workflow).toContain('name: ios-package');
    expect(workflow).toContain('- package-android');
    expect(workflow).toContain('- package-ios');
  });
});
