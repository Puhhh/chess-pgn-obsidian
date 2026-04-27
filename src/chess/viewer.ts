import {
  boardPiecesFromFen,
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

interface ViewerState {
  currentNodeId: string;
}

export class ChessViewer {
  private readonly state: ViewerState;
  private readonly rootEl: HTMLElement;

  constructor(
    private readonly containerEl: HTMLElement,
    private readonly gameState: GameState,
    private readonly options: ChessBlockOptions,
  ) {
    this.state = { currentNodeId: gameState.currentNodeId };
    this.rootEl = containerEl.createDiv({ cls: 'chess-pgn-viewer' });
    this.render();
  }

  private render(): void {
    this.rootEl.empty();
    this.rootEl.toggleClass('is-orientation-black', this.options.orientation === 'black');

    const contentEl = this.rootEl.createDiv({ cls: 'chess-pgn-viewer__content' });
    const boardPanelEl = contentEl.createDiv({ cls: 'chess-pgn-viewer__board-panel' });
    const notationPanelEl = contentEl.createDiv({ cls: 'chess-pgn-viewer__notation-panel' });

    this.renderBoard(boardPanelEl);
    this.renderControls(boardPanelEl);
    this.renderNotation(notationPanelEl);
  }

  private renderBoard(hostEl: HTMLElement): void {
    const currentNode = this.currentNode();
    const currentFen = currentNode?.fen ?? this.gameState.root.fen;
    const previousFen = this.parentNode(currentNode?.id ?? null)?.fen ?? null;
    const highlightedMove = lastMoveSquares(currentFen, previousFen);
    const pieces = boardPiecesFromFen(currentFen);
    const pieceMap = new Map(pieces.map(piece => [piece.square, piece]));

    const boardEl = hostEl.createDiv({ cls: 'chess-pgn-viewer__board' });
    const files = this.options.orientation === 'white' ? ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] : ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'];
    const ranks = this.options.orientation === 'white' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];

    for (const rank of ranks) {
      for (const file of files) {
        const square = `${file}${rank}`;
        const squareEl = boardEl.createDiv({ cls: 'chess-pgn-viewer__square' });
        squareEl.toggleClass('is-light', (file.charCodeAt(0) - 97 + rank) % 2 === 1);
        squareEl.toggleClass('is-dark', !squareEl.hasClass('is-light'));
        squareEl.toggleClass('is-from', highlightedMove?.from === square);
        squareEl.toggleClass('is-to', highlightedMove?.to === square);

        if (rank === ranks[ranks.length - 1]) {
          squareEl.createSpan({ cls: 'chess-pgn-viewer__file-label', text: file });
        }
        if (file === files[files.length - 1]) {
          squareEl.createSpan({ cls: 'chess-pgn-viewer__rank-label', text: String(rank) });
        }

        const piece = pieceMap.get(square);
        if (piece) {
          squareEl.createSpan({
            cls: `chess-pgn-viewer__piece is-${piece.color}`,
            text: PIECE_GLYPHS[`${piece.color}-${piece.role}`] ?? '',
          });
        }
      }
    }
  }

  private renderControls(hostEl: HTMLElement): void {
    const controlsEl = hostEl.createDiv({ cls: 'chess-pgn-viewer__controls' });
    const path = nodePath(this.gameState.root, this.state.currentNodeId);
    const canGoBack = path.length > 1;
    const canGoForward = Boolean(this.currentNode()?.children[0] ?? this.gameState.root.children[0]);

    const prevButton = controlsEl.createEl('button', {
      cls: 'chess-pgn-viewer__control',
      text: '←',
    });
    prevButton.disabled = !canGoBack;
    prevButton.addEventListener('click', () => this.goPrevious());

    const resetButton = controlsEl.createEl('button', {
      cls: 'chess-pgn-viewer__control',
      text: '•',
    });
    resetButton.disabled = this.state.currentNodeId === 'root';
    resetButton.addEventListener('click', () => {
      this.state.currentNodeId = 'root';
      this.render();
    });

    const nextButton = controlsEl.createEl('button', {
      cls: 'chess-pgn-viewer__control',
      text: '→',
    });
    nextButton.disabled = !canGoForward;
    nextButton.addEventListener('click', () => this.goNext());
  }

  private renderNotation(hostEl: HTMLElement): void {
    const headerEntries = Object.entries(this.gameState.headers);
    if (headerEntries.length > 0) {
      const metaEl = hostEl.createDiv({ cls: 'chess-pgn-viewer__meta' });
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

    const movesEl = hostEl.createDiv({ cls: 'chess-pgn-viewer__moves' });
    for (const rootNode of this.gameState.root.children) {
      this.renderMoveBranch(movesEl, rootNode, 0);
    }
  }

  private renderMoveBranch(hostEl: HTMLElement, node: GameNode, depth: number): void {
    const lineEl = hostEl.createDiv({ cls: 'chess-pgn-viewer__line' });
    lineEl.style.setProperty('--variation-depth', String(depth));

    const moveButton = lineEl.createEl('button', {
      cls: 'chess-pgn-viewer__move',
      text: moveLabel(node),
    });
    moveButton.toggleClass('is-active', this.state.currentNodeId === node.id);
    moveButton.addEventListener('click', () => {
      this.state.currentNodeId = node.id;
      this.render();
    });

    if (this.options.showComments && node.comment) {
      const commentEl = lineEl.createDiv({ cls: 'chess-pgn-viewer__comment', text: node.comment });
      commentEl.toggleClass('is-inline', depth > 0);
    }

    if (this.options.showVariations && node.variations.length > 0) {
      const variationListEl = lineEl.createDiv({ cls: 'chess-pgn-viewer__variations' });
      for (const variation of node.variations) {
        const variationEl = variationListEl.createDiv({ cls: 'chess-pgn-viewer__variation' });
        variationEl.createSpan({ cls: 'chess-pgn-viewer__variation-paren', text: '(' });
        this.renderMoveBranch(variationEl, variation, depth + 1);
        variationEl.createSpan({ cls: 'chess-pgn-viewer__variation-paren', text: ')' });
      }
    }

    for (const child of node.children) {
      this.renderMoveBranch(hostEl, child, depth);
    }
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
}
