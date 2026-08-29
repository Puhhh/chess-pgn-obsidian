import { describe, expect, it } from 'vitest';

import { buildGameState } from '../src/chess/block';
import { resolveInitialPosition } from '../src/chess/initial-position';

describe('resolveInitialPosition', () => {
  const source = 'startMove: 2\n1. e4 e5 2. Nf3 Nc6';

  it('uses a valid saved position for an unchanged block source', () => {
    const state = buildGameState('1. e4 e5 2. Nf3 Nc6');
    const result = resolveInitialPosition(
      state,
      source,
      { moveNumber: 2, color: 'white' },
      { nodeId: '0.0', source },
    );

    expect(result).toEqual({
      nodeId: '0.0',
      discardSavedPosition: false,
      unmatchedStartMove: false,
    });
  });

  it('discards a saved position after the block source changes and honors startMove', () => {
    const state = buildGameState('1. e4 e5 2. Nf3 Nc6');
    const result = resolveInitialPosition(
      state,
      source,
      { moveNumber: 2, color: 'black' },
      { nodeId: '0.0', source: 'startMove: 1\n1. e4 e5 2. Nf3 Nc6' },
    );

    expect(result).toEqual({
      nodeId: '0.0.0.0',
      discardSavedPosition: true,
      unmatchedStartMove: false,
    });
  });

  it('falls back to the root state when startMove is missing from the main line', () => {
    const state = buildGameState('1. e4 e5');

    expect(resolveInitialPosition(state, source, { moveNumber: 9, color: 'white' }, undefined)).toEqual({
      nodeId: undefined,
      discardSavedPosition: false,
      unmatchedStartMove: true,
    });
  });
});
