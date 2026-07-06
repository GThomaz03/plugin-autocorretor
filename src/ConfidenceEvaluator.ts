import { AMBIGUOUS_WORDS } from './constants';
import type { ConfidenceResult, LTMatch } from './types';
import { clamp, normalizedLevenshteinSimilarity } from './utils/text';

export class ConfidenceEvaluator {
  constructor(
    private minScore: number,
    private detectedLanguageConfidence = 1,
  ) {}

  evaluate(match: LTMatch, original: string, replacement: string): ConfidenceResult {
    if (AMBIGUOUS_WORDS.has(original.toLowerCase())) {
      return { score: 0, isHighConfidence: false };
    }

    if (match.replacements.length !== 1) {
      return { score: 0, isHighConfidence: false };
    }

    if (match.rule.issueType !== 'misspelling') {
      return { score: 0, isHighConfidence: false };
    }

    if (original === replacement) {
      return { score: 0, isHighConfidence: false };
    }

    const score = this.calculateScore(match, original, replacement);
    return {
      score,
      isHighConfidence: score >= this.minScore,
    };
  }

  setMinScore(minScore: number): void {
    this.minScore = minScore;
  }

  setDetectedLanguageConfidence(confidence: number): void {
    this.detectedLanguageConfidence = confidence;
  }

  getMinScore(): number {
    return this.minScore;
  }

  private calculateScore(match: LTMatch, original: string, replacement: string): number {
    let score = 1.0;

    if (match.rule.category?.id !== 'TYPOS') {
      score -= 0.4;
    }

    if (match.replacements.length > 1) {
      return 0;
    }

    const similarity = normalizedLevenshteinSimilarity(original, replacement);

    if (similarity < 0.5) {
      score -= 0.5;
    } else if (similarity < 0.7) {
      score -= 0.2;
    }

    if (similarity >= 0.75 && similarity < 1.0) {
      score += 0.1;
    }

    // Typo de uma letra em palavra curta (ex.: facudade → faculdade)
    const maxLen = Math.max(original.length, replacement.length);
    if (maxLen <= 5 && similarity >= 0.5 && similarity < 1.0) {
      const editDistance = Math.round((1 - similarity) * maxLen);
      if (editDistance === 1) {
        score += 0.15;
      }
    }

    // Transposição adjacente em palavra curta (ex.: teh → the, recieve → receive parcial)
    if (
      maxLen <= 5 &&
      isAdjacentTransposition(original.toLowerCase(), replacement.toLowerCase())
    ) {
      score += 0.4;
    }

    if (match.contextForSureMatch !== undefined && match.contextForSureMatch >= 1) {
      score += 0.15;
    }

    if (this.detectedLanguageConfidence < 0.7) {
      score -= 0.15;
    }

    return clamp(score, 0, 1);
  }
}

function isAdjacentTransposition(a: string, b: string): boolean {
  if (a.length !== b.length || a.length < 2) {
    return false;
  }

  const diffs: number[] = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      diffs.push(i);
    }
  }

  return (
    diffs.length === 2 &&
    diffs[1]! - diffs[0]! === 1 &&
    a[diffs[0]!] === b[diffs[1]!] &&
    a[diffs[1]!] === b[diffs[0]!]
  );
}
