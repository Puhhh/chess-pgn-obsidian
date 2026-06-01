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
interface ViewerState {
  currentNodeId: string;
  geometry: BoardGeometry | null;
}

interface SquareParts {
  element: HTMLDivElement;
  piece: HTMLSpanElement;
}

type TemporaryAnnotationColor = 'green' | 'blue' | 'red' | 'orange';

type TemporaryBoardAnnotation =
  | {
      kind: 'highlight';
      color: TemporaryAnnotationColor;
      square: string;
    }
  | {
      kind: 'arrow';
      color: TemporaryAnnotationColor;
      from: string;
      to: string;
    };

interface PendingTemporaryAnnotation {
  square: string;
  color: TemporaryAnnotationColor;
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
  private readonly moveGlyphsEl: HTMLDivElement;
  private readonly arrowsSvg: SVGSVGElement;
  private readonly controlsEl?: HTMLDivElement;
  private readonly notationPanelEl?: HTMLDivElement;
  private readonly prevButton?: HTMLButtonElement;
  private readonly resetButton?: HTMLButtonElement;
  private readonly nextButton?: HTMLButtonElement;
  private readonly squares = new Map<string, SquareParts>();
  private readonly temporaryAnnotations: TemporaryBoardAnnotation[] = [];
  private pendingTemporaryAnnotation: PendingTemporaryAnnotation | null = null;
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
    this.moveGlyphsEl = this.boardFrameEl.createDiv({ cls: 'chess-pgn-viewer__move-glyphs' });
    this.arrowsSvg = containerEl.ownerDocument.createElementNS(SVG_NS, 'svg');
    this.arrowsSvg.setAttribute('class', 'chess-pgn-viewer__arrows');
    this.boardFrameEl.appendChild(this.arrowsSvg);

    this.buildBoardShell();
    this.bindTemporaryAnnotationEvents();
    if (this.gameState.mode === 'pgn') {
      this.controlsEl = this.boardPanelEl.createDiv({ cls: 'chess-pgn-viewer__controls' });
      this.notationPanelEl = this.contentEl.createDiv({ cls: 'chess-pgn-viewer__notation-panel' });
      this.prevButton = this.createControlButton('←', () => this.goPrevious());
      this.resetButton = this.createControlButton('•', () => {
        this.state.currentNodeId = 'root';
        this.render();
      });
      this.nextButton = this.createControlButton('→', () => this.goNext());
    }

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
    this.rootEl.toggleClass('is-mode-fen', this.gameState.mode === 'fen');
    this.renderBoardState();
    this.renderAnnotationState();
    this.renderControlState();
    this.renderNotation();
  }

  private buildBoardShell(): void {
    for (const square of this.orderedSquares()) {
      const squareEl = this.boardEl.createDiv({ cls: 'chess-pgn-viewer__square' });
      squareEl.dataset.square = square;
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
    this.moveGlyphsEl.replaceChildren();
    this.arrowsSvg.replaceChildren();

    const geometry = this.state.geometry;
    const currentNode = this.currentNode();
    const annotations = currentNode?.annotations ?? [];
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

    for (const annotation of this.temporaryAnnotations) {
      if (annotation.kind === 'highlight') {
        const metrics = geometry.squares[annotation.square];
        if (!metrics) {
          continue;
        }

        const highlight = this.highlightsEl.createDiv({
          cls: `chess-pgn-viewer__annotation chess-pgn-viewer__annotation--highlight chess-pgn-viewer__annotation--temporary-highlight is-${annotation.color}`,
        });
        this.applySquareBounds(highlight, metrics);
        continue;
      }

      this.renderArrow(annotation, geometry, 'temporary');
    }

    this.renderMoveGlyph(currentNode, geometry);
  }

  private renderMoveGlyph(currentNode: GameNode | null, geometry: BoardGeometry): void {
    if (!currentNode?.annotation) {
      return;
    }

    const previousFen = this.parentNode(currentNode.id)?.fen ?? null;
    const destinationSquare = lastMoveSquares(currentNode.fen, previousFen)?.to;
    const metrics = destinationSquare ? geometry.squares[destinationSquare] : null;
    if (!metrics) {
      return;
    }

    const glyph = this.moveGlyphsEl.createDiv({
      cls: `chess-pgn-viewer__move-glyph is-${currentNode.annotation.tone}`,
    });
    glyph.createSpan({ cls: 'chess-pgn-viewer__move-glyph-label', text: currentNode.annotation.glyph });
    this.applySquareBounds(glyph, metrics);
  }

  private renderArrow(
    annotation: Extract<BoardAnnotation | TemporaryBoardAnnotation, { kind: 'arrow' }>,
    geometry: BoardGeometry,
    variant: 'pgn' | 'temporary' = 'pgn',
  ): void {
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
      const marker = this.arrowsSvg.ownerDocument.createElementNS(SVG_NS, 'marker');
      marker.setAttribute('id', markerId);
      marker.setAttribute('markerUnits', 'userSpaceOnUse');
      marker.setAttribute('markerWidth', String(markerSize));
      marker.setAttribute('markerHeight', String(markerSize));
      marker.setAttribute('refX', String(Math.round(markerSize * 0.82)));
      marker.setAttribute('refY', String(markerSize / 2));
      marker.setAttribute('orient', 'auto');

      const path = this.arrowsSvg.ownerDocument.createElementNS(SVG_NS, 'path');
      path.setAttribute(
        'd',
        `M0,0 L${markerSize},${markerSize / 2} L0,${markerSize} L${markerSize * 0.16},${markerSize / 2} Z`,
      );
      path.setAttribute('class', `chess-pgn-viewer__annotation-head is-${annotation.color}`);
      marker.appendChild(path);
      defs.appendChild(marker);
    }

    const line = this.arrowsSvg.ownerDocument.createElementNS(SVG_NS, 'line');
    line.setAttribute(
      'class',
      [
        'chess-pgn-viewer__annotation',
        'chess-pgn-viewer__annotation--arrow',
        variant === 'temporary' ? 'chess-pgn-viewer__annotation--temporary-arrow' : '',
        `is-${annotation.color}`,
      ]
        .filter(Boolean)
        .join(' '),
    );
    line.setAttribute('x1', String(from.centerX));
    line.setAttribute('y1', String(from.centerY));
    line.setAttribute('x2', String(to.centerX));
    line.setAttribute('y2', String(to.centerY));
    line.setAttribute('stroke-width', String(strokeWidth));
    line.setAttribute('marker-end', `url(#${markerId})`);
    this.arrowsSvg.appendChild(line);
  }

  private bindTemporaryAnnotationEvents(): void {
    this.boardEl.addEventListener('contextmenu', event => {
      event.preventDefault();
    });

    this.boardEl.addEventListener('mousedown', event => {
      if (!this.isTemporaryAnnotationMouseEvent(event)) {
        return;
      }

      const square = this.squareFromEvent(event);
      if (!square) {
        return;
      }

      event.preventDefault();
      this.pendingTemporaryAnnotation = {
        square,
        color: this.temporaryAnnotationColor(event),
      };
    });

    this.boardEl.addEventListener('mouseup', event => {
      if (!this.pendingTemporaryAnnotation || !this.isTemporaryAnnotationMouseUpEvent(event)) {
        return;
      }

      const toSquare = this.squareFromEvent(event);
      const pending = this.pendingTemporaryAnnotation;
      this.pendingTemporaryAnnotation = null;
      if (!toSquare) {
        return;
      }

      event.preventDefault();
      if (toSquare === pending.square) {
        this.toggleTemporaryAnnotation({
          kind: 'highlight',
          color: pending.color,
          square: toSquare,
        });
      } else {
        this.toggleTemporaryAnnotation({
          kind: 'arrow',
          color: pending.color,
          from: pending.square,
          to: toSquare,
        });
      }
    });
  }

  private isTemporaryAnnotationMouseEvent(event: MouseEvent): boolean {
    return event.button === 2 || (event.button === 0 && event.ctrlKey);
  }

  private isTemporaryAnnotationMouseUpEvent(event: MouseEvent): boolean {
    return event.button === 2 || event.button === 0;
  }

  private squareFromEvent(event: MouseEvent): string | null {
    const target = event.target instanceof Element ? event.target : null;
    const squareEl = target?.closest<HTMLElement>('.chess-pgn-viewer__square');
    return squareEl?.dataset.square ?? null;
  }

  private temporaryAnnotationColor(event: MouseEvent): TemporaryAnnotationColor {
    if (event.ctrlKey && (event.altKey || event.metaKey)) {
      return 'orange';
    }

    if (event.ctrlKey) {
      return 'red';
    }

    if (event.metaKey || event.altKey) {
      return 'blue';
    }

    return 'green';
  }

  private toggleTemporaryAnnotation(annotation: TemporaryBoardAnnotation): void {
    const index = this.temporaryAnnotations.findIndex(existing => this.sameTemporaryAnnotation(existing, annotation));
    if (index >= 0) {
      this.temporaryAnnotations.splice(index, 1);
    } else {
      this.temporaryAnnotations.push(annotation);
    }

    this.renderAnnotationState();
  }

  private sameTemporaryAnnotation(left: TemporaryBoardAnnotation, right: TemporaryBoardAnnotation): boolean {
    if (left.kind !== right.kind || left.color !== right.color) {
      return false;
    }

    if (left.kind === 'highlight' && right.kind === 'highlight') {
      return left.square === right.square;
    }

    if (left.kind === 'arrow' && right.kind === 'arrow') {
      return left.from === right.from && left.to === right.to;
    }

    return false;
  }

  private renderControlState(): void {
    if (!this.prevButton || !this.resetButton || !this.nextButton) {
      return;
    }

    const path = nodePath(this.gameState.root, this.state.currentNodeId);
    const canGoBack = path.length > 1;
    const currentNode = this.currentNode();
    const canGoForward = Boolean(
      currentNode?.children[0] ?? (this.state.currentNodeId === 'root' ? this.gameState.root.children[0] : null),
    );

    this.prevButton.disabled = !canGoBack;
    this.resetButton.disabled = this.state.currentNodeId === 'root';
    this.nextButton.disabled = !canGoForward;
  }

  private renderNotation(): void {
    if (!this.notationPanelEl) {
      return;
    }

    const scrollTop = this.notationPanelEl.scrollTop;
    const scrollLeft = this.notationPanelEl.scrollLeft;
    this.notationPanelEl.empty();

    const title = this.displayHeaderValue(this.gameState.headers.Event);
    const players = [this.displayHeaderValue(this.gameState.headers.White), this.displayHeaderValue(this.gameState.headers.Black)]
      .filter((value): value is string => Boolean(value));

    if (title || players.length > 0) {
      const metaEl = this.notationPanelEl.createDiv({ cls: 'chess-pgn-viewer__meta' });
      if (title) {
        metaEl.createDiv({ cls: 'chess-pgn-viewer__title', text: title });
      }

      if (players.length > 0) {
        metaEl.createDiv({
          cls: 'chess-pgn-viewer__summary',
          text: players.join(' vs '),
        });
      }
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

  private displayHeaderValue(value: string | undefined): string | null {
    const normalized = value?.trim();
    if (!normalized || normalized === '?') {
      return null;
    }

    return normalized;
  }

  private syncActiveMoveVisibility(): void {
    if (!this.notationPanelEl) {
      return;
    }

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
    const blockEl = hostEl.createDiv({ cls: 'chess-pgn-viewer__notation-block' });
    const rowEl = blockEl.createDiv({ cls: 'chess-pgn-viewer__notation-row' });
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

        blockEl.createDiv({
          cls: 'chess-pgn-viewer__notation-comment',
          text: move.comment,
        });
      }
    }

    if (this.options.showVariations && row.variations.length > 0) {
      const variationsEl = blockEl.createDiv({ cls: 'chess-pgn-viewer__variation-list' });
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
    });
    button.createSpan({ cls: 'chess-pgn-viewer__move-text', text: move.label });
    button.toggleClass('is-active', this.state.currentNodeId === move.id);
    button.addEventListener('click', () => {
      this.state.currentNodeId = move.id;
      this.render();
    });
    return button;
  }

  private createControlButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = this.controlsEl!.createEl('button', {
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
    const nextId =
      currentNode?.children[0]?.id ?? (this.state.currentNodeId === 'root' ? this.gameState.root.children[0]?.id : null);
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
    this.boardFrameEl.style.setProperty('--square-size', `${this.state.geometry.squareSize}px`);
    this.boardFrameEl.style.width = `${side}px`;
    this.boardFrameEl.style.height = `${side}px`;
    this.boardEl.style.setProperty('--board-side', `${side}px`);
    this.boardEl.style.setProperty('--square-size', `${this.state.geometry.squareSize}px`);
    this.boardEl.style.width = `${side}px`;
    this.boardEl.style.height = `${side}px`;
    this.highlightsEl.style.width = `${side}px`;
    this.highlightsEl.style.height = `${side}px`;
    this.moveGlyphsEl.style.width = `${side}px`;
    this.moveGlyphsEl.style.height = `${side}px`;
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
      defs = this.arrowsSvg.ownerDocument.createElementNS(SVG_NS, 'defs');
      this.arrowsSvg.appendChild(defs);
    }
    return defs;
  }
}

function createPieceSvg(piece: BoardPiece): SVGSVGElement {
  const doc = new DOMParser().parseFromString(atob(PIECE_SVG_BASE64[piece.color][piece.role]), 'image/svg+xml');
  const svg = doc.documentElement as unknown as SVGSVGElement;
  svg.setAttribute('class', 'chess-pgn-viewer__piece-svg');
  svg.setAttribute('viewBox', '0 0 45 45');
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}

const PIECE_SVG_BASE64: Record<BoardPiece['color'], Record<BoardPiece['role'], string>> = {
  white: {
    pawn: 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0NSIgaGVpZ2h0PSI0NSI+PHBhdGggZD0iTTIyLjUgOWMtMi4yMSAwLTQgMS43OS00IDQgMCAuODkuMjkgMS43MS43OCAyLjM4QzE3LjMzIDE2LjUgMTYgMTguNTkgMTYgMjFjMCAyLjAzLjk0IDMuODQgMi40MSA1LjAzLTMgMS4wNi03LjQxIDUuNTUtNy40MSAxMy40N2gyM2MwLTcuOTItNC40MS0xMi40MS03LjQxLTEzLjQ3IDEuNDctMS4xOSAyLjQxLTMgMi40MS01LjAzIDAtMi40MS0xLjMzLTQuNS0zLjI4LTUuNjIuNDktLjY3Ljc4LTEuNDkuNzgtMi4zOCAwLTIuMjEtMS43OS00LTQtNHoiIGZpbGw9IiNmZmYiIHN0cm9rZT0iIzAwMCIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPjwvc3ZnPg==',
    knight: 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0NSIgaGVpZ2h0PSI0NSI+PGcgZmlsbD0ibm9uZSIgZmlsbC1ydWxlPSJldmVub2RkIiBzdHJva2U9IiMwMDAiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0yMiAxMGMxMC41IDEgMTYuNSA4IDE2IDI5SDE1YzAtOSAxMC02LjUgOC0yMSIgZmlsbD0iI2ZmZiIvPjxwYXRoIGQ9Ik0yNCAxOGMuMzggMi45MS01LjU1IDcuMzctOCA5LTMgMi0yLjgyIDQuMzQtNSA0LTEuMDQyLS45NCAxLjQxLTMuMDQgMC0zLTEgMCAuMTkgMS4yMy0xIDItMSAwLTQuMDAzIDEtNC00IDAtMiA2LTEyIDYtMTJzMS44OS0xLjkgMi0zLjVjLS43My0uOTk0LS41LTItLjUtMyAxLTEgMyAyLjUgMyAyLjVoMnMuNzgtMS45OTIgMi41LTNjMSAwIDEgMyAxIDMiIGZpbGw9IiNmZmYiLz48cGF0aCBkPSJNOS41IDI1LjVhLjUuNSAwIDEgMS0xIDAgLjUuNSAwIDEgMSAxIDB6bTUuNDMzLTkuNzVhLjUgMS41IDMwIDEgMS0uODY2LS41LjUgMS41IDMwIDEgMSAuODY2LjV6IiBmaWxsPSIjMDAwIi8+PC9nPjwvc3ZnPg==',
    bishop: 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0NSIgaGVpZ2h0PSI0NSI+PGcgZmlsbD0ibm9uZSIgZmlsbC1ydWxlPSJldmVub2RkIiBzdHJva2U9IiMwMDAiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxnIGZpbGw9IiNmZmYiIHN0cm9rZS1saW5lY2FwPSJidXR0Ij48cGF0aCBkPSJNOSAzNmMzLjM5LS45NyAxMC4xMS40MyAxMy41LTIgMy4zOSAyLjQzIDEwLjExIDEuMDMgMTMuNSAyIDAgMCAxLjY1LjU0IDMgMi0uNjguOTctMS42NS45OS0zIC41LTMuMzktLjk3LTEwLjExLjQ2LTEzLjUtMS0zLjM5IDEuNDYtMTAuMTEuMDMtMTMuNSAxLTEuMzU0LjQ5LTIuMzIzLjQ3LTMtLjUgMS4zNTQtMS45NCAzLTIgMy0yeiIvPjxwYXRoIGQ9Ik0xNSAzMmMyLjUgMi41IDEyLjUgMi41IDE1IDAgLjUtMS41IDAtMiAwLTIgMC0yLjUtMi41LTQtMi41LTQgNS41LTEuNSA2LTExLjUtNS0xNS41LTExIDQtMTAuNSAxNC01IDE1LjUgMCAwLTIuNSAxLjUtMi41IDQgMCAwLS41LjUgMCAyeiIvPjxwYXRoIGQ9Ik0yNSA4YTIuNSAyLjUgMCAxIDEtNSAwIDIuNSAyLjUgMCAxIDEgNSAweiIvPjwvZz48cGF0aCBkPSJNMTcuNSAyNmgxME0xNSAzMGgxNW0tNy41LTE0LjV2NU0yMCAxOGg1IiBzdHJva2UtbGluZWpvaW49Im1pdGVyIi8+PC9nPjwvc3ZnPg==',
    rook: 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0NSIgaGVpZ2h0PSI0NSI+PGcgZmlsbD0iI2ZmZiIgZmlsbC1ydWxlPSJldmVub2RkIiBzdHJva2U9IiMwMDAiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik05IDM5aDI3di0zSDl2M3ptMy0zdi00aDIxdjRIMTJ6bS0xLTIyVjloNHYyaDVWOWg1djJoNVY5aDR2NSIgc3Ryb2tlLWxpbmVjYXA9ImJ1dHQiLz48cGF0aCBkPSJNMzQgMTRsLTMgM0gxNGwtMy0zIi8+PHBhdGggZD0iTTMxIDE3djEyLjVIMTRWMTciIHN0cm9rZS1saW5lY2FwPSJidXR0IiBzdHJva2UtbGluZWpvaW49Im1pdGVyIi8+PHBhdGggZD0iTTMxIDI5LjVsMS41IDIuNWgtMjBsMS41LTIuNSIvPjxwYXRoIGQ9Ik0xMSAxNGgyMyIgZmlsbD0ibm9uZSIgc3Ryb2tlLWxpbmVqb2luPSJtaXRlciIvPjwvZz48L3N2Zz4=',
    queen: 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0NSIgaGVpZ2h0PSI0NSI+PGcgZmlsbD0iI2ZmZiIgZmlsbC1ydWxlPSJldmVub2RkIiBzdHJva2U9IiMwMDAiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik04IDEyYTIgMiAwIDEgMS00IDAgMiAyIDAgMSAxIDQgMHptMTYuNS00LjVhMiAyIDAgMSAxLTQgMCAyIDIgMCAxIDEgNCAwek00MSAxMmEyIDIgMCAxIDEtNCAwIDIgMiAwIDEgMSA0IDB6TTE2IDguNWEyIDIgMCAxIDEtNCAwIDIgMiAwIDEgMSA0IDB6TTMzIDlhMiAyIDAgMSAxLTQgMCAyIDIgMCAxIDEgNCAweiIvPjxwYXRoIGQ9Ik05IDI2YzguNS0xLjUgMjEtMS41IDI3IDBsMi0xMi03IDExVjExbC01LjUgMTMuNS0zLTE1LTMgMTUtNS41LTE0VjI1TDcgMTRsMiAxMnoiIHN0cm9rZS1saW5lY2FwPSJidXR0Ii8+PHBhdGggZD0iTTkgMjZjMCAyIDEuNSAyIDIuNSA0IDEgMS41IDEgMSAuNSAzLjUtMS41IDEtMS41IDIuNS0xLjUgMi41LTEuNSAxLjUuNSAyLjUuNSAyLjUgNi41IDEgMTYuNSAxIDIzIDAgMCAwIDEuNS0xIDAtMi41IDAgMCAuNS0xLjUtMS0yLjUtLjUtMi41LS41LTIgLjUtMy41IDEtMiAyLjUtMiAyLjUtNC04LjUtMS41LTE4LjUtMS41LTI3IDB6IiBzdHJva2UtbGluZWNhcD0iYnV0dCIvPjxwYXRoIGQ9Ik0xMS41IDMwYzMuNS0xIDE4LjUtMSAyMiAwTTEyIDMzLjVjNi0xIDE1LTEgMjEgMCIgZmlsbD0ibm9uZSIvPjwvZz48L3N2Zz4=',
    king: 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0NSIgaGVpZ2h0PSI0NSI+PGcgZmlsbD0ibm9uZSIgZmlsbC1ydWxlPSJldmVub2RkIiBzdHJva2U9IiMwMDAiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0yMi41IDExLjYzVjZNMjAgOGg1IiBzdHJva2UtbGluZWpvaW49Im1pdGVyIi8+PHBhdGggZD0iTTIyLjUgMjVzNC41LTcuNSAzLTEwLjVjMCAwLTEtMi41LTMtMi41cy0zIDIuNS0zIDIuNWMtMS41IDMgMyAxMC41IDMgMTAuNSIgZmlsbD0iI2ZmZiIgc3Ryb2tlLWxpbmVjYXA9ImJ1dHQiIHN0cm9rZS1saW5lam9pbj0ibWl0ZXIiLz48cGF0aCBkPSJNMTEuNSAzN2M1LjUgMy41IDE1LjUgMy41IDIxIDB2LTdzOS00LjUgNi0xMC41Yy00LTYuNS0xMy41LTMuNS0xNiA0VjI3di0zLjVjLTMuNS03LjUtMTMtMTAuNS0xNi00LTMgNiA1IDEwIDUgMTBWMzd6IiBmaWxsPSIjZmZmIi8+PHBhdGggZD0iTTExLjUgMzBjNS41LTMgMTUuNS0zIDIxIDBtLTIxIDMuNWM1LjUtMyAxNS41LTMgMjEgMG0tMjEgMy41YzUuNS0zIDE1LjUtMyAyMSAwIi8+PC9nPjwvc3ZnPg==',
  },
  black: {
    pawn: 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0NSIgaGVpZ2h0PSI0NSI+PHBhdGggZD0iTTIyLjUgOWMtMi4yMSAwLTQgMS43OS00IDQgMCAuODkuMjkgMS43MS43OCAyLjM4QzE3LjMzIDE2LjUgMTYgMTguNTkgMTYgMjFjMCAyLjAzLjk0IDMuODQgMi40MSA1LjAzLTMgMS4wNi03LjQxIDUuNTUtNy40MSAxMy40N2gyM2MwLTcuOTItNC40MS0xMi40MS03LjQxLTEzLjQ3IDEuNDctMS4xOSAyLjQxLTMgMi40MS01LjAzIDAtMi40MS0xLjMzLTQuNS0zLjI4LTUuNjIuNDktLjY3Ljc4LTEuNDkuNzgtMi4zOCAwLTIuMjEtMS43OS00LTQtNHoiIHN0cm9rZT0iIzAwMCIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPjwvc3ZnPg==',
    knight: 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0NSIgaGVpZ2h0PSI0NSI+PGcgZmlsbD0ibm9uZSIgZmlsbC1ydWxlPSJldmVub2RkIiBzdHJva2U9IiMwMDAiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0yMiAxMGMxMC41IDEgMTYuNSA4IDE2IDI5SDE1YzAtOSAxMC02LjUgOC0yMSIgZmlsbD0iIzAwMCIvPjxwYXRoIGQ9Ik0yNCAxOGMuMzggMi45MS01LjU1IDcuMzctOCA5LTMgMi0yLjgyIDQuMzQtNSA0LTEuMDQyLS45NCAxLjQxLTMuMDQgMC0zLTEgMCAuMTkgMS4yMy0xIDItMSAwLTQuMDAzIDEtNC00IDAtMiA2LTEyIDYtMTJzMS44OS0xLjkgMi0zLjVjLS43My0uOTk0LS41LTItLjUtMyAxLTEgMyAyLjUgMyAyLjVoMnMuNzgtMS45OTIgMi41LTNjMSAwIDEgMyAxIDMiIGZpbGw9IiMwMDAiLz48cGF0aCBkPSJNOS41IDI1LjVhLjUuNSAwIDEgMS0xIDAgLjUuNSAwIDEgMSAxIDB6bTUuNDMzLTkuNzVhLjUgMS41IDMwIDEgMS0uODY2LS41LjUgMS41IDMwIDEgMSAuODY2LjV6IiBmaWxsPSIjZWNlY2VjIiBzdHJva2U9IiNlY2VjZWMiLz48cGF0aCBkPSJNMjQuNTUgMTAuNGwtLjQ1IDEuNDUuNS4xNWMzLjE1IDEgNS42NSAyLjQ5IDcuOSA2Ljc1UzM1Ljc1IDI5LjA2IDM1LjI1IDM5bC0uMDUuNWgyLjI1bC4wNS0uNWMuNS0xMC4wNi0uODgtMTYuODUtMy4yNS0yMS4zNC0yLjM3LTQuNDktNS43OS02LjY0LTkuMTktNy4xNmwtLjUxLS4xeiIgZmlsbD0iI2VjZWNlYyIgc3Ryb2tlPSJub25lIi8+PC9nPjwvc3ZnPg==',
    bishop: 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0NSIgaGVpZ2h0PSI0NSI+PGcgZmlsbD0ibm9uZSIgZmlsbC1ydWxlPSJldmVub2RkIiBzdHJva2U9IiMwMDAiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxnIGZpbGw9IiMwMDAiIHN0cm9rZS1saW5lY2FwPSJidXR0Ij48cGF0aCBkPSJNOSAzNmMzLjM5LS45NyAxMC4xMS40MyAxMy41LTIgMy4zOSAyLjQzIDEwLjExIDEuMDMgMTMuNSAyIDAgMCAxLjY1LjU0IDMgMi0uNjguOTctMS42NS45OS0zIC41LTMuMzktLjk3LTEwLjExLjQ2LTEzLjUtMS0zLjM5IDEuNDYtMTAuMTEuMDMtMTMuNSAxLTEuMzU0LjQ5LTIuMzIzLjQ3LTMtLjUgMS4zNTQtMS45NCAzLTIgMy0yeiIvPjxwYXRoIGQ9Ik0xNSAzMmMyLjUgMi41IDEyLjUgMi41IDE1IDAgLjUtMS41IDAtMiAwLTIgMC0yLjUtMi41LTQtMi41LTQgNS41LTEuNSA2LTExLjUtNS0xNS41LTExIDQtMTAuNSAxNC01IDE1LjUgMCAwLTIuNSAxLjUtMi41IDQgMCAwLS41LjUgMCAyeiIvPjxwYXRoIGQ9Ik0yNSA4YTIuNSAyLjUgMCAxIDEtNSAwIDIuNSAyLjUgMCAxIDEgNSAweiIvPjwvZz48cGF0aCBkPSJNMTcuNSAyNmgxME0xNSAzMGgxNW0tNy41LTE0LjV2NU0yMCAxOGg1IiBzdHJva2U9IiNlY2VjZWMiIHN0cm9rZS1saW5lam9pbj0ibWl0ZXIiLz48L2c+PC9zdmc+',
    rook: 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0NSIgaGVpZ2h0PSI0NSI+PGcgZmlsbC1ydWxlPSJldmVub2RkIiBzdHJva2U9IiMwMDAiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik05IDM5aDI3di0zSDl2M3ptMy41LTdsMS41LTIuNWgxN2wxLjUgMi41aC0yMHptLS41IDR2LTRoMjF2NEgxMnoiIHN0cm9rZS1saW5lY2FwPSJidXR0Ii8+PHBhdGggZD0iTTE0IDI5LjV2LTEzaDE3djEzSDE0eiIgc3Ryb2tlLWxpbmVjYXA9ImJ1dHQiIHN0cm9rZS1saW5lam9pbj0ibWl0ZXIiLz48cGF0aCBkPSJNMTQgMTYuNUwxMSAxNGgyM2wtMyAyLjVIMTR6TTExIDE0VjloNHYyaDVWOWg1djJoNVY5aDR2NUgxMXoiIHN0cm9rZS1saW5lY2FwPSJidXR0Ii8+PHBhdGggZD0iTTEyIDM1LjVoMjFtLTIwLTRoMTltLTE4LTJoMTdtLTE3LTEzaDE3TTExIDE0aDIzIiBmaWxsPSJub25lIiBzdHJva2U9IiNlY2VjZWMiIHN0cm9rZS13aWR0aD0iMSIgc3Ryb2tlLWxpbmVqb2luPSJtaXRlciIvPjwvZz48L3N2Zz4=',
    queen: 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0NSIgaGVpZ2h0PSI0NSI+PGcgZmlsbC1ydWxlPSJldmVub2RkIiBzdHJva2U9IiMwMDAiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxnIHN0cm9rZT0ibm9uZSI+PGNpcmNsZSBjeD0iNiIgY3k9IjEyIiByPSIyLjc1Ii8+PGNpcmNsZSBjeD0iMTQiIGN5PSI5IiByPSIyLjc1Ii8+PGNpcmNsZSBjeD0iMjIuNSIgY3k9IjgiIHI9IjIuNzUiLz48Y2lyY2xlIGN4PSIzMSIgY3k9IjkiIHI9IjIuNzUiLz48Y2lyY2xlIGN4PSIzOSIgY3k9IjEyIiByPSIyLjc1Ii8+PC9nPjxwYXRoIGQ9Ik05IDI2YzguNS0xLjUgMjEtMS41IDI3IDBsMi41LTEyLjVMMzEgMjVsLS4zLTE0LjEtNS4yIDEzLjYtMy0xNC41LTMgMTQuNS01LjItMTMuNkwxNCAyNSA2LjUgMTMuNSA5IDI2eiIgc3Ryb2tlLWxpbmVjYXA9ImJ1dHQiLz48cGF0aCBkPSJNOSAyNmMwIDIgMS41IDIgMi41IDQgMSAxLjUgMSAxIC41IDMuNS0xLjUgMS0xLjUgMi41LTEuNSAyLjUtMS41IDEuNS41IDIuNS41IDIuNSA2LjUgMSAxNi41IDEgMjMgMCAwIDAgMS41LTEgMC0yLjUgMCAwIC41LTEuNS0xLTIuNS0uNS0yLjUtLjUtMiAuNS0zLjUgMS0yIDIuNS0yIDIuNS00LTguNS0xLjUtMTguNS0xLjUtMjcgMHoiIHN0cm9rZS1saW5lY2FwPSJidXR0Ii8+PHBhdGggZD0iTTExIDM4LjVhMzUgMzUgMSAwIDAgMjMgMCIgZmlsbD0ibm9uZSIgc3Ryb2tlLWxpbmVjYXA9ImJ1dHQiLz48cGF0aCBkPSJNMTEgMjlhMzUgMzUgMSAwIDEgMjMgMG0tMjEuNSAyLjVoMjBtLTIxIDNhMzUgMzUgMSAwIDAgMjIgMG0tMjMgM2EzNSAzNSAxIDAgMCAyNCAwIiBmaWxsPSJub25lIiBzdHJva2U9IiNlY2VjZWMiLz48L2c+PC9zdmc+',
    king: 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0NSIgaGVpZ2h0PSI0NSI+PGcgZmlsbD0ibm9uZSIgZmlsbC1ydWxlPSJldmVub2RkIiBzdHJva2U9IiMwMDAiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0yMi41IDExLjYzVjYiIHN0cm9rZS1saW5lam9pbj0ibWl0ZXIiLz48cGF0aCBkPSJNMjIuNSAyNXM0LjUtNy41IDMtMTAuNWMwIDAtMS0yLjUtMy0yLjVzLTMgMi41LTMgMi41Yy0xLjUgMyAzIDEwLjUgMyAxMC41IiBmaWxsPSIjMDAwIiBzdHJva2UtbGluZWNhcD0iYnV0dCIgc3Ryb2tlLWxpbmVqb2luPSJtaXRlciIvPjxwYXRoIGQ9Ik0xMS41IDM3YzUuNSAzLjUgMTUuNSAzLjUgMjEgMHYtN3M5LTQuNSA2LTEwLjVjLTQtNi41LTEzLjUtMy41LTE2IDRWMjd2LTMuNWMtMy41LTcuNS0xMy0xMC41LTE2LTQtMyA2IDUgMTAgNSAxMFYzN3oiIGZpbGw9IiMwMDAiLz48cGF0aCBkPSJNMjAgOGg1IiBzdHJva2UtbGluZWpvaW49Im1pdGVyIi8+PHBhdGggZD0iTTMyIDI5LjVzOC41LTQgNi4wMy05LjY1QzM0LjE1IDE0IDI1IDE4IDIyLjUgMjQuNWwuMDEgMi4xLS4wMS0yLjFDMjAgMTggOS45MDYgMTQgNi45OTcgMTkuODVjLTIuNDk3IDUuNjUgNC44NTMgOSA0Ljg1MyA5IiBzdHJva2U9IiNlY2VjZWMiLz48cGF0aCBkPSJNMTEuNSAzMGM1LjUtMyAxNS41LTMgMjEgMG0tMjEgMy41YzUuNS0zIDE1LjUtMyAyMSAwbS0yMSAzLjVjNS41LTMgMTUuNS0zIDIxIDAiIHN0cm9rZT0iI2VjZWNlYyIvPjwvZz48L3N2Zz4=',
  },
};
