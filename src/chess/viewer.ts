import {
  boardPiecesFromFen,
  type BoardAnnotation,
  type ChessBlockOptions,
  type GameNode,
  type GameState,
  lastMoveSquares,
  moveLabel,
  nodePath,
} from './block';

const PIECE_GLYPHS: Record<string, string> = {
  'white-king': '♔',
  'white-queen': '♕',
  'white-rook': '♖',
  'white-bishop': '♗',
  'white-knight': '♘',
  'white-pawn': '♙',
  'black-king': '♚',
  'black-queen': '♛',
  'black-rook': '♜',
  'black-bishop': '♝',
  'black-knight': '♞',
  'black-pawn': '♟',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

interface ViewerState {
  currentNodeId: string;
}

interface SquareParts {
  element: HTMLDivElement;
  piece: HTMLSpanElement;
}

export class ChessViewer {
  private readonly state: ViewerState;
  private readonly rootEl: HTMLDivElement;
  private readonly contentEl: HTMLDivElement;
  private readonly boardPanelEl: HTMLDivElement;
  private readonly boardFrameEl: HTMLDivElement;
  private readonly boardEl: HTMLDivElement;
  private readonly annotationsEl: HTMLDivElement;
  private readonly arrowsSvg: SVGSVGElement;
  private readonly controlsEl: HTMLDivElement;
  private readonly notationPanelEl: HTMLDivElement;
  private readonly prevButton: HTMLButtonElement;
  private readonly resetButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly squares = new Map<string, SquareParts>();

  constructor(
    private readonly containerEl: HTMLElement,
    private readonly gameState: GameState,
    private readonly options: ChessBlockOptions,
  ) {
    this.state = { currentNodeId: gameState.currentNodeId };
    this.rootEl = containerEl.createDiv({ cls: 'chess-pgn-viewer' });
    this.rootEl.toggleClass('is-orientation-black', this.options.orientation === 'black');

    this.contentEl = this.rootEl.createDiv({ cls: 'chess-pgn-viewer__content' });
    this.boardPanelEl = this.contentEl.createDiv({ cls: 'chess-pgn-viewer__board-panel' });
    this.boardFrameEl = this.boardPanelEl.createDiv({ cls: 'chess-pgn-viewer__board-frame' });
    this.boardEl = this.boardFrameEl.createDiv({ cls: 'chess-pgn-viewer__board' });
    this.annotationsEl = this.boardFrameEl.createDiv({ cls: 'chess-pgn-viewer__annotations' });
    this.arrowsSvg = document.createElementNS(SVG_NS, 'svg');
    this.arrowsSvg.setAttribute('class', 'chess-pgn-viewer__arrows');
    this.arrowsSvg.setAttribute('viewBox', '0 0 100 100');
    this.annotationsEl.appendChild(this.arrowsSvg);
    this.controlsEl = this.boardPanelEl.createDiv({ cls: 'chess-pgn-viewer__controls' });
    this.notationPanelEl = this.contentEl.createDiv({ cls: 'chess-pgn-viewer__notation-panel' });

    this.buildBoardShell();
    this.prevButton = this.createControlButton('←', () => this.goPrevious());
    this.resetButton = this.createControlButton('•', () => {
      this.state.currentNodeId = 'root';
      this.render();
    });
    this.nextButton = this.createControlButton('→', () => this.goNext());

    this.render();
  }

  private render(): void {
    this.rootEl.toggleClass('is-orientation-black', this.options.orientation === 'black');
    this.renderBoardState();
    this.renderAnnotationState();
    this.renderControlState();
    this.renderNotation();
  }

  private buildBoardShell(): void {
    const files = this.displayFiles();
    const ranks = this.displayRanks();

    for (const rank of ranks) {
      for (const file of files) {
        const square = `${file}${rank}`;
        const squareEl = this.boardEl.createDiv({ cls: 'chess-pgn-viewer__square' });
        squareEl.toggleClass('is-light', (file.charCodeAt(0) - 97 + rank) % 2 === 1);
        squareEl.toggleClass('is-dark', !squareEl.hasClass('is-light'));

        if (rank === ranks[ranks.length - 1]) {
          squareEl.createSpan({ cls: 'chess-pgn-viewer__file-label', text: file });
        }
        if (file === files[files.length - 1]) {
          squareEl.createSpan({ cls: 'chess-pgn-viewer__rank-label', text: String(rank) });
        }

        const pieceEl = squareEl.createSpan({ cls: 'chess-pgn-viewer__piece' });
        this.squares.set(square, { element: squareEl, piece: pieceEl });
      }
    }
  }

  private renderBoardState(): void {
    const currentNode = this.currentNode();
    const currentFen = currentNode?.fen ?? this.gameState.root.fen;
    const previousFen = this.parentNode(currentNode?.id ?? null)?.fen ?? null;
    const highlightedMove = lastMoveSquares(currentFen, previousFen);
    const pieces = new Map(boardPiecesFromFen(currentFen).map(piece => [piece.square, piece]));

    for (const [square, parts] of this.squares) {
      const piece = pieces.get(square);
      parts.element.toggleClass('is-from', highlightedMove?.from === square);
      parts.element.toggleClass('is-to', highlightedMove?.to === square);
      parts.piece.className = 'chess-pgn-viewer__piece';
      parts.piece.textContent = '';

      if (piece) {
        parts.piece.classList.add(`is-${piece.color}`);
        parts.piece.textContent = PIECE_GLYPHS[`${piece.color}-${piece.role}`] ?? '';
      }
    }
  }

  private renderAnnotationState(): void {
    const currentNode = this.currentNode();
    const annotations = currentNode?.annotations ?? [];

    for (const highlightEl of Array.from(this.annotationsEl.querySelectorAll('.chess-pgn-viewer__annotation--highlight'))) {
      highlightEl.remove();
    }
    this.arrowsSvg.replaceChildren();

    for (const annotation of annotations) {
      if (annotation.kind === 'highlight') {
        const highlight = this.annotationsEl.createDiv({
          cls: `chess-pgn-viewer__annotation chess-pgn-viewer__annotation--highlight is-${annotation.color}`,
        });
        this.positionOverlayBox(highlight, annotation.square, annotation.square, 0.12);
      } else {
        this.renderArrow(annotation);
      }
    }
  }

  private renderArrow(annotation: Extract<BoardAnnotation, { kind: 'arrow' }>): void {
    const line = document.createElementNS(SVG_NS, 'line');
    const from = this.squareCenter(annotation.from);
    const to = this.squareCenter(annotation.to);
    const markerId = `arrowhead-${annotation.color}`;

    line.setAttribute('class', `chess-pgn-viewer__annotation chess-pgn-viewer__annotation--arrow is-${annotation.color}`);
    line.setAttribute('x1', String(from.x));
    line.setAttribute('y1', String(from.y));
    line.setAttribute('x2', String(to.x));
    line.setAttribute('y2', String(to.y));
    line.setAttribute('marker-end', `url(#${markerId})`);

    if (!this.arrowsSvg.querySelector(`#${markerId}`)) {
      const defs = this.ensureSvgDefs();
      const marker = document.createElementNS(SVG_NS, 'marker');
      marker.setAttribute('id', markerId);
      marker.setAttribute('markerWidth', '8');
      marker.setAttribute('markerHeight', '8');
      marker.setAttribute('refX', '6');
      marker.setAttribute('refY', '4');
      marker.setAttribute('orient', 'auto');
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', 'M0,0 L8,4 L0,8 Z');
      path.setAttribute('class', `chess-pgn-viewer__annotation-head is-${annotation.color}`);
      marker.appendChild(path);
      defs.appendChild(marker);
    }

    this.arrowsSvg.appendChild(line);
  }

  private renderControlState(): void {
    const path = nodePath(this.gameState.root, this.state.currentNodeId);
    const canGoBack = path.length > 1;
    const canGoForward = Boolean(this.currentNode()?.children[0] ?? this.gameState.root.children[0]);

    this.prevButton.disabled = !canGoBack;
    this.resetButton.disabled = this.state.currentNodeId === 'root';
    this.nextButton.disabled = !canGoForward;
  }

  private renderNotation(): void {
    this.notationPanelEl.empty();

    const headerEntries = Object.entries(this.gameState.headers);
    if (headerEntries.length > 0) {
      const metaEl = this.notationPanelEl.createDiv({ cls: 'chess-pgn-viewer__meta' });
      const title = this.gameState.headers.Event ?? 'Chess game';
      metaEl.createDiv({ cls: 'chess-pgn-viewer__title', text: title });

      const summaryParts = [this.gameState.headers.White, this.gameState.headers.Black].filter(Boolean);
      if (summaryParts.length > 0) {
        metaEl.createDiv({ cls: 'chess-pgn-viewer__summary', text: summaryParts.join(' vs ') });
      }
    }

    if (!this.options.showMoves) {
      return;
    }

    const movesEl = this.notationPanelEl.createDiv({ cls: 'chess-pgn-viewer__moves' });
    for (const rootNode of this.gameState.root.children) {
      this.renderMoveBranch(movesEl, rootNode, 0);
    }
  }

  private renderMoveBranch(hostEl: HTMLElement, node: GameNode, depth: number): void {
    const lineEl = hostEl.createDiv({ cls: 'chess-pgn-viewer__line' });
    lineEl.style.setProperty('--variation-depth', String(depth));

    const moveRowEl = lineEl.createDiv({
      cls: depth === 0 ? 'chess-pgn-viewer__move-row' : 'chess-pgn-viewer__move-row is-variation',
    });
    if (depth > 0) {
      moveRowEl.createSpan({ cls: 'chess-pgn-viewer__variation-paren', text: '(' });
    }

    const moveButton = moveRowEl.createEl('button', {
      cls: 'chess-pgn-viewer__move',
      text: moveLabel(node),
    });
    moveButton.toggleClass('is-active', this.state.currentNodeId === node.id);
    moveButton.addEventListener('click', () => {
      this.state.currentNodeId = node.id;
      this.render();
    });

    if (depth > 0) {
      moveRowEl.createSpan({ cls: 'chess-pgn-viewer__variation-paren', text: ')' });
    }

    if (this.options.showComments && node.comment) {
      lineEl.createDiv({ cls: depth === 0 ? 'chess-pgn-viewer__comment' : 'chess-pgn-viewer__comment is-variation', text: node.comment });
    }

    if (this.options.showVariations && node.variations.length > 0) {
      const variationListEl = lineEl.createDiv({ cls: 'chess-pgn-viewer__variations' });
      for (const variation of node.variations) {
        const variationEl = variationListEl.createDiv({ cls: 'chess-pgn-viewer__variation' });
        this.renderMoveBranch(variationEl, variation, depth + 1);
      }
    }

    for (const child of node.children) {
      this.renderMoveBranch(hostEl, child, depth);
    }
  }

  private createControlButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = this.controlsEl.createEl('button', {
      cls: 'chess-pgn-viewer__control',
      text: label,
    });
    button.addEventListener('click', onClick);
    return button;
  }

  private currentNode(): GameNode | undefined {
    return this.gameState.nodeIndex.get(this.state.currentNodeId);
  }

  private parentNode(nodeId: string | null): GameNode | undefined {
    if (!nodeId || nodeId === 'root') {
      return undefined;
    }

    const path = nodePath(this.gameState.root, nodeId);
    const parentId = path[path.length - 2];
    return parentId ? this.gameState.nodeIndex.get(parentId) : undefined;
  }

  private goPrevious(): void {
    const path = nodePath(this.gameState.root, this.state.currentNodeId);
    const previousId = path[path.length - 2];
    if (!previousId) {
      return;
    }

    this.state.currentNodeId = previousId;
    this.render();
  }

  private goNext(): void {
    const currentNode = this.currentNode();
    const nextId = currentNode?.children[0]?.id ?? this.gameState.root.children[0]?.id;
    if (!nextId) {
      return;
    }

    this.state.currentNodeId = nextId;
    this.render();
  }

  private displayFiles(): string[] {
    return this.options.orientation === 'white'
      ? ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
      : ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'];
  }

  private displayRanks(): number[] {
    return this.options.orientation === 'white'
      ? [8, 7, 6, 5, 4, 3, 2, 1]
      : [1, 2, 3, 4, 5, 6, 7, 8];
  }

  private squareCenter(square: string): { x: number; y: number } {
    const box = this.squareBox(square);
    return {
      x: box.left + box.size / 2,
      y: box.top + box.size / 2,
    };
  }

  private positionOverlayBox(el: HTMLElement, fromSquare: string, toSquare: string, insetRatio = 0): void {
    const from = this.squareBox(fromSquare);
    const to = this.squareBox(toSquare);
    const left = Math.min(from.left, to.left);
    const top = Math.min(from.top, to.top);
    const right = Math.max(from.left + from.size, to.left + to.size);
    const bottom = Math.max(from.top + from.size, to.top + to.size);
    const inset = from.size * insetRatio;

    el.style.left = `${left + inset}%`;
    el.style.top = `${top + inset}%`;
    el.style.width = `${right - left - inset * 2}%`;
    el.style.height = `${bottom - top - inset * 2}%`;
  }

  private squareBox(square: string): { left: number; top: number; size: number } {
    const fileIndex = square.charCodeAt(0) - 97;
    const rankIndex = Number(square[1]) - 1;
    const displayFile = this.options.orientation === 'white' ? fileIndex : 7 - fileIndex;
    const displayRank = this.options.orientation === 'white' ? 7 - rankIndex : rankIndex;
    const size = 12.5;

    return {
      left: displayFile * size,
      top: displayRank * size,
      size,
    };
  }

  private ensureSvgDefs(): SVGDefsElement {
    let defs = this.arrowsSvg.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS(SVG_NS, 'defs');
      this.arrowsSvg.appendChild(defs);
    }
    return defs;
  }
}
