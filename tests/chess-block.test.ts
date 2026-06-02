import { describe, expect, it } from 'vitest';

import {
  buildGameState,
  buildNotationRows,
  parseChessBlock,
} from '../src/chess/block';

describe('parseChessBlock', () => {
  const fen = 'r2qrbk1/1bp2pp1/p2p1n1p/1p6/Pn1PP3/5N1P/1P1N1PP1/RBBQR1K1 b - - 2 17';

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

  it('extracts explicit fen option without treating it as pgn text', () => {
    const source = `orientation: black
fen: ${fen}`;

    const block = parseChessBlock(source);

    expect(block.options.orientation).toBe('black');
    expect(block.fen).toBe(fen);
    expect(block.pgn).toBe('');
    expect(block.warnings).toEqual([]);
  });
});

describe('buildGameState', () => {
  const fen = 'r2qrbk1/1bp2pp1/p2p1n1p/1p6/Pn1PP3/5N1P/1P1N1PP1/RBBQR1K1 b - - 2 17';

  it('builds a static board state from raw fen input', () => {
    const state = buildGameState('r1bqkbnr/ppp2Qpp/2np4/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4');

    expect(state.mode).toBe('fen');
    expect(state.root.fen).toBe('r1bqkbnr/ppp2Qpp/2np4/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4');
    expect(state.root.children).toHaveLength(0);
    expect(state.currentNodeId).toBe('root');
  });

  it('throws a helpful error for invalid raw fen input', () => {
    expect(() => buildGameState('8/8/8/8/8/8/8/8 w - - 0 1')).toThrow(/invalid fen/i);
  });

  it('builds a static board state from explicit fen option content', () => {
    const block = parseChessBlock(`fen: ${fen}`);
    const state = buildGameState(block.fen ?? block.pgn);

    expect(state.mode).toBe('fen');
    expect(state.root.fen).toBe(fen);
    expect(state.root.children).toHaveLength(0);
  });

  it('builds a static board state from a standalone fen header', () => {
    const state = buildGameState(`[FEN "${fen}"]`);

    expect(state.mode).toBe('fen');
    expect(state.root.fen).toBe(fen);
    expect(state.root.children).toHaveLength(0);
  });

  it('throws a helpful error for an invalid standalone fen header', () => {
    expect(() => buildGameState('[FEN "8/8/8/8/8/8/8/8 w - - 0 1"]')).toThrow(/invalid fen/i);
  });

  it('keeps pgn with a fen header navigable as pgn', () => {
    const state = buildGameState(`[SetUp "1"]
[FEN "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2"]
2. Nf3`);

    expect(state.mode).toBe('pgn');
    expect(state.root.children[0]?.san).toBe('Nf3');
  });

  it('accepts unknown date placeholders in PGN headers', () => {
    const state = buildGameState(`[Event "Training"]
[Date "????.??.??"]
1. e4 e5`);

    expect(state.mode).toBe('pgn');
    expect(state.headers.Date).toBe('????.??.??');
    expect(state.root.children[0]?.san).toBe('e4');
  });

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

  it('parses move annotation glyphs into structured notation metadata', () => {
    const state = buildGameState('1. e4! e5? 2. Nf3!! Nc6?? 3. Bb5!? a6?!');
    const rows = buildNotationRows(state.root);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      white: {
        san: 'e4',
        label: '1. e4!',
        annotation: { glyph: '!', tone: 'good' },
      },
      black: {
        san: 'e5',
        label: '1... e5?',
        annotation: { glyph: '?', tone: 'mistake' },
      },
    });
    expect(rows[1]).toMatchObject({
      white: {
        san: 'Nf3',
        label: '2. Nf3!!',
        annotation: { glyph: '!!', tone: 'brilliant' },
      },
      black: {
        san: 'Nc6',
        label: '2... Nc6??',
        annotation: { glyph: '??', tone: 'blunder' },
      },
    });
    expect(rows[2]).toMatchObject({
      white: {
        san: 'Bb5',
        label: '3. Bb5!?',
        annotation: { glyph: '!?', tone: 'interesting' },
      },
      black: {
        san: 'a6',
        label: '3... a6?!',
        annotation: { glyph: '?!', tone: 'dubious' },
      },
    });
  });

  it('throws a helpful error for invalid pgn', () => {
    expect(() => buildGameState('1. e4 ???')).toThrow(/invalid pgn/i);
  });
});
