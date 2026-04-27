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

interface SquareParts {
  element: HTMLDivElement;
  piece: HTMLSpanElement;
}

export class ChessViewer {
  private readonly state: ViewerState;
  private readonly rootEl: HTMLDivElement;
  private readonly contentEl: HTMLDivElement;
  private readonly boardPanelEl: HTMLDivElement;
  private readonly boardEl: HTMLDivElement;
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
    this.boardEl = this.boardPanelEl.createDiv({ cls: 'chess-pgn-viewer__board' });
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
    this.renderControlState();
    this.renderNotation();
  }

  private buildBoardShell(): void {
    const files = this.options.orientation === 'white'
      ? ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
      : ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'];
    const ranks = this.options.orientation === 'white'
      ? [8, 7, 6, 5, 4, 3, 2, 1]
      : [1, 2, 3, 4, 5, 6, 7, 8];

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
}
