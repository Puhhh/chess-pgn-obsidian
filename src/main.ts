import { MarkdownPostProcessorContext, Plugin } from 'obsidian';

import { buildGameState, parseChessBlock } from './chess/block';
import { ChessViewer } from './chess/viewer';

export default class ChessPgnViewerPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerMarkdownCodeBlockProcessor('chess', (source, el, ctx) => {
      this.renderChessBlock(source, el, ctx);
    });
  }

  private renderChessBlock(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    try {
      const parsed = parseChessBlock(source);
      for (const warning of parsed.warnings) {
        console.warn(`[Chess PGN Viewer] ${warning}`, { file: ctx.sourcePath });
      }

      const state = buildGameState(parsed.pgn);
      el.addClass('chess-pgn-viewer-root');
      new ChessViewer(el, state, parsed.options);
    } catch (error) {
      this.renderErrorState(el, error);
    }
  }

  private renderErrorState(el: HTMLElement, error: unknown): void {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const wrapper = el.createDiv({ cls: 'chess-pgn-viewer__error' });
    wrapper.createDiv({ cls: 'chess-pgn-viewer__error-title', text: 'Chess PGN render error' });
    wrapper.createEl('pre', {
      cls: 'chess-pgn-viewer__error-message',
      text: message,
    });
  }
}
