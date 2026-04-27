// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { buildGameState } from '../src/chess/block';
import { ChessViewer } from '../src/chess/viewer';

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

describe('ChessViewer', () => {
  it('keeps the board shell stable when navigating between moves', () => {
    installObsidianDomHelpers();

    const gameState = buildGameState(`[Event "Example"]
[White "White"]
[Black "Black"]
1. e4 {King pawn opening} e5 2. Nf3 (2. Bc4 {Bishop opening}) Nc6 3. Bb5 a6`);

    const container = document.createElement('div');
    new ChessViewer(container, gameState, {
      orientation: 'white',
      showMoves: true,
      showComments: true,
      showVariations: true,
    });

    const board = container.querySelector('.chess-pgn-viewer__board');
    const content = container.querySelector('.chess-pgn-viewer__content');
    const moveButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('.chess-pgn-viewer__move'));

    expect(board).not.toBeNull();
    expect(content).not.toBeNull();

    moveButtons[1]?.click();
    moveButtons[2]?.click();

    expect(container.querySelector('.chess-pgn-viewer__board')).toBe(board);
    expect(container.querySelector('.chess-pgn-viewer__content')).toBe(content);
  });

  it('renders board annotations visually and does not leak raw PGN tags into comments', () => {
    installObsidianDomHelpers();

    const gameState = buildGameState(`[Event "Annotated"]
1. e4 {Bridge idea [%csl Ge4][%cal Ge2e4,Gd1h5]} e5`);

    const container = document.createElement('div');
    new ChessViewer(container, gameState, {
      orientation: 'white',
      showMoves: true,
      showComments: true,
      showVariations: true,
    });

    const firstMove = container.querySelector<HTMLButtonElement>('.chess-pgn-viewer__move');
    firstMove?.click();

    const comment = container.querySelector('.chess-pgn-viewer__comment');
    const highlights = container.querySelectorAll('.chess-pgn-viewer__annotation--highlight');
    const arrows = container.querySelectorAll('.chess-pgn-viewer__annotation--arrow');

    expect(comment?.textContent).toContain('Bridge idea');
    expect(comment?.textContent).not.toContain('[%csl');
    expect(comment?.textContent).not.toContain('[%cal');
    expect(highlights).toHaveLength(1);
    expect(arrows).toHaveLength(2);
  });
});
