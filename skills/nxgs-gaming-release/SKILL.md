---
name: nxgs-gaming-release
description: Build, package, download, or verify NXGS Gaming release artifacts. Use for Windows portable builds, GitHub Actions release workflows, artifact cleanup, version/build-code files, and avoiding nested zip artifacts.
---

# NXGS Gaming Release

## Release Rules

- Every portable build must include `BUILD_INFO.txt` inside the runnable app folder.
- `BUILD_INFO.txt` must include app name, semantic version, version code, commit SHA, branch, build time, source URL, and workflow run URL when available.
- Use `CHIAKI_VERSION_MAJOR`, `CHIAKI_VERSION_MINOR`, and `CHIAKI_VERSION_PATCH` from `CMakeLists.txt` for the semantic version until the project renames those CMake variables.
- Use a version code that uniquely identifies the exact build. For GitHub Actions, prefer `MAJOR.MINOR.PATCH+run.RUN_NUMBER.SHORT_SHA`.
- Do not upload a pre-compressed portable zip with `actions/upload-artifact`; GitHub already downloads artifacts as zip archives. Upload a staging directory that contains `NXGS-Gaming-Win/` directly.
- Do not leave a zip inside another downloaded artifact zip for portable builds.
- Keep installer artifacts separate from portable artifacts and avoid naming an artifact with `.zip` unless the file being uploaded is intentionally a zip release asset outside `actions/upload-artifact`.

## Local Release Folder

- Keep the local `release/` folder simple after downloading a Windows portable artifact.
- Prefer this layout:

```text
release/
  NXGS-Gaming-Win/
    NXGS Gaming.exe
    BUILD_INFO.txt
    SOURCE_CODE.txt
    COPYING
    LICENSES/
```

- Remove temporary artifact-wrapper zips after extraction unless the user explicitly asks to keep them.
- Before deleting generated release output, verify the target path resolves inside the repository.

## Verification

- After changing release packaging, run `git diff --check`.
- Trigger `build-windows-x86.yml` for Windows x64 portable verification when GitHub auth is available.
- After the workflow succeeds, inspect the artifact list and download the portable artifact.
- Extract it locally and confirm there is no nested `.zip` inside the portable artifact.
- Smoke-test `NXGS Gaming.exe` from the extracted `NXGS-Gaming-Win` folder when running on Windows.

## Compliance

- Keep `COPYING`, `LICENSES/`, `README.md`, `SOURCE_CODE.txt`, and AGPL/source availability text in the portable folder.
- Do not remove upstream chiaki-ng or Chiaki attribution while packaging.
