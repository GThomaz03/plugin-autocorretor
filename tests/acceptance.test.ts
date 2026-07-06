import { describe, expect, it } from 'vitest';
import { ConfidenceEvaluator } from '../src/ConfidenceEvaluator';
import { DEFAULT_SETTINGS } from '../src/constants';
import { IgnoredWordsStore } from '../src/IgnoredWordsStore';
import type { LTMatch } from '../src/types';
import { extractLastWords } from '../src/utils/text';

function mockMatch(replacement: string, extra?: Partial<LTMatch>): LTMatch {
  return {
    message: 'typo',
    shortMessage: 'typo',
    offset: 0,
    length: 0,
    replacements: [{ value: replacement }],
    context: { text: '', offset: 0, length: 0 },
    sentence: '',
    rule: {
      id: 'HUNSPELL_RULE',
      description: 'typo',
      issueType: 'misspelling',
      category: { id: 'TYPOS', name: 'Typos' },
    },
    ...extra,
  };
}

describe('CA-01 — typo óbvio corrigido', () => {
  it('facudade → faculdade tem alta confiança', () => {
    const evaluator = new ConfidenceEvaluator(DEFAULT_SETTINGS.minConfidenceScore);
    const result = evaluator.evaluate(mockMatch('faculdade'), 'facudade', 'faculdade');
    expect(result.isHighConfidence).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.85);
  });

  it('trabalo → trabalho tem alta confiança com melhor sugestão', () => {
    const evaluator = new ConfidenceEvaluator(DEFAULT_SETTINGS.minConfidenceScore);
    const result = evaluator.evaluate(mockMatch('trabalho'), 'trabalo', 'trabalho');
    expect(result.isHighConfidence).toBe(true);
  });

  it('extractLastWords isola a última palavra', () => {
    const text = 'Hoje fui na facudade';
    const result = extractLastWords(text, 5, text.length);
    expect(result.targetWord).toBe('facudade');
    expect(result.contextText).toBe('Hoje fui na facudade');
  });
});

describe('CA-02 — ambiguidade não corrigida', () => {
  it('esta → está é rejeitada', () => {
    const evaluator = new ConfidenceEvaluator(DEFAULT_SETTINGS.minConfidenceScore);
    const result = evaluator.evaluate(mockMatch('está'), 'esta', 'está');
    expect(result.isHighConfidence).toBe(false);
  });

  it('Esta → Está é rejeitada (case insensitive)', () => {
    const evaluator = new ConfidenceEvaluator(DEFAULT_SETTINGS.minConfidenceScore);
    const result = evaluator.evaluate(mockMatch('Está'), 'Esta', 'Está');
    expect(result.isHighConfidence).toBe(false);
  });

  it('their → there é rejeitada', () => {
    const evaluator = new ConfidenceEvaluator(DEFAULT_SETTINGS.minConfidenceScore);
    const result = evaluator.evaluate(mockMatch('there'), 'their', 'there');
    expect(result.isHighConfidence).toBe(false);
  });
});

describe('CA-03 / CA-04 — rejeição e ignorados', () => {
  it('teh → the tem alta confiança', () => {
    const evaluator = new ConfidenceEvaluator(DEFAULT_SETTINGS.minConfidenceScore);
    const result = evaluator.evaluate(mockMatch('the'), 'teh', 'the');
    expect(result.isHighConfidence).toBe(true);
  });

  it('palavra ignorada é detectada case-insensitive', () => {
    const store = IgnoredWordsStore.fromList(['teh']);
    expect(store.isIgnored('teh')).toBe(true);
    expect(store.isIgnored('TEH')).toBe(true);
    expect(store.isIgnored('Teh')).toBe(true);
  });

  it('add preserva casing original', () => {
    const store = IgnoredWordsStore.fromList([]);
    store.add('Teh');
    expect(store.toArray()).toEqual(['Teh']);
    expect(store.isIgnored('teh')).toBe(true);
  });
});

describe('CA-05 — detecção de idioma', () => {
  it('resolveLanguageParam auto', async () => {
    const { resolveLanguageParam } = await import('../src/utils/text');
    expect(resolveLanguageParam('auto')).toBe('auto');
    expect(resolveLanguageParam('pt-BR')).toBe('pt-BR');
    expect(resolveLanguageParam('en')).toBe('en-US');
  });

  it('recieve → receive tem alta confiança (EN)', () => {
    const evaluator = new ConfidenceEvaluator(DEFAULT_SETTINGS.minConfidenceScore);
    const result = evaluator.evaluate(mockMatch('received'), 'recieved', 'received');
    expect(result.isHighConfidence).toBe(true);
  });
});

describe('TC-02 — múltiplas sugestões', () => {
  it('rejeita match quando nenhuma sugestão é próxima', () => {
    const evaluator = new ConfidenceEvaluator(DEFAULT_SETTINGS.minConfidenceScore);
    const match = mockMatch('opt1', {
      replacements: [{ value: 'opt1' }, { value: 'opt2' }],
    });
    const result = evaluator.evaluate(match, 'word', 'opt1');
    expect(result.isHighConfidence).toBe(false);
  });

  it('pickBestReplacement escolhe trabalho para trabalo', async () => {
    const { pickBestReplacement } = await import('../src/utils/text');
    const { normalizedLevenshteinSimilarity } = await import('../src/utils/text');
    const reps = [
      'travá-lo',
      'trabalho',
      'travado',
      'tabalo',
    ].map((value) => ({ value }));
    const best = pickBestReplacement('trabalo', reps);
    expect(best).toBe('trabalho');
    expect(normalizedLevenshteinSimilarity('trabalo', best!)).toBeGreaterThanOrEqual(0.7);
  });

  it('facudade com 2 sugestões escolhe faculdade', async () => {
    const { pickBestReplacement } = await import('../src/utils/text');
    const best = pickBestReplacement('facudade', [
      { value: 'faculdade' },
      { value: 'Faculdade' },
    ]);
    expect(best).toBe('faculdade');
  });
});

describe('TC-09 — confiança mínima', () => {
  it('limiar 0.99 rejeita correções borderline', () => {
    const strict = new ConfidenceEvaluator(0.99);
    const result = strict.evaluate(mockMatch('the'), 'teh', 'the');
    expect(result.isHighConfidence).toBe(false);
  });
});
