import { MarkdownPostProcessorContext, Notice, Plugin, setIcon } from 'obsidian';

import { buildGameState, parseChessBlock } from './chess/block';
import {
  replaceChessBlockSection,
  updateChessBlockWithSavedAnnotations,
} from './chess/persistence';
import { ChessViewer, type SaveBoardAnnotationsRequest } from './chess/viewer';

export default class ChessPgnViewerPlugin extends Plugin {
  private readonly savedNodeIds = new Map<string, string>();

  onload(): void {
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

      const state = buildGameState(parsed.fen ?? parsed.pgn);
      const blockKey = this.blockKey(el, ctx);
      const initialNodeId = blockKey ? this.savedNodeIds.get(blockKey) : undefined;
      if (initialNodeId && !state.nodeIndex.has(initialNodeId)) {
        this.savedNodeIds.delete(blockKey);
      }

      el.addClass('chess-pgn-viewer-root');
      new ChessViewer(el, state, parsed.options, {
        onSaveAnnotations: request => this.saveBoardAnnotations(el, ctx, request),
        renderSaveIcon: button => setIcon(button, 'save'),
        initialNodeId: initialNodeId && state.nodeIndex.has(initialNodeId) ? initialNodeId : undefined,
      });
    } catch (error) {
      this.renderErrorState(el, error);
    }
  }

  private async saveBoardAnnotations(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    request: SaveBoardAnnotationsRequest,
  ): Promise<void> {
    const sectionInfo = ctx.getSectionInfo(el);
    if (!sectionInfo) {
      throw this.noticeSaveError('Cannot save chess annotations from this view.');
    }

    const file = this.app.vault.getFileByPath(ctx.sourcePath);
    if (!file) {
      throw this.noticeSaveError('Cannot save chess annotations because the source file was not found.');
    }

    try {
      await this.app.vault.process(file, documentText => {
        const lines = documentText.split('\n');
        const currentSource = lines.slice(sectionInfo.lineStart + 1, sectionInfo.lineEnd).join('\n');
        const updatedSource = updateChessBlockWithSavedAnnotations(
          currentSource,
          request.nodeId,
          request.annotations,
        );
        return replaceChessBlockSection(documentText, sectionInfo.lineStart, sectionInfo.lineEnd, updatedSource);
      });
      this.savedNodeIds.set(this.blockKeyFromSection(ctx.sourcePath, sectionInfo.lineStart), request.nodeId);
      new Notice('Chess board annotations saved.');
    } catch (error) {
      throw this.noticeSaveError(error instanceof Error ? error.message : 'Cannot save chess annotations.');
    }
  }

  private noticeSaveError(message: string): Error {
    new Notice(message);
    return new Error(message);
  }

  private blockKey(el: HTMLElement, ctx: MarkdownPostProcessorContext): string | null {
    const sectionInfo = ctx.getSectionInfo(el);
    if (!sectionInfo) {
      return null;
    }

    return this.blockKeyFromSection(ctx.sourcePath, sectionInfo.lineStart);
  }

  private blockKeyFromSection(sourcePath: string, lineStart: number): string {
    return `${sourcePath}:${lineStart}`;
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
