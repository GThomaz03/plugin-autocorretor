import type { Editor, EditorPosition } from 'obsidian';
import { ConfidenceEvaluator } from './ConfidenceEvaluator';
import { PLUGIN_ORIGIN } from './constants';
import { LanguageToolClient } from './LanguageToolClient';
import type { IgnoredWordsStore } from './IgnoredWordsStore';
import type { EditorContext, LastCorrection, LTMatch, PluginSettings } from './types';
import { rangesIntersect, resolveLanguageParam } from './utils/text';

type IgnoredWordsChangedCallback = (words: string[]) => void | Promise<void>;

const SELF_CHANGE_SUPPRESS_MS = 150;

export class AutoCorrect {
  private lastCorrection: LastCorrection | null = null;
  private applyingCorrection = false;
  private requestGeneration = 0;
  private suppressChangesUntil = 0;

  constructor(
    private ltClient: LanguageToolClient,
    private ignoredStore: IgnoredWordsStore,
    private getSettings: () => PluginSettings,
    private onIgnoredWordsChanged?: IgnoredWordsChangedCallback,
  ) {}

  isApplyingCorrection(): boolean {
    return this.applyingCorrection;
  }

  shouldIgnoreEditorChange(): boolean {
    if (this.applyingCorrection) {
      return true;
    }
    if (Date.now() < this.suppressChangesUntil) {
      return true;
    }
    return false;
  }

  /** Invalida correção pendente após Ctrl+Z ou edição manual */
  validateLastCorrection(editor: Editor): void {
    const correction = this.lastCorrection;
    if (!correction || correction.editor !== editor) {
      return;
    }

    if (Date.now() >= correction.expiresAt) {
      this.lastCorrection = null;
      return;
    }

    const currentText = editor.getRange(correction.from, correction.to);
    if (currentText !== correction.replacement) {
      this.lastCorrection = null;
    }
  }

  async process(context: EditorContext): Promise<void> {
    if (this.ignoredStore.isIgnored(context.targetWord)) {
      return;
    }

    const settings = this.getSettings();
    const generation = ++this.requestGeneration;
    const language = resolveLanguageParam(settings.languageMode);

    let response;
    try {
      response = await this.ltClient.check(context.contextText, language);
    } catch (error) {
      if (LanguageToolClient.isAbortError(error)) {
        return;
      }
      console.debug('[LanguageTool AutoCorrect] check failed:', error);
      return;
    }

    if (generation !== this.requestGeneration) {
      return;
    }

    if (!this.isContextStillValid(context)) {
      return;
    }

    const detectedConfidence =
      response.language.detectedLanguage?.confidence ?? 1;
    const evaluator = new ConfidenceEvaluator(
      settings.minConfidenceScore,
      detectedConfidence,
    );

    const match = this.selectMatch(context, response.matches);
    if (!match) {
      return;
    }

    const replacement = match.replacements[0]?.value;
    if (!replacement) {
      return;
    }

    const absStart = context.contextStartOffset + match.offset;
    const absEnd = absStart + match.length;
    const from = context.editor.offsetToPos(absStart);
    const to = context.editor.offsetToPos(absEnd);
    const original = context.editor.getRange(from, to);

    if (original === replacement) {
      return;
    }

    const confidence = evaluator.evaluate(match, original, replacement);
    if (!confidence.isHighConfidence) {
      return;
    }

    this.applyCorrection(
      context.editor,
      original,
      replacement,
      from,
      to,
      settings.rejectWindowMs,
      context.cursorOffset,
    );
  }

  rejectLastCorrection(editor: Editor): boolean {
    const correction = this.lastCorrection;
    if (!correction) {
      return false;
    }

    if (Date.now() >= correction.expiresAt) {
      this.lastCorrection = null;
      return false;
    }

    if (correction.editor !== editor) {
      return false;
    }

    const currentText = editor.getRange(correction.from, correction.to);
    if (currentText !== correction.replacement) {
      this.lastCorrection = null;
      return false;
    }

    this.applyingCorrection = true;
    try {
      this.markSelfOriginatedChange();
      editor.replaceRange(
        correction.original,
        correction.from,
        correction.to,
        PLUGIN_ORIGIN,
      );

      editor.setCursor(editor.offsetToPos(correction.cursorOffsetBefore));

      const words = this.ignoredStore.add(correction.original);
      void this.onIgnoredWordsChanged?.(words);

      this.lastCorrection = null;
      return true;
    } finally {
      this.applyingCorrection = false;
    }
  }

  clearLastCorrection(): void {
    this.lastCorrection = null;
  }

  abortPending(): void {
    this.requestGeneration++;
    this.ltClient.abortPending();
  }

  private selectMatch(
    context: EditorContext,
    matches: LTMatch[],
  ): LTMatch | null {
    const overlapping = matches.filter((match) => {
      if (match.replacements.length !== 1) {
        return false;
      }

      const absStart = context.contextStartOffset + match.offset;
      const absEnd = absStart + match.length;
      return rangesIntersect(
        absStart,
        absEnd,
        context.targetWordStart,
        context.targetWordEnd,
      );
    });

    if (overlapping.length !== 1) {
      return null;
    }

    return overlapping[0] ?? null;
  }

  private isContextStillValid(context: EditorContext): boolean {
    const from = context.editor.offsetToPos(context.targetWordStart);
    const to = context.editor.offsetToPos(context.targetWordEnd);
    return context.editor.getRange(from, to) === context.targetWord;
  }

  private applyCorrection(
    editor: Editor,
    original: string,
    replacement: string,
    from: EditorPosition,
    to: EditorPosition,
    rejectWindowMs: number,
    cursorOffsetBefore: number,
  ): void {
    const replaceStart = editor.posToOffset(from);
    const replaceEnd = editor.posToOffset(to);

    this.applyingCorrection = true;
    try {
      this.markSelfOriginatedChange();
      editor.replaceRange(replacement, from, to, PLUGIN_ORIGIN);

      this.restoreCursorAfterReplacement(
        editor,
        replaceStart,
        replaceEnd,
        replacement.length,
        cursorOffsetBefore,
      );

      this.lastCorrection = {
        original,
        replacement,
        from,
        to,
        editor,
        timestamp: Date.now(),
        expiresAt: Date.now() + rejectWindowMs,
        cursorOffsetBefore,
      };
    } finally {
      this.applyingCorrection = false;
    }
  }

  /**
   * Mantém o cursor onde o usuário estava digitando.
   * Só ajusta pelo delta do texto substituído — nunca puxa para o início da correção.
   */
  private restoreCursorAfterReplacement(
    editor: Editor,
    replaceStart: number,
    replaceEnd: number,
    replacementLength: number,
    cursorOffsetBefore: number,
  ): void {
    const replacedLength = replaceEnd - replaceStart;
    const lengthDelta = replacementLength - replacedLength;

    if (cursorOffsetBefore > replaceStart && cursorOffsetBefore < replaceEnd) {
      editor.setCursor(editor.offsetToPos(replaceStart + replacementLength));
      return;
    }

    if (cursorOffsetBefore >= replaceEnd) {
      editor.setCursor(editor.offsetToPos(cursorOffsetBefore + lengthDelta));
    }
  }

  private markSelfOriginatedChange(): void {
    this.suppressChangesUntil = Date.now() + SELF_CHANGE_SUPPRESS_MS;
  }
}
