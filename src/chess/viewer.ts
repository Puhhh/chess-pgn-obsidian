import {
  boardPiecesFromFen,
  buildNotationRows,
  type BoardAnnotation,
  type BoardPiece,
  type ChessBlockOptions,
  type GameNode,
  type GameState,
  type NotationMove,
  type NotationRow,
  lastMoveSquares,
  nodePath,
} from './block';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PIECE_VIEWBOX = '0 0 64 64';

interface ViewerState {
  currentNodeId: string;
  geometry: BoardGeometry | null;
}

interface SquareParts {
  element: HTMLDivElement;
  piece: HTMLSpanElement;
}

export interface SquareMetrics {
  left: number;
  top: number;
  size: number;
  centerX: number;
  centerY: number;
}

export interface BoardGeometry {
  side: number;
  squareSize: number;
  squares: Record<string, SquareMetrics>;
}

export function quantizeBoardSide(width: number): number {
  if (!Number.isFinite(width) || width <= 0) {
    return 0;
  }

  return Math.floor(width / 8) * 8;
}

export function computeBoardGeometry(squareNames: string[], side: number): BoardGeometry {
  const squareSize = side > 0 ? side / 8 : 0;
  const squares: Record<string, SquareMetrics> = {};

  squareNames.forEach((square, index) => {
    const left = (index % 8) * squareSize;
    const top = Math.floor(index / 8) * squareSize;
    squares[square] = {
      left,
      top,
      size: squareSize,
      centerX: left + squareSize / 2,
      centerY: top + squareSize / 2,
    };
  });

  return { side, squareSize, squares };
}

export class ChessViewer {
  private readonly state: ViewerState;
  private readonly rootEl: HTMLDivElement;
  private readonly contentEl: HTMLDivElement;
  private readonly boardPanelEl: HTMLDivElement;
  private readonly boardFrameEl: HTMLDivElement;
  private readonly boardEl: HTMLDivElement;
  private readonly highlightsEl: HTMLDivElement;
  private readonly arrowsSvg: SVGSVGElement;
  private readonly controlsEl: HTMLDivElement;
  private readonly notationPanelEl: HTMLDivElement;
  private readonly prevButton: HTMLButtonElement;
  private readonly resetButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly squares = new Map<string, SquareParts>();
  private readonly resizeObserver?: ResizeObserver;

  constructor(
    private readonly containerEl: HTMLElement,
    private readonly gameState: GameState,
    private readonly options: ChessBlockOptions,
  ) {
    this.state = {
      currentNodeId: gameState.currentNodeId,
      geometry: null,
    };

    this.rootEl = containerEl.createDiv({ cls: 'chess-pgn-viewer' });
    this.contentEl = this.rootEl.createDiv({ cls: 'chess-pgn-viewer__content' });
    this.boardPanelEl = this.contentEl.createDiv({ cls: 'chess-pgn-viewer__board-panel' });
    if (containerEl.dataset.testWidth) {
      this.boardPanelEl.dataset.testWidth = containerEl.dataset.testWidth;
    }
    this.boardFrameEl = this.boardPanelEl.createDiv({ cls: 'chess-pgn-viewer__board-frame' });
    this.boardEl = this.boardFrameEl.createDiv({ cls: 'chess-pgn-viewer__board' });
    this.highlightsEl = this.boardFrameEl.createDiv({ cls: 'chess-pgn-viewer__annotations' });
    this.arrowsSvg = document.createElementNS(SVG_NS, 'svg');
    this.arrowsSvg.setAttribute('class', 'chess-pgn-viewer__arrows');
    this.boardFrameEl.appendChild(this.arrowsSvg);
    this.controlsEl = this.boardPanelEl.createDiv({ cls: 'chess-pgn-viewer__controls' });
    this.notationPanelEl = this.contentEl.createDiv({ cls: 'chess-pgn-viewer__notation-panel' });

    this.buildBoardShell();
    this.prevButton = this.createControlButton('←', () => this.goPrevious());
    this.resetButton = this.createControlButton('•', () => {
      this.state.currentNodeId = 'root';
      this.render();
    });
    this.nextButton = this.createControlButton('→', () => this.goNext());

    const availableWidth = this.getAvailableBoardWidth();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(entries => {
        const width = entries[0]?.contentRect.width ?? this.getAvailableBoardWidth();
        this.applyBoardGeometry(width);
      });
      this.resizeObserver.observe(this.boardPanelEl);
    } else {
      this.applyBoardGeometry(availableWidth);
    }

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
    for (const square of this.orderedSquares()) {
      const squareEl = this.boardEl.createDiv({ cls: 'chess-pgn-viewer__square' });
      squareEl.toggleClass('is-light', this.isLightSquare(square));
      squareEl.toggleClass('is-dark', !squareEl.hasClass('is-light'));

      if (this.isBottomRankSquare(square)) {
        squareEl.createSpan({ cls: 'chess-pgn-viewer__file-label', text: square[0] ?? '' });
      }
      if (this.isRightFileSquare(square)) {
        squareEl.createSpan({ cls: 'chess-pgn-viewer__rank-label', text: square[1] ?? '' });
      }

      const pieceEl = squareEl.createSpan({ cls: 'chess-pgn-viewer__piece' });
      this.squares.set(square, { element: squareEl, piece: pieceEl });
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
      parts.piece.replaceChildren();

      if (!piece) {
        continue;
      }

      parts.piece.classList.add(`is-${piece.color}`);
      parts.piece.appendChild(createPieceSvg(piece));
    }
  }

  private renderAnnotationState(): void {
    this.highlightsEl.replaceChildren();
    this.arrowsSvg.replaceChildren();

    const geometry = this.state.geometry;
    const annotations = this.currentNode()?.annotations ?? [];
    if (!geometry || geometry.side === 0) {
      return;
    }

    this.arrowsSvg.setAttribute('viewBox', `0 0 ${geometry.side} ${geometry.side}`);
    this.arrowsSvg.setAttribute('width', String(geometry.side));
    this.arrowsSvg.setAttribute('height', String(geometry.side));

    for (const annotation of annotations) {
      if (annotation.kind === 'highlight') {
        const metrics = geometry.squares[annotation.square];
        if (!metrics) {
          continue;
        }

        const highlight = this.highlightsEl.createDiv({
          cls: `chess-pgn-viewer__annotation chess-pgn-viewer__annotation--highlight is-${annotation.color}`,
        });
        this.applySquareBounds(highlight, metrics);
        continue;
      }

      this.renderArrow(annotation, geometry);
    }
  }

  private renderArrow(annotation: Extract<BoardAnnotation, { kind: 'arrow' }>, geometry: BoardGeometry): void {
    const from = geometry.squares[annotation.from];
    const to = geometry.squares[annotation.to];
    if (!from || !to) {
      return;
    }

    const strokeWidth = Math.max(4, Math.round(geometry.squareSize * 0.154));
    const markerSize = Math.max(12, Math.round(geometry.squareSize * 0.42));
    const markerId = `arrowhead-${annotation.color}-${markerSize}`;

    if (!this.arrowsSvg.querySelector(`#${markerId}`)) {
      const defs = this.ensureSvgDefs();
      const marker = document.createElementNS(SVG_NS, 'marker');
      marker.setAttribute('id', markerId);
      marker.setAttribute('markerUnits', 'userSpaceOnUse');
      marker.setAttribute('markerWidth', String(markerSize));
      marker.setAttribute('markerHeight', String(markerSize));
      marker.setAttribute('refX', String(Math.round(markerSize * 0.82)));
      marker.setAttribute('refY', String(markerSize / 2));
      marker.setAttribute('orient', 'auto');

      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute(
        'd',
        `M0,0 L${markerSize},${markerSize / 2} L0,${markerSize} L${markerSize * 0.16},${markerSize / 2} Z`,
      );
      path.setAttribute('class', `chess-pgn-viewer__annotation-head is-${annotation.color}`);
      marker.appendChild(path);
      defs.appendChild(marker);
    }

    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('class', `chess-pgn-viewer__annotation chess-pgn-viewer__annotation--arrow is-${annotation.color}`);
    line.setAttribute('x1', String(from.centerX));
    line.setAttribute('y1', String(from.centerY));
    line.setAttribute('x2', String(to.centerX));
    line.setAttribute('y2', String(to.centerY));
    line.setAttribute('stroke-width', String(strokeWidth));
    line.setAttribute('marker-end', `url(#${markerId})`);
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
    const scrollTop = this.notationPanelEl.scrollTop;
    const scrollLeft = this.notationPanelEl.scrollLeft;
    this.notationPanelEl.empty();

    const headerEntries = Object.entries(this.gameState.headers);
    if (headerEntries.length > 0) {
      const metaEl = this.notationPanelEl.createDiv({ cls: 'chess-pgn-viewer__meta' });
      const title = this.gameState.headers.Event ?? 'Chess study';
      metaEl.createDiv({ cls: 'chess-pgn-viewer__title', text: title });

      const summaryParts = [this.gameState.headers.White, this.gameState.headers.Black].filter(Boolean);
      metaEl.createDiv({
        cls: 'chess-pgn-viewer__summary',
        text: summaryParts.length > 0 ? summaryParts.join(' vs ') : '? vs ?',
      });
    }

    if (!this.options.showMoves) {
      return;
    }

    const movesEl = this.notationPanelEl.createDiv({ cls: 'chess-pgn-viewer__moves' });
    for (const row of buildNotationRows(this.gameState.root)) {
      this.renderNotationRow(movesEl, row);
    }

    this.notationPanelEl.scrollTop = scrollTop;
    this.notationPanelEl.scrollLeft = scrollLeft;
    this.syncActiveMoveVisibility();
  }

  private syncActiveMoveVisibility(): void {
    const activeMove = this.notationPanelEl.querySelector<HTMLElement>('.chess-pgn-viewer__move.is-active');
    if (!activeMove) {
      return;
    }

    const padding = 12;
    const panelRect = this.notationPanelEl.getBoundingClientRect();
    const moveRect = activeMove.getBoundingClientRect();
    const visibleTop = panelRect.top + padding;
    const visibleBottom = panelRect.bottom - padding;

    if (moveRect.top < visibleTop) {
      this.notationPanelEl.scrollTop += moveRect.top - visibleTop;
      return;
    }

    if (moveRect.bottom > visibleBottom) {
      this.notationPanelEl.scrollTop += moveRect.bottom - visibleBottom;
    }
  }

  private renderNotationRow(hostEl: HTMLElement, row: NotationRow): void {
    const rowEl = hostEl.createDiv({ cls: 'chess-pgn-viewer__notation-row' });
    rowEl.createDiv({ cls: 'chess-pgn-viewer__move-number', text: `${row.moveNumber}.` });

    const whiteCell = rowEl.createDiv({ cls: 'chess-pgn-viewer__move-cell is-white' });
    const blackCell = rowEl.createDiv({ cls: 'chess-pgn-viewer__move-cell is-black' });
    this.renderMoveCell(whiteCell, row.white);
    this.renderMoveCell(blackCell, row.black);

    if (this.options.showComments) {
      for (const move of [row.white, row.black]) {
        if (!move?.comment) {
          continue;
        }

        hostEl.createDiv({
          cls: 'chess-pgn-viewer__notation-comment',
          text: move.comment,
        });
      }
    }

    if (this.options.showVariations && row.variations.length > 0) {
      const variationsEl = hostEl.createDiv({ cls: 'chess-pgn-viewer__variation-list' });
      for (const variation of row.variations) {
        const lineEl = variationsEl.createDiv({ cls: 'chess-pgn-viewer__variation-line' });
        lineEl.createSpan({ cls: 'chess-pgn-viewer__variation-bracket', text: '(' });

        variation.moves.forEach((move, index) => {
          this.createMoveButton(lineEl, move, 'chess-pgn-viewer__move chess-pgn-viewer__move--variation');
          if (this.options.showComments && move.comment) {
            lineEl.createSpan({
              cls: 'chess-pgn-viewer__variation-comment',
              text: move.comment,
            });
          }
          if (index < variation.moves.length - 1) {
            lineEl.createSpan({ cls: 'chess-pgn-viewer__variation-separator', text: ' ' });
          }
        });

        lineEl.createSpan({ cls: 'chess-pgn-viewer__variation-bracket', text: ')' });
      }
    }
  }

  private renderMoveCell(hostEl: HTMLElement, move: NotationMove | null): void {
    if (!move) {
      hostEl.createSpan({ cls: 'chess-pgn-viewer__move-placeholder', text: '...' });
      return;
    }

    this.createMoveButton(hostEl, move, 'chess-pgn-viewer__move');
  }

  private createMoveButton(hostEl: HTMLElement, move: NotationMove, cls: string): HTMLButtonElement {
    const toneClass = move.annotation ? ` is-${move.annotation.tone}` : '';
    const button = hostEl.createEl('button', {
      cls: `${cls}${toneClass}`,
      text: move.label,
    });
    button.toggleClass('is-active', this.state.currentNodeId === move.id);
    button.addEventListener('click', () => {
      this.state.currentNodeId = move.id;
      this.render();
    });
    return button;
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

  private applyBoardGeometry(availableWidth: number): void {
    const side = quantizeBoardSide(availableWidth);
    this.state.geometry = computeBoardGeometry([...this.squares.keys()], side);

    this.rootEl.style.setProperty('--board-side', `${side}px`);
    this.boardFrameEl.style.width = `${side}px`;
    this.boardFrameEl.style.height = `${side}px`;
    this.boardEl.style.setProperty('--board-side', `${side}px`);
    this.boardEl.style.setProperty('--square-size', `${this.state.geometry.squareSize}px`);
    this.boardEl.style.width = `${side}px`;
    this.boardEl.style.height = `${side}px`;
    this.highlightsEl.style.width = `${side}px`;
    this.highlightsEl.style.height = `${side}px`;
    this.arrowsSvg.style.width = `${side}px`;
    this.arrowsSvg.style.height = `${side}px`;

    this.renderAnnotationState();
  }

  private getAvailableBoardWidth(): number {
    return (
      this.boardPanelEl.clientWidth ||
      Number(this.boardPanelEl.dataset.testWidth ?? this.containerEl.dataset.testWidth ?? 0)
    );
  }

  private orderedSquares(): string[] {
    const squares: string[] = [];
    const files =
      this.options.orientation === 'white'
        ? ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
        : ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'];
    const ranks = this.options.orientation === 'white' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];

    for (const rank of ranks) {
      for (const file of files) {
        squares.push(`${file}${rank}`);
      }
    }

    return squares;
  }

  private isLightSquare(square: string): boolean {
    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]);
    return (file + rank) % 2 === 1;
  }

  private isBottomRankSquare(square: string): boolean {
    return this.options.orientation === 'white' ? square.endsWith('1') : square.endsWith('8');
  }

  private isRightFileSquare(square: string): boolean {
    return this.options.orientation === 'white' ? square.startsWith('h') : square.startsWith('a');
  }

  private applySquareBounds(el: HTMLElement, metrics: SquareMetrics): void {
    el.style.left = `${metrics.left}px`;
    el.style.top = `${metrics.top}px`;
    el.style.width = `${metrics.size}px`;
    el.style.height = `${metrics.size}px`;
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

function createPieceSvg(piece: BoardPiece): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'chess-pgn-viewer__piece-svg');
  svg.setAttribute('viewBox', PIECE_VIEWBOX);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = PIECE_MARKUP[piece.role];
  return svg;
}

const PIECE_MARKUP: Record<BoardPiece['role'], string> = {
  pawn: `
    <circle class="piece-fill" cx="32" cy="17" r="8"></circle>
    <path class="piece-fill" d="M25 29 C25 24, 39 24, 39 29 C39 34, 36 38, 36 42 L28 42 C28 38, 25 34, 25 29 Z"></path>
    <rect class="piece-fill" x="22" y="42" width="20" height="6" rx="3"></rect>
    <rect class="piece-fill" x="18" y="49" width="28" height="5" rx="2.5"></rect>
  `,
  knight: `
    <path class="piece-fill" d="M22 48 C24 35, 20 30, 30 20 C35 15, 39 14, 42 16 C44 18, 44 22, 42 24 C39 27, 37 28, 37 31 C39 32, 42 34, 44 39 L47 48 Z"></path>
    <circle class="piece-stroke" cx="37.5" cy="21.5" r="1.8"></circle>
    <path class="piece-stroke" d="M29 23 C30 28, 33 31, 38 33"></path>
    <rect class="piece-fill" x="18" y="48" width="30" height="6" rx="3"></rect>
  `,
  bishop: `
    <path class="piece-fill" d="M32 13 L35 18 L32 23 L29 18 Z"></path>
    <path class="piece-fill" d="M27 27 C27 21, 37 21, 37 27 C37 31, 35 34, 33 37 L39 44 L25 44 L31 37 C29 34, 27 31, 27 27 Z"></path>
    <path class="piece-stroke" d="M32 18 L32 34"></path>
    <rect class="piece-fill" x="22" y="44" width="20" height="5" rx="2.5"></rect>
    <rect class="piece-fill" x="18" y="50" width="28" height="4" rx="2"></rect>
  `,
  rook: `
    <rect class="piece-fill" x="21" y="16" width="6" height="8"></rect>
    <rect class="piece-fill" x="29" y="16" width="6" height="8"></rect>
    <rect class="piece-fill" x="37" y="16" width="6" height="8"></rect>
    <rect class="piece-fill" x="22" y="24" width="20" height="18" rx="2"></rect>
    <rect class="piece-fill" x="19" y="42" width="26" height="6" rx="2"></rect>
    <rect class="piece-fill" x="17" y="49" width="30" height="5" rx="2.5"></rect>
  `,
  queen: `
    <circle class="piece-fill" cx="20" cy="18" r="4"></circle>
    <circle class="piece-fill" cx="32" cy="14" r="4"></circle>
    <circle class="piece-fill" cx="44" cy="18" r="4"></circle>
    <path class="piece-fill" d="M18 22 L24 38 L40 38 L46 22 L41 25 L32 20 L23 25 Z"></path>
    <rect class="piece-fill" x="23" y="38" width="18" height="6" rx="3"></rect>
    <rect class="piece-fill" x="19" y="45" width="26" height="5" rx="2.5"></rect>
    <rect class="piece-fill" x="17" y="51" width="30" height="4" rx="2"></rect>
  `,
  king: `
    <path class="piece-stroke" d="M32 10 L32 23"></path>
    <path class="piece-stroke" d="M27 15 L37 15"></path>
    <path class="piece-fill" d="M26 25 C26 20, 38 20, 38 25 C38 29, 35 33, 35 36 L29 36 C29 33, 26 29, 26 25 Z"></path>
    <path class="piece-fill" d="M23 37 C28 35, 36 35, 41 37 L44 45 C37 43, 27 43, 20 45 Z"></path>
    <rect class="piece-fill" x="22" y="45" width="20" height="5" rx="2.5"></rect>
    <rect class="piece-fill" x="18" y="51" width="28" height="4" rx="2"></rect>
  `,
};
