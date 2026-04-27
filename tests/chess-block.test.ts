import { describe, expect, it } from 'vitest';

import {
  buildGameState,
  buildNotationRows,
  parseChessBlock,
} from '../src/chess/block';

describe('parseChessBlock', () => {
  it('extracts options and raw pgn text from a chess block', () => {
    const source = `orientation: black
showMoves: true
showComments: false

[Event "Example"]
1. e4 e5 2. Nf3 Nc6`;

    const block = parseChessBlock(source);

    expect(block.options).toEqual({
      orientation: 'black',
      showMoves: true,
      showComments: false,
      showVariations: true,
    });
    expect(block.pgn).toContain('[Event "Example"]');
    expect(block.warnings).toEqual([]);
  });

  it('preserves unknown keys as warnings without failing', () => {
    const source = `boardSize: large
[Event "Example"]
1. e4`;

    const block = parseChessBlock(source);

    expect(block.options.orientation).toBe('white');
    expect(block.warnings).toEqual(['Unknown option: boardSize']);
  });
});

describe('buildGameState', () => {
  it('builds navigation state with comments and a variation', () => {
    const source = `[Event "Example"]
1. e4 {King pawn opening} e5 2. Nf3 (2. Bc4 {Bishop opening}) Nc6`;

    const state = buildGameState(source);

    expect(state.root.children).toHaveLength(1);
    expect(state.root.children[0]?.san).toBe('e4');
    expect(state.root.children[0]?.comment).toBe('King pawn opening');
    expect(state.root.children[0]?.children[0]?.san).toBe('e5');
    expect(state.root.children[0]?.children[0]?.children[0]?.san).toBe('Nf3');
    expect(state.root.children[0]?.children[0]?.children[0]?.variations[0]?.san).toBe('Bc4');
    expect(state.currentNodeId).toBe('root');
  });

  it('extracts board annotations from PGN comments and removes raw tags from visible text', () => {
    const source = `[Event "Annotated"]
1. e4 {Bridge idea [%csl Ge4][%cal Ge2e4,Gd1h5]} e5`;

    const state = buildGameState(source);
    const firstMove = state.root.children[0];

    expect(firstMove?.comment).toBe('Bridge idea');
    expect(firstMove?.annotations).toHaveLength(3);
    expect(firstMove?.annotations[0]).toMatchObject({
      kind: 'highlight',
      color: 'green',
      square: 'e4',
    });
    expect(firstMove?.annotations[1]).toMatchObject({
      kind: 'arrow',
      color: 'green',
      from: 'e2',
      to: 'e4',
    });
    expect(firstMove?.annotations[2]).toMatchObject({
      kind: 'arrow',
      color: 'green',
      from: 'd1',
      to: 'h5',
    });
  });

  it('keeps visible comments separate while building move rows for mainline and variations', () => {
    const source = `[Event "Study"]
1. e4 {Center [%csl Ge4]} e5 2. Nf3 (2. Bc4 {Bishop line}) Nc6 3. Bb5 a6`;

    const state = buildGameState(source);
    const rows = buildNotationRows(state.root);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      moveNumber: 1,
      white: { san: 'e4', comment: 'Center' },
      black: { san: 'e5' },
    });
    expect(rows[1]).toMatchObject({
      moveNumber: 2,
      white: { san: 'Nf3' },
      black: { san: 'Nc6' },
    });
    expect(rows[1]?.variations).toHaveLength(1);
    expect(rows[1]?.variations[0]?.moves[0]).toMatchObject({
      san: 'Bc4',
      comment: 'Bishop line',
    });
    expect(rows[2]).toMatchObject({
      moveNumber: 3,
      white: { san: 'Bb5' },
      black: { san: 'a6' },
    });
  });

  it('throws a helpful error for invalid pgn', () => {
    expect(() => buildGameState('1. e4 ???')).toThrow(/invalid pgn/i);
  });
});
