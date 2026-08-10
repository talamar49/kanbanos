<p align="center"><img src="src/assets/kanbanos-logo.png" alt="Kabanos mascot" width="150" /></p>

# Kanbanos

A calm, Git-native project workspace for Windows and Linux. Kanbanos combines a focused desktop experience with the durability and ownership of a Git repository—without exposing Git complexity to the user.

![Electron](https://img.shields.io/badge/Electron-desktop-47848f)
![React](https://img.shields.io/badge/React-TypeScript-5b67d8)
![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20Linux-6c5ce7)

## Product principles

- **Calm by default** — hierarchy, whitespace, and motion guide attention without visual noise.
- **Local and owned** — every workspace begins as a local Git repository; adding a remote is optional.
- **Git without Git UI** — clone, commit, fetch, merge, and push happen behind a human-friendly save action.
- **Safe conflict handling** — when two workspace versions diverge, users compare clear summaries and choose which version to keep.
- **Module-ready** — shared projects and work items are separate from Kanban-specific placement, leaving room for timeline, Gantt, roadmap, and other future views.

## Features

- Multiple projects in one workspace
- Drag-and-drop Kanban cards and customizable columns
- Task descriptions, labels, priorities, assignees, due dates, and subtasks
- Search and priority filtering
- WIP limits and fast inline task creation
- Local-first workspace creation in a folder chosen by the user
- Optional remote repository connection, remote cloning, or existing local repository selection
- Git-backed commit, fetch, merge, and push
- Human-friendly conflict resolution
- Secure Electron IPC with context isolation
- Windows NSIS and Linux AppImage/deb packaging

## Architecture

```text
electron/
  main.ts             Electron lifecycle and secure IPC
  preload.ts          Narrow renderer API bridge
  git-service.ts      Repository, persistence, sync, and conflict handling
src/
  domain/             View-independent workspace model and reducer
  components/         Application shell and Kanban view components
  styles/             Shared visual design system
```

Kanban placement is stored below `workItem.moduleData.kanban`; project and work-item identity are view-independent. New modules can add their own data without changing core entities.

## Development

Requirements: Node.js 20+ and Git installed on the machine.

```bash
npm install
npm run dev
```

The Vite renderer opens inside Electron. A browser-only preview is also available through the Vite URL and uses in-memory demo data.

## Build

```bash
npm run build       # type-check and production build
npm run dist:win    # Windows NSIS installer
npm run dist:linux  # Linux AppImage and deb
```

Cross-compiling Windows installers from Linux may require Wine. Native platform builds are recommended for release artifacts.

## Workspace storage

Kanbanos writes one versioned document to:

```text
.kanbanos/workspace.json
```

On save it commits only the workspace document, fetches the remote, merges if needed, and pushes the active branch. If the network or remote is unavailable, the local Git commit remains safe and the UI clearly reports that sync needs attention.

## Security

The renderer is sandboxed and has no Node.js access. Filesystem, dialog, shell, and Git operations run in Electron's main process and are exposed through a small, typed preload bridge. Git commands are spawned with argument arrays rather than interpolated shell commands.

## License

MIT
