# Chess PGN Viewer

Chess PGN Viewer is an Obsidian plugin that renders interactive chess games inside ` ```chess ` code blocks. It turns PGN into a clickable board, supports move navigation, and displays comments, variations, arrows, highlights, and move annotations.

## Features

- Interactive chess board with previous, next, and reset navigation
- PGN parsing with mainline moves and nested variations
- Support for PGN comments and board annotations:
  - `%csl` square highlights
  - `%cal` arrows
- Move annotation glyphs from PGN NAGs:
  - `!`, `?`, `!!`, `??`, `!?`, `?!`
- Compact study-style notation layout with clickable moves
- Board geometry that stays aligned on resize

## Installation

### From source

1. Clone this repository.
2. Run `npm install`.
3. Run `npm run build`.
4. Copy `main.js` and `styles.css` into your vault plugin folder at `.obsidian/plugins/chess-pgn-viewer/`.
5. Reload Obsidian and enable the plugin.

## Usage

Create a fenced code block with the `chess` language:

```chess
orientation: white
showMoves: true
showComments: true
showVariations: true

[Event "Training Game"]
[White "Kasparov"]
[Black "Karpov"]

1. e4 {King pawn opening [%csl Ge4][%cal Ge2e4]}
   e5
2. Nf3 (2. Bc4 {Italian-style line}) Nc6
3. Bb5 a6
```

### Supported block options

- `orientation: white | black`
- `showMoves: true | false`
- `showComments: true | false`
- `showVariations: true | false`

If a block option is omitted, the plugin uses its default value.

## Development

```bash
npm install
npm run dev
npm test
npm run build
```

- `npm run dev` builds in watch mode.
- `npm test` runs the Vitest suite.
- `npm run build` creates the production `main.js` bundle.

## Project Structure

- `src/main.ts` - Obsidian plugin entry point
- `src/chess/block.ts` - PGN parsing and game-state model
- `src/chess/viewer.ts` - board rendering, navigation, and notation UI
- `tests/` - Vitest coverage for parsing and viewer behavior
- `styles.css` - plugin styles
- `main.js` - built plugin bundle

## Testing

Tests use `vitest` with `jsdom`. The most important coverage is around PGN parsing, notation layout, navigation, geometry, and annotation rendering. Run the full suite before publishing changes.

## Notes

- The plugin targets Obsidian desktop and does not require a separate backend.
- `main.js` is generated; do not edit it by hand.
- Keep the built assets in sync with `.obsidian/plugins/chess-pgn-viewer/` when testing locally.
