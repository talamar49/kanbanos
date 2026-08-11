# Testing Kanbanos

## Required checks

```bash
npm test               # complete regression suite, once
npm run test:watch     # focused local development loop
npm run test:coverage  # HTML report in coverage/
npm run build          # TypeScript and production build
```

Every product code change must include or update a test and must finish with `npm test` and `npm run build` passing. See `agent.md` for the full regression policy.

## Feature regression map

| Product area | Main regression coverage |
| --- | --- |
| Workspace model, migration, validation, projects, tasks, columns, ordering, dependencies, attachments, preferences, and canvas data | `src/domain/workspace.test.ts`, `src/domain/workspace.reducer.test.ts` |
| Full app boot, local workspace creation, quick capture, save, recent workspace loading, sync-before-open for remotes, desktop attachment bridge, and conflict resolution | `src/App.test.tsx` |
| Board, list, timeline, roadmap, canvas, files, sidebar navigation, search, filters, and action delegation | `src/components/Views.test.tsx` |
| Project/task creation, rich task details, labels, subtasks, links, attachments, remotes, and conflict dialogs | `src/components/Modals.test.tsx` |
| Local, remote, private, and recent-workspace onboarding | `src/components/Onboarding.test.tsx` |
| In-app file/folder preview navigation and fallback behavior | `src/components/AttachmentPreviewModal.test.tsx` |
| English/Hebrew direction, theme persistence, interpolation, IPC errors, and literal Hebrew translation completeness | `src/i18n.test.tsx` |
| Text, Markdown, media, folders, Word, PowerPoint, Excel, truncation, and symlink preview safety | `electron/attachment-preview.test.ts` |
| Local Git initialization, no-op saves, commit persistence, recent workspaces, all managed-file additions/updates/deletions, credential exclusion and reset, real-path attachment containment, remote clone/sync/offline safety, identity-independent clean multi-file merges, bounded conflict previews, simultaneous JSON/attachment conflicts, modify/delete conflicts, blocked saves during conflicts, and local/remote resolution | `electron/git-service.test.ts` |

Tests use temporary repositories and files. They never touch a developer's real Kanbanos workspace.
