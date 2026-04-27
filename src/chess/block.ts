import { makeFen } from 'chessops/fen';
import type { Position } from 'chessops/chess';
import {
  type ChildNode,
  type Game,
  type PgnNodeData,
  parsePgn,
  startingPosition,
} from 'chessops/pgn';
import { parseSan } from 'chessops/san';
import { makeSquare } from 'chessops/util';

export type Orientation = 'white' | 'black';

export interface ChessBlockOptions {
  orientation: Orientation;
  showMoves: boolean;
  showComments: boolean;
  showVariations: boolean;
}

export interface ParsedChessBlock {
  options: ChessBlockOptions;
  pgn: string;
  warnings: string[];
}

export interface BoardPiece {
  square: string;
  color: 'white' | 'black';
  role: 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';
}

export interface GameNode {
  id: string;
  san: string | null;
  ply: number;
  moveNumber: number | null;
  color: 'white' | 'black' | null;
  fen: string;
  comment: string | null;
  children: GameNode[];
  variations: GameNode[];
}

export interface GameState {
  headers: Record<string, string>;
  root: GameNode;
  currentNodeId: string;
  nodeIndex: Map<string, GameNode>;
}

const DEFAULT_OPTIONS: ChessBlockOptions = {
  orientation: 'white',
  showMoves: true,
  showComments: true,
  showVariations: true,
};

const BOOLEAN_OPTIONS = new Set(['showMoves', 'showComments', 'showVariations']);

export function parseChessBlock(source: string): ParsedChessBlock {
  const lines = source.replace(/\r/g, '').split('\n');
  const options: ChessBlockOptions = { ...DEFAULT_OPTIONS };
  const warnings: string[] = [];
  const pgnLines: string[] = [];
  let readingOptions = true;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed && readingOptions) {
      continue;
    }

    if (readingOptions) {
      const optionMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.+)$/);
      if (optionMatch && !trimmed.startsWith('[')) {
        const [, rawKey, rawValue] = optionMatch;
        const key = rawKey as keyof ChessBlockOptions;
        const value = rawValue.trim();

        if (key === 'orientation') {
          if (value === 'white' || value === 'black') {
            options.orientation = value;
          } else {
            warnings.push(`Invalid orientation: ${value}`);
          }
          continue;
        }

        if (BOOLEAN_OPTIONS.has(rawKey)) {
          if (value === 'true' || value === 'false') {
            options[key] = value === 'true' as never;
          } else {
            warnings.push(`Invalid boolean option: ${rawKey}`);
          }
          continue;
        }

        warnings.push(`Unknown option: ${rawKey}`);
        continue;
      }
    }

    readingOptions = false;
    pgnLines.push(line);
  }

  return {
    options,
    pgn: pgnLines.join('\n').trim(),
    warnings,
  };
}

export function buildGameState(pgn: string): GameState {
  const trimmed = pgn.trim();
  if (!trimmed) {
    throw new Error('Invalid PGN: empty input');
  }

  const parsedGames = parsePgn(trimmed);
  const game = parsedGames[0];
  if (!game) {
    throw new Error('Invalid PGN: no game found');
  }

  const position = startingPosition(game.headers).unwrap(
    pos => pos,
    error => {
      throw new Error(`Invalid PGN: ${error.message}`);
    },
  );

  const root: GameNode = {
    id: 'root',
    san: null,
    ply: 0,
    moveNumber: null,
    color: null,
    fen: makeFen(position.toSetup()),
    comment: joinComments(game.comments),
    children: [],
    variations: [],
  };

  const nodeIndex = new Map<string, GameNode>([['root', root]]);
  root.children = buildMainlineBranch({
    pgnNode: game.moves,
    position,
    nodeIndex,
    path: [],
    ply: 0,
  });

  if (!root.children.length) {
    throw new Error('Invalid PGN: no playable moves found');
  }

  // chessops skips syntactically invalid tokens, so add a small guard for
  // obviously broken notation that produced a truncated game tree.
  if (trimmed.includes('???')) {
    throw new Error('Invalid PGN: unsupported token near ???');
  }

  return {
    headers: Object.fromEntries(game.headers.entries()),
    root,
    currentNodeId: 'root',
    nodeIndex,
  };
}

export function boardPiecesFromFen(fen: string): BoardPiece[] {
  const boardPart = fen.split(' ')[0];
  if (!boardPart) {
    return [];
  }

  const pieces: BoardPiece[] = [];
  const ranks = boardPart.split('/');
  let rank = 8;

  for (const rankPart of ranks) {
    let file = 0;
    for (const symbol of rankPart) {
      const empty = Number(symbol);
      if (!Number.isNaN(empty)) {
        file += empty;
        continue;
      }

      const color = symbol === symbol.toUpperCase() ? 'white' : 'black';
      const normalized = symbol.toLowerCase();
      const role = toRole(normalized);
      if (!role) {
        file += 1;
        continue;
      }

      pieces.push({
        square: `${String.fromCharCode(97 + file)}${rank}`,
        color,
        role,
      });
      file += 1;
    }
    rank -= 1;
  }

  return pieces;
}

interface BuildBranchContext {
  pgnNode: { children: ChildNode<PgnNodeData>[] };
  position: Position;
  nodeIndex: Map<string, GameNode>;
  path: number[];
  ply: number;
}

function buildMainlineBranch(context: BuildBranchContext): GameNode[] {
  const [mainline, ...siblings] = context.pgnNode.children;
  if (!mainline) {
    return [];
  }

  const node = buildNode(mainline, context.position, context.nodeIndex, [...context.path, 0], context.ply);
  node.variations = siblings.map((variation, index) =>
    buildNode(variation, context.position.clone(), context.nodeIndex, [...context.path, index + 1], context.ply),
  );

  return [node];
}

function buildNode(
  pgnNode: ChildNode<PgnNodeData>,
  position: BuildBranchContext['position'],
  nodeIndex: Map<string, GameNode>,
  path: number[],
  ply: number,
): GameNode {
  const move = parseSan(position, pgnNode.data.san);
  if (!move) {
    throw new Error(`Invalid PGN: illegal or unrecognized move "${pgnNode.data.san}"`);
  }

  const nextPosition = position.clone();
  nextPosition.play(move);

  const node: GameNode = {
    id: path.join('.'),
    san: pgnNode.data.san,
    ply: ply + 1,
    moveNumber: Math.floor(ply / 2) + 1,
    color: ply % 2 === 0 ? 'white' : 'black',
    fen: makeFen(nextPosition.toSetup()),
    comment: joinComments([...(pgnNode.data.startingComments ?? []), ...(pgnNode.data.comments ?? [])]),
    children: [],
    variations: [],
  };

  nodeIndex.set(node.id, node);

  node.children = buildMainlineBranch({
    pgnNode,
    position: nextPosition,
    nodeIndex,
    path,
    ply: ply + 1,
  });

  return node;
}

function joinComments(comments: string[] | undefined): string | null {
  if (!comments || comments.length === 0) {
    return null;
  }

  const normalized = comments.map(comment => comment.trim()).filter(Boolean);
  return normalized.length ? normalized.join('\n\n') : null;
}

function toRole(symbol: string): BoardPiece['role'] | null {
  switch (symbol) {
    case 'p':
      return 'pawn';
    case 'n':
      return 'knight';
    case 'b':
      return 'bishop';
    case 'r':
      return 'rook';
    case 'q':
      return 'queen';
    case 'k':
      return 'king';
    default:
      return null;
  }
}

export function moveLabel(node: GameNode): string {
  if (!node.san || !node.moveNumber || !node.color) {
    return '';
  }

  return node.color === 'white' ? `${node.moveNumber}. ${node.san}` : `${node.moveNumber}... ${node.san}`;
}

export function lastMoveSquares(currentFen: string, previousFen: string | null): { from: string; to: string } | null {
  if (!previousFen) {
    return null;
  }

  const current = boardPiecesFromFen(currentFen);
  const previous = boardPiecesFromFen(previousFen);
  const previousMap = new Map(previous.map(piece => [piece.square, `${piece.color}-${piece.role}`]));
  const currentMap = new Map(current.map(piece => [piece.square, `${piece.color}-${piece.role}`]));

  const removed = previous.filter(piece => !currentMap.has(piece.square) || currentMap.get(piece.square) !== `${piece.color}-${piece.role}`);
  const added = current.filter(piece => !previousMap.has(piece.square) || previousMap.get(piece.square) !== `${piece.color}-${piece.role}`);

  if (!removed.length || !added.length) {
    return null;
  }

  const from = removed.find(piece => added.some(candidate => candidate.color === piece.color && candidate.role === piece.role));
  const to = added.find(piece => from && piece.color === from.color && piece.role === from.role);

  if (!from || !to) {
    return null;
  }

  return { from: from.square, to: to.square };
}

export function mainlineNodes(root: GameNode): GameNode[] {
  const nodes: GameNode[] = [];
  let cursor = root.children[0];
  while (cursor) {
    nodes.push(cursor);
    cursor = cursor.children[0];
  }
  return nodes;
}

export function nodePath(root: GameNode, targetId: string): string[] {
  const path: string[] = [];
  if (collectNodePath(root, targetId, path)) {
    return path;
  }
  return [];
}

function collectNodePath(node: GameNode, targetId: string, path: string[]): boolean {
  path.push(node.id);
  if (node.id === targetId) {
    return true;
  }

  for (const child of [...node.children, ...node.variations]) {
    if (collectNodePath(child, targetId, path)) {
      return true;
    }
  }

  path.pop();
  return false;
}

export function squareNameFromIndex(square: number): string {
  return makeSquare(square);
}
