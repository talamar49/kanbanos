# Changelog

All notable changes to Kanbanos are documented in this file.

## [Unreleased]

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
