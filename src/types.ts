import type { Editor, EditorPosition } from 'obsidian';

export type LanguageMode = 'auto' | 'pt-BR' | 'en';

export interface PluginSettings {
  enabled: boolean;
  serverUrl: string;
  debounceMs: number;
  rejectWindowMs: number;
  languageMode: LanguageMode;
  contextWordCount: number;
  minConfidenceScore: number;
  ignoredWords: string[];
}

export interface EditorContext {
  editor: Editor;
  fullText: string;
  contextText: string;
  contextStartOffset: number;
  targetWord: string;
  targetWordStart: number;
  targetWordEnd: number;
  cursorOffset: number;
}

export interface LastCorrection {
  original: string;
  replacement: string;
  from: EditorPosition;
  to: EditorPosition;
  editor: Editor;
  timestamp: number;
  expiresAt: number;
}

export interface CorrectionCandidate {
  original: string;
  replacement: string;
  from: EditorPosition;
  to: EditorPosition;
  confidenceScore: number;
  match: LTMatch;
}

export interface LTReplacement {
  value: string;
}

export interface LTRule {
  id: string;
  description: string;
  issueType: string;
  category: { id: string; name: string };
}

export interface LTMatch {
  message: string;
  shortMessage: string;
  offset: number;
  length: number;
  replacements: LTReplacement[];
  context: { text: string; offset: number; length: number };
  sentence: string;
  rule: LTRule;
  contextForSureMatch?: number;
}

export interface LTDetectedLanguage {
  name: string;
  code: string;
  confidence: number;
}

export interface LTCheckResponse {
  language: {
    code: string;
    detectedLanguage?: LTDetectedLanguage;
  };
  matches: LTMatch[];
}

export interface PersistedData {
  settings: PluginSettings;
}

export interface EditorChangeInfo {
  docChanged: boolean;
  origin?: string;
}

export interface ConfidenceResult {
  score: number;
  isHighConfidence: boolean;
}
