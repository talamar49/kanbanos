---
name: ship
description: Ship all current Kanbanos repository work in a tested, tagged GitLab release. Use when the user asks to ship, publish, cut, or release a version. It safely commits current repository changes, validates the release pipeline, updates the version and changelog, pushes an annotated tag, then verifies that GitLab created a release page with Windows and Linux downloads.
---

# Ship a Kanbanos release

Use this workflow only for this repository. A successful release is a Git tag of
`v<package-version>`, a green tagged pipeline, and a GitLab Release page with all
three download links.

## Inputs

Accept one optional version input:

- `patch`, `minor`, or `major` for a semantic-version bump.
- An explicit semantic version such as `0.2.0` when supplied by the user.
- Default to `patch` only when the user does not specify one.

## Safety rules

- Never print, commit, or modify `.env`, `agent.md`, access tokens, or runner tokens.
- Include all other tracked and untracked repository work in a separate conventional
  commit before creating the release commit. Review the staged file list and diff
  summary before committing; stop if a protected or secret-bearing file is staged.
- Protected local files may remain outside Git and do not block a release. Never stage
  or alter them merely to make the worktree appear clean.
- Do not force-push, delete tags, or replace an existing release.
- Stop and report the failing job if validation, commit, push, pipeline, or release
  checks fail.

## 1. Preflight

From the repository root, inspect and validate all current work before changing a
version:

```bash
git status --short
git fetch --tags origin
git diff --check
npm ci --prefer-offline
npm test
npm run build
ruby -e "require 'yaml'; YAML.load_file('.gitlab-ci.yml')"
```

The local branch must not be behind `origin/master`. Confirm `.gitlab-ci.yml` has a
`release` stage and tag-only `package:linux`, `package:windows`, and `release` jobs.
If any check fails, stop.

## 2. Commit all current repository work

Stage every tracked and untracked repository change except protected local files:

```bash
git add -A -- . ':(exclude)agent.md' ':(exclude).env' ':(exclude).env.*'
```

Review what will be committed without printing protected file contents:

```bash
git diff --cached --check
git diff --cached --name-only
git diff --cached --stat
```

Stop if the staged names contain `.env`, `agent.md`, access-token files, runner-token
files, generated credentials, or any other secret-bearing material. If the index is
not empty, create one conventional commit whose subject accurately summarizes the
staged repository work. Do not use the release commit for source changes.

After committing, verify that no ordinary repository changes remain. It is acceptable
for protected `.env*` or `agent.md` files to remain untracked or modified; do not stage,
print, modify, or commit them. Do not push yet—the work commit, release commit, and tag
are pushed together after release validation.

## 3. Bump version and write release notes

1. Find the previous release tag with `git describe --tags --abbrev=0` if one exists.
2. Run `npm version <input> --no-git-tag-version`.
3. Read the new version from `package.json`; it must be valid semver and its tag must
   be `v<version>`.
4. Update `CHANGELOG.md` with a new `## [<version>] - YYYY-MM-DD` section immediately
   below `## [Unreleased]`. Derive concise bullets from commit subjects between the
   previous tag and `HEAD`; do not leave the release section empty.
5. Verify the new version has not already been tagged:

```bash
if git rev-parse --verify --quiet "refs/tags/v<version>"; then
  echo "Release tag already exists" >&2
  exit 1
fi
```

## 4. Validate and create the release commit

Run the test and production build again after the version update:

```bash
npm test
npm run build
git diff --check
git diff -- package.json package-lock.json CHANGELOG.md
```

Stage only `package.json`, `package-lock.json`, and `CHANGELOG.md`, then create a
release commit and annotated tag. Push the repository work commit, release commit,
and tag together:

```bash
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore(release): v<version>"
git tag -a "v<version>" -m "Kanbanos v<version>"
git push origin master --follow-tags
```

## 5. Verify the GitLab release

The tag pipeline must complete these jobs in order:

```text
test → package:linux + package:windows → release
```

Use the local `GITLAB_TOKEN` only when it is already set in the environment or in
an ignored `.env` file. Do not echo it. Query the GitLab API for project `4682` at
`https://gitlab.rafael.co.il/api/v4` and poll the `v<version>` pipeline until it
finishes. Inspect failed job logs before reporting failure.

On success, request:

```text
GET /projects/4682/releases/v<version>
```

Verify the response includes all of these release asset link names:

- `Windows installer (.exe)`
- `Linux AppImage (.AppImage)`
- `Linux Debian package (.deb)`

Report the release URL:

```text
https://gitlab.rafael.co.il/talam1/kanbanos/-/releases/v<version>
```

If no local token is available, provide that URL and ask the user to confirm the
tag pipeline and its three assets in GitLab instead of claiming the release exists.
