import { readFile, writeFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const match = String(manifest.version).match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
if (!match) throw new Error(`Invalid package version: ${manifest.version}`);
const [, major, minor, patch] = match.map(Number);
const versionCode = major * 1_000_000 + minor * 1_000 + patch;
if (versionCode < 1 || versionCode > 2_100_000_000) throw new Error(`Mobile version code is out of range: ${versionCode}`);

const androidUrl = new URL('../android/app/build.gradle', import.meta.url);
let android = await readFile(androidUrl, 'utf8');
android = android
  .replace(/versionCode \d+/, `versionCode ${versionCode}`)
  .replace(/versionName "[^"]+"/, `versionName "${manifest.version}"`);
await writeFile(androidUrl, android);

const iosUrl = new URL('../ios/App/App.xcodeproj/project.pbxproj', import.meta.url);
let ios = await readFile(iosUrl, 'utf8');
ios = ios
  .replace(/CURRENT_PROJECT_VERSION = \d+;/g, `CURRENT_PROJECT_VERSION = ${versionCode};`)
  .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${manifest.version};`);
await writeFile(iosUrl, ios);

console.log(`Synchronized mobile version ${manifest.version} (${versionCode}).`);
