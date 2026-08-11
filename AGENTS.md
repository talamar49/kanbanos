# Kanbanos agent guidance

## Definition of done for every mission

### Automated regression policy

- Every product code change must add or update an automated test in the same change. Cover the behavior at the lowest useful level (domain, component, application integration, attachment preview, or Git persistence).
- Every bug fix must first be represented by a regression test that would fail without the fix. Keep that test permanently so the bug cannot silently return.
- Tests must assert user-visible behavior and durable outcomes, not implementation details alone. UI changes must cover the affected interaction; persistence changes must verify saved and reloaded data.
- Documentation-only, generated-artifact-only, or non-behavioral configuration changes may omit a new test only when the completion note explicitly explains why existing tests are sufficient.
- Never delete, skip, weaken, or rewrite an assertion merely to make a changed implementation pass. Update an expectation only when the intended product behavior itself changed.
- After development, run the complete `npm test` regression suite and `npm run build`. Do not report the mission complete unless both pass. If either cannot run, clearly report the blocker and the unverified behavior.
- Use `npm run test:coverage` when adding a feature area or changing substantial behavior, and add missing coverage before completion.

Every mission that changes the product UI must treat theme and language support as required work, not follow-up polish.

- Verify the experience in both light and soft-dark themes. Keep primary text high-contrast and reserve muted colors for genuinely secondary information.
- Put every user-facing string through `t(...)` and add its Hebrew translation in `src/i18n.tsx`. Do not translate user-created names or content.
- Verify English/LTR and Hebrew/RTL layouts, including icon direction, spacing, alignment, menus, drag geometry, and text truncation.
- Prefer application-styled menus and controls when native browser/OS rendering would be inconsistent across themes.
- Make every new component comfortably sized, immediately noticeable, and visually consistent with Kanbanos. Reuse the app's spacing, rounded surfaces, purple accent, borders, shadows, focus states, and soft-dark palette instead of introducing generic browser styling.
- Do not use micro typography for primary content or controls: target at least 14px for body/control text and 11–12px for secondary metadata. Interactive controls should normally be at least 38–44px tall with a clear hover and keyboard-focus state.
- Treat task details and other primary workflows as spacious work surfaces rather than compact utility popovers. Preserve readable hierarchy, generous padding, and obvious actions at common desktop sizes.
- Before completing a UI mission, check all four combinations: English light, English dark, Hebrew light, and Hebrew dark.
