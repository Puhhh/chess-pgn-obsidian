# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

- No unreleased changes yet.

## [0.1.1] - 2026-04-29

### Added

- Added project ESLint setup with `eslint-plugin-obsidianmd`, flat config.

### Changed

- Updated release metadata and package manifests for version `0.1.1`.

### Fixed

- Removed the unnecessary `async` modifier from `onload`.
- Removed the unused `Game` type import from the PGN parser module.

## [0.1.0] - 2026-04-29

### Added

- Initial public release of Chess PGN Viewer for Obsidian.
- Interactive rendering for `chess` code blocks with move navigation and board reset controls.
- PGN parsing with support for comments, nested variations, move annotation glyphs, `%csl` square highlights, and `%cal` arrows.
- README screenshots, MIT license, and release-ready plugin metadata.

### Changed

- Refined the notation panel into a compact study-style layout.
- Updated release metadata so the published plugin description and GitHub release tag match `0.1.0`.

### Fixed

- Prevented next-move navigation from advancing past the end of a line.
- Fixed notation text truncation and wrapping issues for long SAN labels, `1...` prefixes, and variation rows.
- Removed repository-local Obsidian cache artifacts from version control.
