import { describe, expect, it } from 'vitest';

import {
  serializeBoardAnnotations,
  replaceChessBlockSection,
  updateChessBlockWithSavedAnnotations,
  updatePgnWithSavedAnnotations,
  type SavableBoardAnnotation,
} from '../src/chess/persistence';

describe('serializeBoardAnnotations', () => {
  it('serializes temporary circles and arrows as PGN comment tags', () => {
    const annotations: SavableBoardAnnotation[] = [
      { kind: 'highlight', color: 'green', square: 'e4' },
      { kind: 'highlight', color: 'red', square: 'a2' },
      { kind: 'arrow', color: 'blue', from: 'e2', to: 'e4' },
      { kind: 'arrow', color: 'orange', from: 'h2', to: 'h4' },
    ];

    expect(serializeBoardAnnotations(annotations)).toBe('[%csl Ge4,Ra2] [%cal Be2e4,Yh2h4]');
  });
});

describe('updatePgnWithSavedAnnotations', () => {
  it('adds board annotations to the selected move comment', () => {
    const pgn = '1. e4 e5';
    const annotations: SavableBoardAnnotation[] = [
      { kind: 'highlight', color: 'green', square: 'e4' },
      { kind: 'arrow', color: 'blue', from: 'e2', to: 'e4' },
    ];

    expect(updatePgnWithSavedAnnotations(pgn, '0', annotations)).toMatch(
      /1\. e4 \{\s*\[%csl Ge4\] \[%cal Be2e4\]\s*\} e5/,
    );
  });

  it('preserves existing comment text while replacing existing board annotation tags', () => {
    const pgn = '1. e4 {Center [%csl Ge4][%cal Ge2e4]} e5';
    const annotations: SavableBoardAnnotation[] = [
      { kind: 'highlight', color: 'red', square: 'a2' },
      { kind: 'arrow', color: 'orange', from: 'h2', to: 'h4' },
    ];

    expect(updatePgnWithSavedAnnotations(pgn, '0', annotations)).toMatch(
      /1\. e4 \{\s*Center \[%csl Ra2\] \[%cal Yh2h4\]\s*\} e5/,
    );
  });

  it('updates a selected variation move', () => {
    const pgn = '1. e4 e5 2. Nf3 (2. Bc4) Nc6';
    const annotations: SavableBoardAnnotation[] = [
      { kind: 'highlight', color: 'green', square: 'c4' },
    ];

    expect(updatePgnWithSavedAnnotations(pgn, '0.0.1', annotations)).toMatch(
      /\(\s*2\. Bc4 \{\s*\[%csl Gc4\]\s*\}\s*\)/,
    );
  });
});

describe('updateChessBlockWithSavedAnnotations', () => {
  it('updates the PGN content while preserving chess block options', () => {
    const source = `orientation: black
showMoves: true

[Event "Example"]
1. e4 e5`;
    const annotations: SavableBoardAnnotation[] = [
      { kind: 'highlight', color: 'green', square: 'e4' },
    ];

    expect(updateChessBlockWithSavedAnnotations(source, '0', annotations)).toMatch(
      /orientation: black\nshowMoves: true\n\n\[Event "Example"\]\n\n1\. e4 \{\s*\[%csl Ge4\]\s*\} e5/,
    );
  });
});

describe('replaceChessBlockSection', () => {
  it('replaces only the fenced chess block body between code fences', () => {
    const document = `Before
\`\`\`chess
1. e4 e5
\`\`\`
After`;

    expect(replaceChessBlockSection(document, 1, 3, '1. e4 {[%csl Ge4]} e5')).toBe(`Before
\`\`\`chess
1. e4 {[%csl Ge4]} e5
\`\`\`
After`);
  });
});
