// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { buildGameState } from '../src/chess/block';
import {
  ChessViewer,
  computeBoardGeometry,
  quantizeBoardSide,
} from '../src/chess/viewer';

function installObsidianDomHelpers(): void {
  const proto = HTMLElement.prototype as HTMLElement & {
    createDiv?: (options?: ElementOptions) => HTMLDivElement;
    createSpan?: (options?: ElementOptions) => HTMLSpanElement;
    createEl?: <K extends keyof HTMLElementTagNameMap>(
      tag: K,
      options?: ElementOptions,
    ) => HTMLElementTagNameMap[K];
    empty?: () => void;
    hasClass?: (cls: string) => boolean;
    toggleClass?: (cls: string, value: boolean) => void;
    addClass?: (cls: string) => void;
  };

  if (!proto.createEl) {
    proto.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(tag: K, options?: ElementOptions) {
      const el = document.createElement(tag);
      if (options?.cls) {
        el.className = options.cls;
      }
      if (options?.text) {
        el.textContent = options.text;
      }
      this.appendChild(el);
      return el;
    };
  }

  if (!proto.createDiv) {
    proto.createDiv = function createDiv(options) {
      return this.createEl!('div', options);
    };
  }

  if (!proto.createSpan) {
    proto.createSpan = function createSpan(options) {
      return this.createEl!('span', options);
    };
  }

  if (!proto.empty) {
    proto.empty = function empty() {
      this.replaceChildren();
    };
  }

  if (!proto.hasClass) {
    proto.hasClass = function hasClass(cls) {
      return this.classList.contains(cls);
    };
  }

  if (!proto.toggleClass) {
    proto.toggleClass = function toggleClass(cls, value) {
      this.classList.toggle(String(cls), value);
    };
  }

  if (!proto.addClass) {
    proto.addClass = function addClass(cls) {
      this.classList.add(cls);
    };
  }
}

interface ElementOptions {
  cls?: string;
  text?: string;
}

class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];

  constructor(private readonly callback: ResizeObserverCallback) {
    ResizeObserverMock.instances.push(this);
  }

  observe(target: Element): void {
    const width = Number((target as HTMLElement).dataset.testWidth ?? 0);
    this.callback(
      [
        {
          target,
          contentRect: {
            width,
            height: width,
          } as DOMRectReadOnly,
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }

  disconnect(): void {}
  unobserve(): void {}
}

function installResizeObserver(): void {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: ResizeObserverMock,
  });
}

interface RectSpec {
  top: number;
  bottom: number;
  left?: number;
  right?: number;
}

function installNotationRectHarness(
  activeRect: RectSpec,
  panelRect: RectSpec = { top: 100, bottom: 220, left: 0, right: 320 },
): () => void {
  const original = HTMLElement.prototype.getBoundingClientRect;

  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
    if (this.classList.contains('chess-pgn-viewer__notation-panel')) {
      return rectFromSpec(panelRect);
    }

    if (this.classList.contains('chess-pgn-viewer__move') && this.classList.contains('is-active')) {
      return rectFromSpec(activeRect);
    }

    return original.call(this);
  };

  return () => {
    HTMLElement.prototype.getBoundingClientRect = original;
  };
}

function rectFromSpec({ top, bottom, left = 0, right = 0 }: RectSpec): DOMRect {
  return {
    top,
    bottom,
    left,
    right,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('ChessViewer', () => {
  it('quantizes the board side to an exact 8-cell grid and reports equal square metrics', () => {
    expect(quantizeBoardSide(423)).toBe(416);
    expect(quantizeBoardSide(64)).toBe(64);
    expect(quantizeBoardSide(7)).toBe(0);

    const geometry = computeBoardGeometry(whiteOrientationSquareNames(), 416);

    expect(geometry.side).toBe(416);
    expect(geometry.squareSize).toBe(52);
    expect(geometry.squares.e4).toEqual({
      left: 208,
      top: 208,
      size: 52,
      centerX: 234,
      centerY: 234,
    });
    expect(geometry.squares.h1?.size).toBe(52);
  });

  it('keeps the board shell stable when navigating between moves', () => {
    installObsidianDomHelpers();
    installResizeObserver();

    const gameState = buildGameState(`[Event "Example"]
[White "White"]
[Black "Black"]
1. e4 {King pawn opening} e5 2. Nf3 (2. Bc4 {Bishop opening}) Nc6 3. Bb5 a6`);

    const container = document.createElement('div');
    container.dataset.testWidth = '423';
    new ChessViewer(container, gameState, {
      orientation: 'white',
      showMoves: true,
      showComments: true,
      showVariations: true,
    });

    const board = container.querySelector('.chess-pgn-viewer__board');
    const content = container.querySelector('.chess-pgn-viewer__content');
    const moveButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.chess-pgn-viewer__notation-row .chess-pgn-viewer__move'),
    );

    expect(board).not.toBeNull();
    expect(content).not.toBeNull();

    moveButtons[1]?.click();
    moveButtons[2]?.click();

    expect(container.querySelector('.chess-pgn-viewer__board')).toBe(board);
    expect(container.querySelector('.chess-pgn-viewer__content')).toBe(content);
  });

  it('renders board annotations visually and does not leak raw PGN tags into comments', () => {
    installObsidianDomHelpers();
    installResizeObserver();

    const gameState = buildGameState(`[Event "Annotated"]
1. e4 {Bridge idea [%csl Ge4][%cal Ge2e4,Gd1h5]} e5`);

    const container = document.createElement('div');
    container.dataset.testWidth = '423';
    new ChessViewer(container, gameState, {
      orientation: 'white',
      showMoves: true,
      showComments: true,
      showVariations: true,
    });

    const firstMove = container.querySelector<HTMLButtonElement>('.chess-pgn-viewer__move');
    firstMove?.click();

    const comment = container.querySelector('.chess-pgn-viewer__notation-comment');
    const highlights = container.querySelectorAll('.chess-pgn-viewer__annotation--highlight');
    const arrows = container.querySelectorAll('.chess-pgn-viewer__annotation--arrow');

    expect(comment?.textContent).toContain('Bridge idea');
    expect(comment?.textContent).not.toContain('[%csl');
    expect(comment?.textContent).not.toContain('[%cal');
    expect(highlights).toHaveLength(1);
    expect(arrows).toHaveLength(2);
  });

  it('sizes arrow SVG from measured board geometry and renders study-style move rows', () => {
    installObsidianDomHelpers();
    installResizeObserver();

    const gameState = buildGameState(`[Event "Annotated"]
[White "White"]
[Black "Black"]
1. e4 {Bridge idea [%csl Ge4][%cal Ge2e4,Gd1h5]} e5 2. Nf3 (2. Bc4 {Bishop line}) Nc6`);

    const container = document.createElement('div');
    container.dataset.testWidth = '423';
    new ChessViewer(container, gameState, {
      orientation: 'white',
      showMoves: true,
      showComments: true,
      showVariations: true,
    });

    container.querySelector<HTMLButtonElement>('.chess-pgn-viewer__move')?.click();

    const boardFrame = container.querySelector<HTMLElement>('.chess-pgn-viewer__board-frame');
    const ring = container.querySelector<HTMLElement>('.chess-pgn-viewer__annotation--highlight');
    const arrow = container.querySelector<SVGLineElement>('.chess-pgn-viewer__annotation--arrow');
    const marker = container.querySelector<SVGMarkerElement>('marker');
    const rows = container.querySelectorAll('.chess-pgn-viewer__notation-row');
    const variation = container.querySelector('.chess-pgn-viewer__variation-line');

    expect(boardFrame?.style.width).toBe('416px');
    expect(boardFrame?.style.height).toBe('416px');
    expect(ring?.style.left).toBe('208px');
    expect(ring?.style.top).toBe('208px');
    expect(arrow?.getAttribute('x1')).toBe('234');
    expect(arrow?.getAttribute('y1')).toBe('338');
    expect(arrow?.getAttribute('x2')).toBe('234');
    expect(arrow?.getAttribute('y2')).toBe('234');
    expect(arrow?.getAttribute('stroke-width')).toBe('8');
    expect(marker?.getAttribute('markerUnits')).toBe('userSpaceOnUse');
    expect(rows).toHaveLength(2);
    expect(variation?.textContent).toContain('2. Bc4');
    expect(variation?.textContent).toContain('Bishop line');
  });

  it('groups each move row with its comments and variations in a compact notation block', () => {
    installObsidianDomHelpers();
    installResizeObserver();

    const gameState = buildGameState(`[Event "Compact"]
1. e4 e5
2. Nf3 {Mainline comment} (2. Bc4 {Bishop line}) Nc6
3. Bb5 a6`);

    const container = document.createElement('div');
    container.dataset.testWidth = '423';
    new ChessViewer(container, gameState, {
      orientation: 'white',
      showMoves: true,
      showComments: true,
      showVariations: true,
    });

    const blocks = container.querySelectorAll('.chess-pgn-viewer__notation-block');
    const secondBlock = blocks[1] as HTMLElement | undefined;
    const groupedChildren = Array.from(secondBlock?.children ?? []).map(child => child.className);

    expect(blocks).toHaveLength(3);
    expect(groupedChildren).toEqual([
      'chess-pgn-viewer__notation-row',
      'chess-pgn-viewer__notation-comment',
      'chess-pgn-viewer__variation-list',
    ]);
    expect(secondBlock?.querySelector('.chess-pgn-viewer__notation-comment')?.textContent).toContain('Mainline comment');
    expect(secondBlock?.querySelector('.chess-pgn-viewer__variation-line')?.textContent).toContain('2. Bc4');
  });

  it('renders move labels inside compact text wrappers while keeping buttons clickable', () => {
    installObsidianDomHelpers();
    installResizeObserver();

    const gameState = buildGameState('1. e4 e5 2. Nf3 Nc6');

    const container = document.createElement('div');
    container.dataset.testWidth = '423';
    new ChessViewer(container, gameState, {
      orientation: 'white',
      showMoves: true,
      showComments: true,
      showVariations: true,
    });

    const move = container.querySelector<HTMLButtonElement>('.chess-pgn-viewer__move');
    const text = move?.querySelector('.chess-pgn-viewer__move-text');

    expect(text?.textContent).toBe('1. e4');

    move?.click();

    expect(container.querySelector('.chess-pgn-viewer__move.is-active .chess-pgn-viewer__move-text')?.textContent).toBe('1. e4');
  });

  it('renders colored move annotation glyphs in mainline and variations', () => {
    installObsidianDomHelpers();
    installResizeObserver();

    const gameState = buildGameState('1. e4! e5? 2. Nf3!! (2. Bc4!?) Nc6?? 3. Bb5!? a6?!');

    const container = document.createElement('div');
    container.dataset.testWidth = '423';
    new ChessViewer(container, gameState, {
      orientation: 'white',
      showMoves: true,
      showComments: true,
      showVariations: true,
    });

    const moveButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.chess-pgn-viewer__notation-row .chess-pgn-viewer__move'),
    );
    const variationButton = container.querySelector<HTMLButtonElement>('.chess-pgn-viewer__move--variation');

    expect(moveButtons[0]?.textContent).toBe('1. e4!');
    expect(moveButtons[0]?.className).toContain('is-good');
    expect(moveButtons[1]?.textContent).toBe('1... e5?');
    expect(moveButtons[1]?.className).toContain('is-mistake');
    expect(moveButtons[2]?.textContent).toBe('2. Nf3!!');
    expect(moveButtons[2]?.className).toContain('is-brilliant');
    expect(moveButtons[3]?.textContent).toBe('2... Nc6??');
    expect(moveButtons[3]?.className).toContain('is-blunder');
    expect(moveButtons[4]?.textContent).toBe('3. Bb5!?');
    expect(moveButtons[4]?.className).toContain('is-interesting');
    expect(moveButtons[5]?.textContent).toBe('3... a6?!');
    expect(moveButtons[5]?.className).toContain('is-dubious');
    expect(variationButton?.textContent).toBe('2. Bc4!?');
    expect(variationButton?.className).toContain('is-interesting');
  });

  it('omits placeholder header metadata when event and players are missing from PGN', () => {
    installObsidianDomHelpers();
    installResizeObserver();

    const gameState = buildGameState('1. e4 e5 2. Nf3 Nc6');

    const container = document.createElement('div');
    container.dataset.testWidth = '423';
    new ChessViewer(container, gameState, {
      orientation: 'white',
      showMoves: true,
      showComments: true,
      showVariations: true,
    });

    expect(container.querySelector('.chess-pgn-viewer__title')).toBeNull();
    expect(container.querySelector('.chess-pgn-viewer__summary')).toBeNull();
    expect(container.textContent).not.toContain('?');
  });

  it('renders only real header values when event or one player is provided', () => {
    installObsidianDomHelpers();
    installResizeObserver();

    const eventOnlyState = buildGameState(`[Event "Training Session"]
1. e4 e5`);
    const eventOnlyContainer = document.createElement('div');
    eventOnlyContainer.dataset.testWidth = '423';
    new ChessViewer(eventOnlyContainer, eventOnlyState, {
      orientation: 'white',
      showMoves: true,
      showComments: true,
      showVariations: true,
    });

    expect(eventOnlyContainer.querySelector('.chess-pgn-viewer__title')?.textContent).toBe('Training Session');
    expect(eventOnlyContainer.querySelector('.chess-pgn-viewer__summary')).toBeNull();
    expect(eventOnlyContainer.textContent).not.toContain('?');

    const whiteOnlyState = buildGameState(`[White "Kasparov"]
1. e4 e5`);
    const whiteOnlyContainer = document.createElement('div');
    whiteOnlyContainer.dataset.testWidth = '423';
    new ChessViewer(whiteOnlyContainer, whiteOnlyState, {
      orientation: 'white',
      showMoves: true,
      showComments: true,
      showVariations: true,
    });

    expect(whiteOnlyContainer.querySelector('.chess-pgn-viewer__title')).toBeNull();
    expect(whiteOnlyContainer.querySelector('.chess-pgn-viewer__summary')?.textContent).toBe('Kasparov');
    expect(whiteOnlyContainer.textContent).not.toContain('?');
  });

  it('keeps the active move highlight on annotated moves', () => {
    installObsidianDomHelpers();
    installResizeObserver();

    const gameState = buildGameState('1. e4! e5 2. Nf3 Nc6');

    const container = document.createElement('div');
    container.dataset.testWidth = '423';
    new ChessViewer(container, gameState, {
      orientation: 'white',
      showMoves: true,
      showComments: true,
      showVariations: true,
    });

    container.querySelector<HTMLButtonElement>('.chess-pgn-viewer__move')?.click();

    const activeMove = container.querySelector<HTMLButtonElement>('.chess-pgn-viewer__move.is-active');
    expect(activeMove?.textContent).toBe('1. e4!');
    expect(activeMove?.classList.contains('is-good')).toBe(true);
  });

  it('preserves notation scroll position when navigating between moves', () => {
    installObsidianDomHelpers();
    installResizeObserver();
    const restoreRects = installNotationRectHarness({ top: 130, bottom: 170 });

    const gameState = buildGameState(`[Event "Annotated"]
1. e4 {First comment}
e5
2. Nf3 {Second comment}
Nc6
3. Bb5 {Third comment}
a6
4. Ba4 {Fourth comment}
Nf6
5. O-O {Fifth comment}
Be7
6. Re1 {Sixth comment}
b5`);

    const container = document.createElement('div');
    container.dataset.testWidth = '423';
    new ChessViewer(container, gameState, {
      orientation: 'white',
      showMoves: true,
      showComments: true,
      showVariations: true,
    });

    const notationPanel = container.querySelector<HTMLElement>('.chess-pgn-viewer__notation-panel');
    const moveButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('.chess-pgn-viewer__move'));

    expect(notationPanel).not.toBeNull();

    if (!notationPanel || moveButtons.length < 4) {
      throw new Error('Expected notation panel and move buttons to exist');
    }

    const originalEmpty = notationPanel.empty?.bind(notationPanel);
    notationPanel.empty = function emptyWithScrollReset() {
      originalEmpty?.();
      this.scrollTop = 0;
    };

    notationPanel.scrollTop = 180;
    moveButtons[3]?.click();

    expect(notationPanel.scrollTop).toBe(180);
    restoreRects();
  });

  it('scrolls the notation panel down when the active move falls below the viewport', () => {
    installObsidianDomHelpers();
    installResizeObserver();

    const restoreRects = installNotationRectHarness({ top: 260, bottom: 290 });
    const gameState = buildGameState('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6');

    const container = document.createElement('div');
    container.dataset.testWidth = '423';
    new ChessViewer(container, gameState, {
      orientation: 'white',
      showMoves: true,
      showComments: true,
      showVariations: true,
    });

    const notationPanel = container.querySelector<HTMLElement>('.chess-pgn-viewer__notation-panel');
    const moveButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('.chess-pgn-viewer__move'));

    if (!notationPanel || moveButtons.length < 4) {
      restoreRects();
      throw new Error('Expected notation panel and move buttons to exist');
    }

    notationPanel.scrollTop = 180;
    moveButtons[3]?.click();

    expect(notationPanel.scrollTop).toBe(262);
    restoreRects();
  });

  it('scrolls the notation panel up when the active move falls above the viewport', () => {
    installObsidianDomHelpers();
    installResizeObserver();

    const activeRect = { top: 130, bottom: 170 };
    const restoreRects = installNotationRectHarness(activeRect);
    const gameState = buildGameState('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6');

    const container = document.createElement('div');
    container.dataset.testWidth = '423';
    new ChessViewer(container, gameState, {
      orientation: 'white',
      showMoves: true,
      showComments: true,
      showVariations: true,
    });

    const notationPanel = container.querySelector<HTMLElement>('.chess-pgn-viewer__notation-panel');
    const moveButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('.chess-pgn-viewer__move'));

    if (!notationPanel || moveButtons.length < 4) {
      restoreRects();
      throw new Error('Expected notation panel and move buttons to exist');
    }

    notationPanel.scrollTop = 180;
    moveButtons[3]?.click();
    activeRect.top = 90;
    activeRect.bottom = 120;
    moveButtons[0]?.click();

    expect(notationPanel.scrollTop).toBe(158);
    restoreRects();
  });

  it('keeps notation scroll stable when the active move is already visible', () => {
    installObsidianDomHelpers();
    installResizeObserver();

    const restoreRects = installNotationRectHarness({ top: 130, bottom: 170 });
    const gameState = buildGameState('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6');

    const container = document.createElement('div');
    container.dataset.testWidth = '423';
    new ChessViewer(container, gameState, {
      orientation: 'white',
      showMoves: true,
      showComments: true,
      showVariations: true,
    });

    const notationPanel = container.querySelector<HTMLElement>('.chess-pgn-viewer__notation-panel');
    const moveButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('.chess-pgn-viewer__move'));

    if (!notationPanel || moveButtons.length < 2) {
      restoreRects();
      throw new Error('Expected notation panel and move buttons to exist');
    }

    notationPanel.scrollTop = 180;
    moveButtons[1]?.click();

    expect(notationPanel.scrollTop).toBe(180);
    restoreRects();
  });

  it('auto-scrolls to active variation moves with the same visibility rules', () => {
    installObsidianDomHelpers();
    installResizeObserver();

    const restoreRects = installNotationRectHarness({ top: 250, bottom: 286 });
    const gameState = buildGameState('1. e4 e5 2. Nf3 (2. Bc4 Bc5) Nc6 3. Bb5 a6');

    const container = document.createElement('div');
    container.dataset.testWidth = '423';
    new ChessViewer(container, gameState, {
      orientation: 'white',
      showMoves: true,
      showComments: true,
      showVariations: true,
    });

    const notationPanel = container.querySelector<HTMLElement>('.chess-pgn-viewer__notation-panel');
    const variationButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.chess-pgn-viewer__move--variation'),
    )[0];

    if (!notationPanel || !variationButton) {
      restoreRects();
      throw new Error('Expected notation panel and variation move button to exist');
    }

    notationPanel.scrollTop = 180;
    variationButton.click();

    expect(notationPanel.scrollTop).toBe(258);
    restoreRects();
  });
});

function whiteOrientationSquareNames(): string[] {
  const result: string[] = [];
  for (const rank of [8, 7, 6, 5, 4, 3, 2, 1]) {
    for (const file of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      result.push(`${file}${rank}`);
    }
  }
  return result;
}
