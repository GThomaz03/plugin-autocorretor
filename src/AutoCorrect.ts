import type { Editor, EditorPosition } from 'obsidian';
import { ConfidenceEvaluator } from './ConfidenceEvaluator';
import { PLUGIN_ORIGIN } from './constants';
import { LanguageToolClient } from './LanguageToolClient';
import type { IgnoredWordsStore } from './IgnoredWordsStore';
import type { ContextToken } from './utils/text';
import type { EditorContext, LastCorrection, LTMatch, PluginSettings } from './types';
import {
  extractContextTokens,
  pickBestReplacement,
  rangesIntersect,
  resolveLanguageParam,
} from './utils/text';

type IgnoredWordsChangedCallback = (words: string[]) => void | Promise<void>;

const SELF_CHANGE_SUPPRESS_MS = 150;

interface CorrectionCandidate {
  from: EditorPosition;
  to: EditorPosition;
  original: string;
  replacement: string;
}

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

    const tokens = extractContextTokens(
      context.contextText,
      context.contextStartOffset,
    );
    if (tokens.length === 0) {
      return;
    }

    const detectedConfidence =
      response.language.detectedLanguage?.confidence ?? 1;
    const evaluator = new ConfidenceEvaluator(
      settings.minConfidenceScore,
      detectedConfidence,
    );

    const candidates = this.buildCandidates(
      context,
      response.matches,
      tokens,
      evaluator,
    );
    if (candidates.length === 0) {
      return;
    }

    this.applyCorrections(
      context.editor,
      candidates,
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

  private buildCandidates(
    context: EditorContext,
    matches: LTMatch[],
    tokens: ContextToken[],
    evaluator: ConfidenceEvaluator,
  ): CorrectionCandidate[] {
    const sortedTokens = [...tokens].sort((a, b) => b.start - a.start);
    const usedTokenStarts = new Set<number>();
    const candidates: CorrectionCandidate[] = [];

    for (const token of sortedTokens) {
      if (this.ignoredStore.isIgnored(token.word)) {
        continue;
      }

      const overlapping = matches.filter((match) => {
        if (match.replacements.length === 0) {
          return false;
        }

        const absStart = context.contextStartOffset + match.offset;
        const absEnd = absStart + match.length;
        return rangesIntersect(absStart, absEnd, token.start, token.end);
      });

      if (overlapping.length !== 1) {
        continue;
      }

      const match = overlapping[0]!;
      const absStart = context.contextStartOffset + match.offset;
      const absEnd = absStart + match.length;
      const from = context.editor.offsetToPos(absStart);
      const to = context.editor.offsetToPos(absEnd);
      const original = context.editor.getRange(from, to);

      const replacement = pickBestReplacement(original, match.replacements);
      if (!replacement || original === replacement) {
        continue;
      }

      const singleReplacementMatch: LTMatch = {
        ...match,
        replacements: [{ value: replacement }],
      };

      const confidence = evaluator.evaluate(
        singleReplacementMatch,
        original,
        replacement,
      );
      if (!confidence.isHighConfidence) {
        continue;
      }

      if (usedTokenStarts.has(token.start)) {
        continue;
      }
      usedTokenStarts.add(token.start);

      candidates.push({ from, to, original, replacement });
    }

    return candidates;
  }

  private isContextStillValid(context: EditorContext): boolean {
    const currentSlice = context.editor
      .getValue()
      .slice(
        context.contextStartOffset,
        context.contextStartOffset + context.contextText.length,
      );
    return currentSlice === context.contextText;
  }

  private applyCorrections(
    editor: Editor,
    candidates: CorrectionCandidate[],
    rejectWindowMs: number,
    cursorOffsetBefore: number,
  ): void {
    this.applyingCorrection = true;
    try {
      this.markSelfOriginatedChange();

      for (const candidate of candidates) {
        editor.replaceRange(
          candidate.replacement,
          candidate.from,
          candidate.to,
          PLUGIN_ORIGIN,
        );
      }

      const last = candidates[candidates.length - 1]!;
      this.lastCorrection = {
        original: last.original,
        replacement: last.replacement,
        from: last.from,
        to: last.to,
        editor,
        timestamp: Date.now(),
        expiresAt: Date.now() + rejectWindowMs,
        cursorOffsetBefore,
      };
    } finally {
      this.applyingCorrection = false;
    }
  }

  private markSelfOriginatedChange(): void {
    this.suppressChangesUntil = Date.now() + SELF_CHANGE_SUPPRESS_MS;
  }
}
