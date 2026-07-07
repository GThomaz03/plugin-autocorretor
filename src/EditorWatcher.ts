import type { Editor } from 'obsidian';
import type { EditorContext } from './types';
import {
  extractLastWords,
  isAfterWordBoundary,
  isValidTargetWord,
} from './utils/text';

export class EditorWatcher {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingEditor: Editor | null = null;

  constructor(
    private debounceMs: number,
    private contextWordCount: number,
    private onStable: (ctx: EditorContext) => void,
  ) {}

  handleChange(editor: Editor): void {
    if (editor.somethingSelected()) {
      this.cancelDebounce();
      return;
    }

    const cursor = editor.getCursor();
    const cursorOffset = editor.posToOffset(cursor);
    const fullText = editor.getValue();

    if (isAfterWordBoundary(fullText, cursorOffset)) {
      this.cancelDebounce();
      const context = this.buildContext(editor);
      if (context) {
        this.onStable(context);
      }
      return;
    }

    this.cancelDebounce();
    this.pendingEditor = editor;

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      const activeEditor = this.pendingEditor;
      this.pendingEditor = null;

      if (!activeEditor) {
        return;
      }

      const context = this.buildContext(activeEditor);
      if (!context) {
        return;
      }

      this.onStable(context);
    }, this.debounceMs);
  }

  setDebounceMs(ms: number): void {
    this.debounceMs = ms;
  }

  setContextWordCount(count: number): void {
    this.contextWordCount = count;
  }

  cancelPending(): void {
    this.cancelDebounce();
    this.pendingEditor = null;
  }

  destroy(): void {
    this.cancelDebounce();
    this.pendingEditor = null;
  }

  private cancelDebounce(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private buildContext(editor: Editor): EditorContext | null {
    const cursor = editor.getCursor();
    const cursorOffset = editor.posToOffset(cursor);
    const fullText = editor.getValue();

    const extracted = extractLastWords(fullText, this.contextWordCount, cursorOffset);

    if (!extracted.targetWord || !isValidTargetWord(extracted.targetWord)) {
      return null;
    }

    if (!extracted.contextText.trim()) {
      return null;
    }

    return {
      editor,
      fullText,
      contextText: extracted.contextText,
      contextStartOffset: extracted.contextStartOffset,
      targetWord: extracted.targetWord,
      targetWordStart: extracted.targetWordStart,
      targetWordEnd: extracted.targetWordEnd,
      cursorOffset,
    };
  }
}
