import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import packageManifest from '../package.json';

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
