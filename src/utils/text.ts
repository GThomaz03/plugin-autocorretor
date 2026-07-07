import type { LanguageMode } from '../types';

export interface ExtractLastWordsResult {
  contextText: string;
  contextStartOffset: number;
  targetWord: string;
  targetWordStart: number;
  targetWordEnd: number;
}

interface WordToken {
  word: string;
  start: number;
  end: number;
}

const WORD_REGEX = /[\p{L}\p{N}][\p{L}\p{M}\p{N}'_-]*/gu;

function tokenizeWords(text: string): WordToken[] {
  const tokens: WordToken[] = [];
  let match: RegExpExecArray | null;

  while ((match = WORD_REGEX.exec(text)) !== null) {
    tokens.push({
      word: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return tokens;
}

function findSentenceStart(text: string): number {
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === '.' || ch === '!' || ch === '?' || ch === '\n') {
      return i + 1;
    }
  }
  return 0;
}

const EMPTY_RESULT: ExtractLastWordsResult = {
  contextText: '',
  contextStartOffset: 0,
  targetWord: '',
  targetWordStart: 0,
  targetWordEnd: 0,
};

/** Últimas N palavras antes do offset (inclusive palavra parcial) */
export function extractLastWords(
  text: string,
  count: number,
  cursorOffset: number,
): ExtractLastWordsResult {
  if (cursorOffset <= 0 || count < 1) {
    return { ...EMPTY_RESULT };
  }

  const textBeforeCursor = text.slice(0, cursorOffset);
  const tokens = tokenizeWords(textBeforeCursor);

  if (tokens.length === 0) {
    return { ...EMPTY_RESULT };
  }

  const target = tokens[tokens.length - 1]!;
  let contextStart: number;

  if (tokens.length < 2) {
    contextStart = findSentenceStart(textBeforeCursor);
  } else {
    const contextTokens = tokens.slice(-count);
    contextStart = contextTokens[0]!.start;
  }

  return {
    contextText: textBeforeCursor.slice(contextStart),
    contextStartOffset: contextStart,
    targetWord: target.word,
    targetWordStart: target.start,
    targetWordEnd: target.end,
  };
}

export interface ContextToken {
  word: string;
  start: number;
  end: number;
}

const WORD_BOUNDARY_CHARS = /[\s,.!?;:)\]}"'»«]/;

/** Verdadeiro quando o cursor está logo após espaço ou pontuação (palavra recém-finalizada) */
export function isAfterWordBoundary(fullText: string, cursorOffset: number): boolean {
  if (cursorOffset < 1) {
    return false;
  }
  return WORD_BOUNDARY_CHARS.test(fullText[cursorOffset - 1]!);
}

/** Tokens absolutos no trecho de contexto enviado ao LanguageTool */
export function extractContextTokens(
  contextText: string,
  contextStartOffset: number,
): ContextToken[] {
  return tokenizeWords(contextText)
    .filter((token) => isValidTargetWord(token.word))
    .map((token) => ({
      word: token.word,
      start: contextStartOffset + token.start,
      end: contextStartOffset + token.end,
    }));
}

/** Palavra válida para verificação: >= 2 chars e contém letra */
export function isValidTargetWord(word: string): boolean {
  if (word.length < 2) return false;
  return /\p{L}/u.test(word);
}

function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i++) {
    matrix[i]![0] = i;
  }
  for (let j = 0; j < cols; j++) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost,
      );
    }
  }

  return matrix[a.length]![b.length]!;
}

/** Similaridade normalizada 0–1 baseada em distância de Levenshtein */
export function normalizedLevenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  const maxLen = Math.max(a.length, b.length);
  return 1 - distance / maxLen;
}

/** Escolhe a sugestão mais próxima do texto original (para matches com múltiplas opções do LT) */
export function pickBestReplacement(
  original: string,
  replacements: { value: string }[],
): string | null {
  if (replacements.length === 0) {
    return null;
  }

  let best = replacements[0]!.value;
  let bestSim = normalizedLevenshteinSimilarity(original, best);

  for (const r of replacements.slice(1)) {
    const sim = normalizedLevenshteinSimilarity(original, r.value);
    if (sim > bestSim) {
      bestSim = sim;
      best = r.value;
    }
  }

  // Evita aplicar sugestão irrelevante quando LT retorna dezenas de opções
  if (replacements.length > 1 && bestSim < 0.6) {
    return null;
  }

  return best;
}

export function rangesIntersect(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function resolveLanguageParam(mode: LanguageMode): string {
  switch (mode) {
    case 'pt-BR':
      return 'pt-BR';
    case 'en':
      return 'en-US';
    default:
      return 'auto';
  }
}

export function normalizeDetectedLanguage(code: string): 'pt-BR' | 'en-US' {
  const c = code.toLowerCase();
  if (c.startsWith('pt')) return 'pt-BR';
  if (c.startsWith('en')) return 'en-US';
  return 'pt-BR';
}
