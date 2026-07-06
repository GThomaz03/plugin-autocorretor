import type { PluginSettings } from './types';

export const PLUGIN_ORIGIN = 'languagetool-autocorrect';

export const DEFAULT_SETTINGS: PluginSettings = {
  enabled: true,
  serverUrl: 'http://localhost:8010',
  debounceMs: 500,
  rejectWindowMs: 3000,
  languageMode: 'auto',
  contextWordCount: 5,
  minConfidenceScore: 0.85,
  ignoredWords: [],
};

export const REQUEST_TIMEOUT_MS = 2000;

export const AMBIGUOUS_WORDS = new Set([
  'esta', 'está', 'estas', 'estás',
  'porque', 'por que', 'porquê', 'por quê',
  'mas', 'mais', 'sem', 'som', 'hora', 'ora',
  'apoia', 'apóia', 'mau', 'mal', 'todo', 'tudo',
  'their', 'there', "they're",
  'your', "you're", 'its', "it's",
  'then', 'than', 'affect', 'effect',
]);
