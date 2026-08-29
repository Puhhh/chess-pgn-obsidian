import { resolveStartMoveNodeId, type GameState, type StartMove } from './block';

export interface SavedViewerPosition {
  nodeId: string;
  source: string;
}

export interface InitialPositionResolution {
  nodeId?: string;
  discardSavedPosition: boolean;
  unmatchedStartMove: boolean;
}

export function resolveInitialPosition(
  state: GameState,
  source: string,
  startMove: StartMove | undefined,
  savedPosition: SavedViewerPosition | undefined,
): InitialPositionResolution {
  const savedNodeId =
    savedPosition?.source === source && state.nodeIndex.has(savedPosition.nodeId)
      ? savedPosition.nodeId
      : undefined;
  const configuredNodeId = startMove ? resolveStartMoveNodeId(state, startMove) : undefined;

  return {
    nodeId: savedNodeId ?? configuredNodeId,
    discardSavedPosition: savedPosition !== undefined && savedNodeId === undefined,
    unmatchedStartMove: startMove !== undefined && configuredNodeId === undefined,
  };
}
