---
name: ship
description: Ship all current Kanbanos repository work in a tested GitHub release. Use when the user asks to ship, publish, cut, or release a version. It safely commits and pushes current work to main, bumps the version in a separate commit, then verifies the GitHub Actions build and GitHub Release with Windows, AppImage, and Debian downloads.
---

# Ship a Kanbanos release

Use this workflow only for this repository. A successful release is a green
`Build and release` workflow on `main`, a Git tag of `v<package-version>`, and a
GitHub Release page containing all three desktop packages.

## Inputs

Accept one optional version input:

- `patch`, `minor`, or `major` for a semantic-version bump.
- An explicit semantic version such as `0.3.0` when supplied by the user.
- Default to `minor` when the user does not specify one.

## Safety rules

- Never print, stage, commit, upload, or modify `.env*`, `agent.md`,
  `.github-token`, access tokens, runner tokens, or generated credentials.
- `.github-token` is a local mode-`600`, Git-ignored credential file. Read it only
  into `GH_TOKEN` when GitHub API access is needed and do not enable shell tracing.
- Include all other tracked and untracked repository work in a separate conventional
  commit before changing the version. Review staged names and the diff summary first;
  stop if a protected or secret-bearing file is staged.
- Protected local files may remain outside Git and do not block a release.
- Work only on `main`. Never force-push, delete or move tags, replace a release, or
  bypass a failed check.
- GitHub Actions creates the release tag. Do not create or push the tag locally.
- Stop and report the failing command or job if validation, commit, push, workflow,
  tag, or release verification fails.

## 1. Authenticate and preflight

From the repository root, load the ignored token without displaying it when present:

```bash
set +x
if test -f .github-token; then
  test "$(stat -c '%a' .github-token)" = 600
  git check-ignore -q .github-token
  export GH_TOKEN="$(<.github-token)"
fi
gh auth status --hostname github.com
gh api repos/talamar49/kanbanos --jq '.permissions.admin' | grep -qx true
```

Confirm the repository and branch are correct, then validate all current work:

```bash
test "$(git branch --show-current)" = main
test "$(git remote get-url origin)" = https://github.com/talamar49/kanbanos.git
git fetch origin main --tags
git merge-base --is-ancestor origin/main HEAD
git diff --check
npm ci --prefer-offline
npm test
npm run build
ruby -e "require 'yaml'; YAML.load_file('.github/workflows/release.yml')"
```

Confirm `.github/workflows/release.yml` runs on pushes to `main`, runs test/build,
packages on native Linux and Windows runners, uploads `.AppImage`, `.deb`, and `.exe`
files, and grants `contents: write` only to the release job. Confirm `main` is
protected, only `talamar49` currently has collaborator push access, force pushes and
deletions are disabled, and non-admin changes require a pull request.

The local branch must not be behind `origin/main`. If it is behind, stop rather than
merging or rebasing automatically.

## 2. Commit and push all current work

Stage every tracked and untracked repository change except protected local files:

```bash
git add -A -- . \
  ':(exclude)agent.md' \
  ':(exclude).env' \
  ':(exclude).env.*' \
  ':(exclude).github-token'
```

Review what will be committed without printing protected contents:

```bash
git diff --cached --check
git diff --cached --name-only
git diff --cached --stat
```

Stop if staged names contain `.env*`, `agent.md`, `.github-token`, access-token files,
runner-token files, credentials, or any other secret-bearing material. If the index is
not empty, create one conventional commit whose subject describes the repository work,
then push it immediately:

```bash
git commit -m "<conventional repository-work subject>"
WORK_SHA="$(git rev-parse HEAD)"
git push origin main
```

Find the `Build and release` workflow run whose `head_sha` is `WORK_SHA` through the
GitHub Actions API. Poll until it completes and require conclusion `success`. This run
must test, build, and package every platform; its release job may be skipped because
the current package version already has a tag. Do not bump the version after a failed
work push.

If there was no ordinary repository work to commit, skip this push and continue.
Protected files may remain ignored or untracked.

## 3. Bump the version and update release notes

1. Find the previous release tag with `git describe --tags --abbrev=0` if one exists.
2. Run `npm version <input> --no-git-tag-version`; use `minor` by default.
3. Read the new version from `package.json`; it must be valid semver and its expected
   tag must be `v<version>`.
4. Update `CHANGELOG.md` with a non-empty `## [<version>] - YYYY-MM-DD` section
   immediately below `## [Unreleased]`. Derive concise bullets from commits since the
   previous release and from the just-pushed work commit.
5. Verify the tag does not exist locally or remotely:

```bash
TAG="v<version>"
! git rev-parse --verify --quiet "refs/tags/$TAG"
! git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1
```

Never reuse an existing version.

## 4. Validate and push the release commit

Run validation again after changing the version:

```bash
npm test
npm run build
git diff --check
git diff -- package.json package-lock.json CHANGELOG.md
```

Stage only the version and changelog files, verify the staged names, commit, and push
`main` without creating a local tag:

```bash
git add package.json package-lock.json CHANGELOG.md
git diff --cached --name-only
git diff --cached --check
git commit -m "chore(release): v<version>"
RELEASE_SHA="$(git rev-parse HEAD)"
git push origin main
```

The push to `main` triggers `.github/workflows/release.yml`. GitHub Actions must test
and build the application, build all packages on native runners, then create the
`v<version>` tag and GitHub Release only after every required job succeeds.

## 5. Verify GitHub Actions and the release

Use `GH_TOKEN` from `.github-token` when available, otherwise use the existing `gh`
authentication. Query the GitHub Actions API for the `Build and release` run whose
`head_sha` is `RELEASE_SHA`. Poll until completion, require conclusion `success`, and
inspect failed job logs before reporting any failure.

Then request:

```text
GET /repos/talamar49/kanbanos/releases/tags/v<version>
```

Verify all of the following:

- The release is neither a draft nor a prerelease.
- Its tag is `v<version>` and resolves to `RELEASE_SHA`.
- Its assets include exactly one Windows installer matching
  `Kanbanos-<version>-Windows.exe`.
- Its assets include exactly one Linux AppImage matching
  `Kanbanos-<version>-Linux.AppImage`.
- Its assets include exactly one Debian package matching
  `Kanbanos-<version>-Linux.deb`.
- Every asset has a nonzero size and a browser download URL.

Finally fetch the Actions-created tag locally:

```bash
git fetch origin "refs/tags/v<version>:refs/tags/v<version>"
```

Report the workflow URL and release URL:

```text
https://github.com/talamar49/kanbanos/actions
https://github.com/talamar49/kanbanos/releases/tag/v<version>
```

Do not claim the release succeeded until the workflow, tag target, page, and all three
assets have been verified through GitHub.
