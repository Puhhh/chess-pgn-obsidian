import {
  makeComment,
  makePgn,
  emptyHeaders,
  parseComment,
  parsePgn,
  type ChildNode,
  type CommentShape,
  type CommentShapeColor,
  type PgnNodeData,
} from 'chessops/pgn';
import { parseSquare } from 'chessops/util';

import { parseChessBlock } from './block';

export type SavableAnnotationColor = 'green' | 'blue' | 'red' | 'yellow' | 'orange';

export type SavableBoardAnnotation =
  | {
      kind: 'highlight';
      color: SavableAnnotationColor;
      square: string;
    }
  | {
      kind: 'arrow';
      color: SavableAnnotationColor;
      from: string;
      to: string;
    };

export function serializeBoardAnnotations(annotations: SavableBoardAnnotation[]): string {
  const shapes = annotations.map(annotationToShape);
  return makeComment({ shapes });
}

export function updatePgnWithSavedAnnotations(
  pgn: string,
  nodeId: string,
  annotations: SavableBoardAnnotation[],
): string {
  const game = parsePgn(pgn, emptyHeaders)[0];
  if (!game) {
    throw new Error('Cannot save board annotations: no PGN game found');
  }

  const node = findNodeById(game.moves.children, nodeId);
  if (!node) {
    throw new Error(`Cannot save board annotations: move ${nodeId} was not found`);
  }

  const existingComments = node.data.comments ?? [];
  const textParts: string[] = [];
  for (const rawComment of existingComments) {
    const parsed = parseComment(rawComment);
    if (parsed.text.trim()) {
      textParts.push(parsed.text.trim());
    }
  }

  const text = textParts.join('\n\n');
  const comment = makeComment({
    text: text || undefined,
    shapes: annotations.map(annotationToShape),
  });
  node.data.comments = comment ? [comment] : [];

  return makePgn(game);
}

export function updateChessBlockWithSavedAnnotations(
  source: string,
  nodeId: string,
  annotations: SavableBoardAnnotation[],
): string {
  const parsed = parseChessBlock(source);
  if (!parsed.pgn.trim()) {
    throw new Error('Cannot save board annotations: chess block does not contain PGN moves');
  }

  const updatedPgn = updatePgnWithSavedAnnotations(parsed.pgn, nodeId, annotations).trimEnd();
  const pgnStart = source.indexOf(parsed.pgn);
  if (pgnStart < 0) {
    throw new Error('Cannot save board annotations: PGN source was not found in the chess block');
  }

  return `${source.slice(0, pgnStart)}${updatedPgn}${source.slice(pgnStart + parsed.pgn.length)}`;
}

export function replaceChessBlockSection(
  documentText: string,
  lineStart: number,
  lineEnd: number,
  source: string,
): string {
  const lines = documentText.split('\n');
  const firstBodyLine = lineStart + 1;
  const closingFenceLine = lineEnd;
  if (lineStart < 0 || lineEnd <= lineStart || closingFenceLine >= lines.length) {
    throw new Error('Cannot save board annotations: invalid chess block section');
  }

  lines.splice(firstBodyLine, closingFenceLine - firstBodyLine, ...source.split('\n'));
  return lines.join('\n');
}

function findNodeById(
  nodes: ChildNode<PgnNodeData>[],
  nodeId: string,
  path: number[] = [],
): ChildNode<PgnNodeData> | null {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (!node) {
      continue;
    }

    const currentPath = [...path, index];
    if (currentPath.join('.') === nodeId) {
      return node;
    }

    const child = findNodeById(node.children, nodeId, currentPath);
    if (child) {
      return child;
    }
  }

  return null;
}

function annotationToShape(annotation: SavableBoardAnnotation): CommentShape {
  if (annotation.kind === 'highlight') {
    const square = parseAnnotationSquare(annotation.square);
    return {
      color: toCommentShapeColor(annotation.color),
      from: square,
      to: square,
    };
  }

  return {
    color: toCommentShapeColor(annotation.color),
    from: parseAnnotationSquare(annotation.from),
    to: parseAnnotationSquare(annotation.to),
  };
}

function parseAnnotationSquare(square: string): CommentShape['from'] {
  const parsed = parseSquare(square);
  if (parsed === undefined) {
    throw new Error(`Cannot save board annotations: invalid square ${square}`);
  }
  return parsed;
}

function toCommentShapeColor(color: SavableAnnotationColor): CommentShapeColor {
  if (color === 'orange') {
    return 'yellow';
  }

  return color;
}
