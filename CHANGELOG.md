# Changelog

All notable changes to Kanbanos are documented in this file.

## [Unreleased]

## [0.6.0] - 2026-08-16

### Added

- Multiple named Canvas views per project with independent content and viewports, plus backward-compatible migration of existing canvases.
- Durable Kanban column roles for new-task placement and completion progress, with a localized in-app WIP-limit editor.
- A keyboard shortcut reference available from the sidebar or the `?` key.

### Improved

- Reworked Timeline scheduling with same-day reordering, resizable Kanban-style unscheduled columns, denser task and subtask cards, multi-week continuity, and clearer dependency routing.
- Kept desktop Kanban columns within the available width and strengthened full-card drop previews across Board and unscheduled workflows.
- Distinguished offline and remote sync failures from local save failures so status guidance accurately reflects data safety.
- Refined onboarding, mobile layouts, RTL localization, and soft-dark contrast across planning and attachment surfaces.

### Quality

- Expanded regression coverage for Canvas isolation and persistence, column rules and WIP limits, Timeline drag and dependency interactions, sync-state messaging, keyboard shortcuts, and theme contrast.

## [0.5.0] - 2026-08-12

### Added

- Desktop diagnostics that report workspace and Git health without exposing credentials.
- Phone Timeline scheduling with week, month, and year views, dependencies, unscheduled work, and contained chart scrolling.

### Improved

- Refined compact Board, Canvas, navigation, save feedback, drag scrolling, RTL, and light/dark touch workflows while keeping complete planning features available.
- Hardened mobile Git transport, workspace persistence, synchronization diagnostics, and conflict feedback across desktop and native runtimes.

### Quality

- Expanded automated coverage for diagnostics, mobile save states, compact Canvas behavior, Timeline range scrolling, and native platform persistence.

## [0.4.0] - 2026-08-11

### Added

- A phone-first agenda Timeline, quick task capture, keyboard-aware editing, and a lively branded mobile welcome experience.
- Local file references that keep desktop-owned files linked without copying them into a workspace, alongside native attachment workflows.

### Improved

- Reworked mobile Board, Roadmap, onboarding, task details, Canvas, navigation, RTL, and soft-dark layouts for touch reachability and vertical planning.
- Made native mobile layouts compact by default, preserved full-card touch drag-and-drop, and aligned Android instrumentation-test Kotlin dependencies.

### Quality

- Expanded regression coverage for the mobile agenda, keyboard lifecycle, native compact runtime, local references, onboarding, and application workflows.

## [0.3.0] - 2026-08-11

### Added

- Native Android and iOS applications with offline Git workspaces, secure credential storage, attachment import/export, conflict handling, and mobile lifecycle support.
- Responsive phone and tablet navigation, touch-safe drag handles, full-screen task workspaces, and mobile layouts for Board, List, Timeline, Canvas, Roadmap, Files, onboarding, and previews.

### Improved

- Added portable `.kanbanos.zip` workspace export/import, hardened credential exclusion, binary-safe native HTTPS Git transport, and HTTPS normalization for mobile remotes.
- Preserved the existing Electron desktop experience while sharing the workspace format, localization, themes, and domain behavior across platforms.
- Preserved empty attachment folders through Git and made app-owned mobile workspace removal explicit and durable.

### Delivery

- Added tested Android APK and iOS Simulator builds, checksums, native branding, synchronized versions, and mobile assets to GitHub Actions and GitHub Releases.

## [0.2.0] - 2026-08-11

### Added

- A freeform Canvas workspace for arranging notes, tasks, and files into visual plans and connected diagrams.
- Broad automated coverage for workspace persistence, Git synchronization, attachment previews, localization, onboarding, views, and core desktop workflows.
- Complete Canvas QA captures alongside refreshed English and Hebrew light/dark screenshots.

### Improved

- Git synchronization of managed workspace content, including disjoint edits, simultaneous file conflicts, and modify/delete conflict resolution.
- Remote workspace startup synchronization, credential reset behavior, attachment path containment, and bounded conflict previews.
- Planning and task workflows across Board, Timeline, Roadmap, attachments, dependencies, and repository onboarding.

### Delivery

- Migrated CI/CD from GitLab to GitHub Actions with native Windows and Linux packaging on every push to `main`.
- Added automatic GitHub Release pages with Windows installer, universal macOS disk image, Linux AppImage, and Debian package downloads.

## [0.1.1] - 2026-08-11

### Added

- Git-backed task file and folder attachments with workspace-wide browsing and secure local previews for media, text, Markdown, folders, and modern Office formats.
- English and Hebrew localization with complete RTL layouts, light and soft-dark themes, and expanded visual QA coverage.
- Cross-project planning controls, fast task capture, estimates, target dates, and dependency editing across Board, List, Timeline, and Roadmap views.

### Improved

- Timeline scheduling with true-duration cards, dynamic row sizing, full-card dragging, routed dependency ropes, and hover-to-cancel connectors.
- Git synchronization, conflict handling, repository onboarding, and tagged Windows/Linux release automation.

## [0.1.0] - 2026-08-10

### Added

- Initial Kanbanos desktop workspace application.
- GitLab CI tests and Windows/Linux release packaging.
