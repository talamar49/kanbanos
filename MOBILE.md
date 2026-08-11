# Kanbanos mobile

Kanbanos ships the same React workspace and domain model through Capacitor on Android and iOS. The Electron application remains a separate supported target.

## Supported systems

- Android 8.0 / API 26 or newer (required for binary-safe native Git HTTP bodies)
- iOS 15 or newer
- Phones and tablets, portrait and landscape
- English/LTR and Hebrew/RTL
- Light and soft-dark themes

## Local-first architecture

Mobile workspaces are real Git repositories managed with `isomorphic-git` and persisted by LightningFS in private WebView storage. Every successful save writes `workspace.json`, stages all managed `.kanbanos` content, creates a local commit, flushes storage, and then fetches, merges, and pushes when a remote is configured.

- Work remains available offline.
- Git conflicts use the same local/remote choice flow as desktop.
- Workspace exports contain `.kanbanos` data and attachments but never credentials.
- Private credentials are stored in iOS Keychain or Android Keystore-backed encrypted storage.
- Android application backup and cleartext network traffic are disabled.
- **Disconnect workspace** returns to onboarding without deleting data. Removing a workspace from the recent list permanently deletes its app-owned repository after an explicit warning, so export first when a portable backup is needed.
- Mobile Git uses smart HTTP over HTTPS through a binary-safe native HTTP adapter (the global Capacitor `fetch` patch stays disabled because it can UTF-8-convert Git pack data). Common SCP/SSH-style URLs are normalized to HTTPS; private repositories require a personal access token.

Desktop workspace folders cannot be mounted directly inside the iOS sandbox. Use **Export workspace package** on mobile or zip the desktop `.kanbanos` directory, then choose **Import workspace package**.

## Development

Install dependencies and synchronize both native projects:

```bash
npm ci
npm run mobile:sync
```

### Android

Requirements: JDK 21, Android SDK Platform 36, and Build Tools 36.

```bash
npm run mobile:android
```

The local APK is written to:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

Open the project with Android Studio through `npx cap open android` for emulator or device debugging.

### iOS

Requirements: macOS and Xcode with an iOS Simulator runtime.

```bash
npm run mobile:ios
npx cap open ios
```

Choose the `App` scheme and an iPhone or iPad Simulator. Physical-device builds require an Apple Development team and provisioning profile.

## Versioning

`scripts/sync-mobile-version.mjs` derives Android `versionCode`, Android `versionName`, iOS `CURRENT_PROJECT_VERSION`, and iOS `MARKETING_VERSION` from `package.json`. Run it through `npm run mobile:sync`; do not hand-edit native versions.

## GitHub Actions and releases

`.github/workflows/release.yml` compiles mobile packages only after the complete test and web/Electron build passes.

Each versioned GitHub Release contains:

```text
Kanbanos-<version>-Android.apk
Kanbanos-<version>-Android.apk.sha256
Kanbanos-<version>-iOS-Simulator.zip
Kanbanos-<version>-iOS-Simulator.zip.sha256
```

The Android job builds a production-signed APK when these repository secrets are configured:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEY_ALIAS`
- `ANDROID_STORE_PASSWORD`
- `ANDROID_KEY_PASSWORD`

`ANDROID_KEYSTORE_BASE64` must contain the base64 encoding of the release keystore. If the four secrets are absent, CI deliberately falls back to an installable debug-signed APK so release validation still has a runnable Android artifact. Debug keys are runner-local, so a later debug-signed release may require uninstalling the previous fallback APK first; configure the four secrets before public production distribution to preserve in-place upgrades.

The iOS release artifact is an unsigned Simulator application compiled by Xcode. GitHub Actions cannot create an installable physical-device IPA without an Apple distribution certificate, provisioning profile, team, and signing authorization. Those credentials should be supplied through protected GitHub secrets when App Store or ad-hoc distribution is introduced; they must never be committed.

## Regression checks

Before changing mobile behavior, run:

```bash
npm test
npm run test:coverage
npm run build
npm run mobile:sync
```

On a machine with the Android toolchain, also run:

```bash
./android/gradlew -p android --no-daemon clean assembleDebug
```

On macOS, compile the `App` scheme for a generic iOS Simulator. Mobile persistence tests cover save/reopen/removal, WebView runtime polyfills, binary native HTTP transport, attachments and empty folders, hardened portable export/import, remote clone/push, competing edits, text and binary conflict choices, and SSH URL normalization. Component tests cover compact navigation, the drawer, touch drag handles, mobile onboarding, planning-horizon controls, and mobile share actions.
