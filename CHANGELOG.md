# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

- No unreleased changes yet.

## [0.1.7] - 2026-05-30

### Fixed

- Removed the empty notation area from static FEN blocks so they render as board-only views.
- Updated the FEN screenshot to show the board-only layout.

## [0.1.6] - 2026-05-30

### Added

- Added static FEN position rendering for `fen:`, standalone `[FEN "..."]`, and raw FEN chess blocks.
- Added README screenshots for PGN and FEN block examples.

## [0.1.5] - 2026-05-29

### Added

- Added lichess-style board badges for move annotation glyphs on the active move.

## [0.1.4] - 2026-05-28

### Changed

- Restyled the notation panel move list to more closely match the lichess column analysis layout.

## [0.1.3] - 2026-05-28

### Changed

- Restyled the notation panel to use the obsidian-chess-study grid-style move list.

## [0.1.2] - 2026-05-28

### Changed

- Replaced the custom chess piece artwork with Chessground cburnett piece assets.
- Updated the project license metadata from MIT to GPL-3.0-or-later.

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
