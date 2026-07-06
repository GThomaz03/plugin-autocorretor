export class IgnoredWordsStore {
  /** lowercase key → palavra como armazenada (casing original) */
  private words: Map<string, string>;

  constructor(words: Map<string, string>) {
    this.words = words;
  }

  static fromList(words: string[]): IgnoredWordsStore {
    const map = new Map<string, string>();
    for (const word of words) {
      map.set(word.toLowerCase(), word);
    }
    return new IgnoredWordsStore(map);
  }

  isIgnored(word: string): boolean {
    return this.words.has(word.toLowerCase());
  }

  add(word: string): string[] {
    this.words.set(word.toLowerCase(), word);
    return this.toArray();
  }

  remove(word: string): string[] {
    this.words.delete(word.toLowerCase());
    return this.toArray();
  }

  toArray(): string[] {
    return Array.from(this.words.values()).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    );
  }
}
