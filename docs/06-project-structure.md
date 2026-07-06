# 06 — Estrutura do Projeto e Especificação Técnica

## 1. Árvore de arquivos

```
obsidian-languagetool-autocorrect/
├── docs/                          # Esta especificação
├── src/
│   ├── main.ts                    # Entry point do plugin
│   ├── settings.ts                # Settings + SettingTab
│   ├── types.ts                   # Interfaces compartilhadas
│   ├── constants.ts               # Constantes globais
│   ├── LanguageToolClient.ts      # Cliente HTTP
│   ├── ConfidenceEvaluator.ts     # Heurísticas de confiança
│   ├── IgnoredWordsStore.ts       # Dicionário de ignorados
│   ├── EditorWatcher.ts           # Debounce + extração de contexto
│   ├── AutoCorrect.ts             # Orquestrador principal
│   └── utils/
│       ├── text.ts                # Tokenização, offsets, similaridade
│       └── context.ts               # Detecção code block / inline code
├── manifest.json
├── versions.json
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── styles.css                     # Vazio na v1 (reservado)
├── .gitignore
├── LICENSE
└── README.md
```

**Estimativa:** 500–700 linhas de TypeScript.

---

## 2. manifest.json

```json
{
  "id": "languagetool-autocorrect",
  "name": "LanguageTool AutoCorrect",
  "version": "0.1.0",
  "minAppVersion": "1.5.0",
  "description": "Correção ortográfica automática usando LanguageTool local.",
  "author": "Gabriel Thomaz",
  "isDesktopOnly": false
}
```

---

## 3. types.ts — Interfaces centrais

```typescript
import type { Editor, EditorPosition } from 'obsidian';

// ─── Settings ───────────────────────────────────────────────

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

// ─── Editor context ───────────────────────────────────────

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

// ─── Correction state ─────────────────────────────────────

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

// ─── LanguageTool ───────────────────────────────────────────

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
```

---

## 4. constants.ts

```typescript
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
```

---

## 5. Classes — responsabilidades e assinaturas

### 5.1 LanguageToolClient

```typescript
export class LanguageToolClient {
  constructor(private baseUrl: string) {}

  setBaseUrl(url: string): void;

  abortPending(): void;

  async check(text: string, language: string): Promise<LTCheckResponse>;

  async healthCheck(): Promise<boolean>;
}
```

### 5.2 ConfidenceEvaluator

```typescript
export class ConfidenceEvaluator {
  constructor(
    private minScore: number,
    private detectedLanguageConfidence: number = 1,
  ) {}

  evaluate(match: LTMatch, original: string, replacement: string): {
    score: number;
    isHighConfidence: boolean;
  };
}
```

### 5.3 IgnoredWordsStore

```typescript
export class IgnoredWordsStore {
  constructor(private words: Set<string>) {}

  static fromList(words: string[]): IgnoredWordsStore;

  isIgnored(word: string): boolean;

  add(word: string): string[];  // retorna lista atualizada

  remove(word: string): string[];

  toArray(): string[];
}
```

### 5.4 EditorWatcher

```typescript
export class EditorWatcher {
  constructor(
    private debounceMs: number,
    private contextWordCount: number,
    private onStable: (ctx: EditorContext) => void,
  ) {}

  handleChange(editor: Editor, info: { docChanged: boolean; origin?: string }): void;

  destroy(): void;
}
```

### 5.5 AutoCorrect

```typescript
export class AutoCorrect {
  constructor(
    private ltClient: LanguageToolClient,
    private ignoredStore: IgnoredWordsStore,
    private getSettings: () => PluginSettings,
  ) {}

  private lastCorrection: LastCorrection | null = null;
  private isApplyingCorrection = false;
  private requestGeneration = 0;

  async process(context: EditorContext): Promise<void>;

  rejectLastCorrection(editor: Editor): boolean;

  clearLastCorrection(): void;
}
```

### 5.6 LTSettingTab

```typescript
export class LTSettingTab extends PluginSettingTab {
  display(): void;
  // Seções: Geral, LanguageTool, Correção, Palavras ignoradas, Testar conexão
}
```

---

## 6. utils/text.ts

```typescript
/** Últimas N palavras antes do offset (inclusive palavra parcial) */
export function extractLastWords(text: string, count: number): {
  contextText: string;
  contextStartOffset: number;
  targetWord: string;
  targetWordStart: number;
  targetWordEnd: number;
};

/** Similaridade normalizada 0–1 baseada em Levenshtein */
export function normalizedLevenshteinSimilarity(a: string, b: string): number;

/** Verifica interseção de dois intervalos [start, end) */
export function rangesIntersect(
  aStart: number, aEnd: number,
  bStart: number, bEnd: number,
): boolean;

export function clamp(value: number, min: number, max: number): number;

export function resolveLanguageParam(mode: LanguageMode): string;

export function normalizeDetectedLanguage(code: string): 'pt-BR' | 'en-US';
```

---

## 7. utils/context.ts

```typescript
export function isInsideIgnoredContext(editor: Editor): boolean;

export function isInsideCodeBlock(editor: Editor, cursor: EditorPosition): boolean;

export function isInsideInlineCode(editor: Editor, cursor: EditorPosition): boolean;
```

---

## 8. main.ts — esqueleto

```typescript
import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, PLUGIN_ORIGIN } from './constants';
import type { PluginSettings } from './types';
import { LanguageToolClient } from './LanguageToolClient';
import { IgnoredWordsStore } from './IgnoredWordsStore';
import { EditorWatcher } from './EditorWatcher';
import { AutoCorrect } from './AutoCorrect';
import { LTSettingTab } from './settings';
import { isInsideIgnoredContext } from './utils/context';

export default class LanguageToolAutoCorrectPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  private ltClient!: LanguageToolClient;
  private ignoredStore!: IgnoredWordsStore;
  private autoCorrect!: AutoCorrect;
  private editorWatcher!: EditorWatcher;

  async onload() {
    await this.loadSettings();
    this.ignoredStore = IgnoredWordsStore.fromList(this.settings.ignoredWords);
    this.ltClient = new LanguageToolClient(this.settings.serverUrl);
    this.autoCorrect = new AutoCorrect(
      this.ltClient,
      this.ignoredStore,
      () => this.settings,
    );
    this.editorWatcher = new EditorWatcher(
      this.settings.debounceMs,
      this.settings.contextWordCount,
      (ctx) => this.autoCorrect.process(ctx),
    );

    this.registerEvent(
      this.app.workspace.on('editor-change', (editor, info) => {
        if (!this.settings.enabled) return;
        if (info.origin === PLUGIN_ORIGIN) return;
        if (isInsideIgnoredContext(editor)) return;
        this.editorWatcher.handleChange(editor, info);
      }),
    );

    this.addCommand({
      id: 'reject-last-correction',
      name: 'Reject last auto-correction and ignore word',
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'z' }],
      editorCallback: (editor) => this.autoCorrect.rejectLastCorrection(editor),
    });

    this.addSettingTab(new LTSettingTab(this.app, this));
  }

  onunload() {
    this.editorWatcher?.destroy();
    this.ltClient?.abortPending();
  }

  async loadSettings() { /* ... */ }
  async saveSettings() { /* ... */ }
}
```

---

## 9. Settings UI — campos

| Seção | Campo | Componente |
|-------|-------|------------|
| Geral | Enable | Toggle |
| Geral | Debounce (ms) | Slider 200–1500 |
| LanguageTool | Server URL | Text input |
| LanguageTool | Test connection | Button → healthCheck |
| Correção | Language mode | Dropdown: auto / pt-BR / en |
| Correção | Context words | Slider 3–10 |
| Correção | Min confidence | Slider 0.5–1.0 step 0.05 |
| Correção | Reject window (ms) | Slider 1000–10000 |
| Ignorados | Word list | List + remove button |
| Ignorados | Clear all | Button com confirmação |

**Texto de ajuda para Mod+Shift+Z:**

> Após uma correção automática, pressione Mod+Shift+Z em até 3 segundos para desfazer e adicionar a palavra à lista de ignorados. Ctrl+Z apenas desfaz, sem aprender.

---

## 10. package.json mínimo

```json
{
  "name": "obsidian-languagetool-autocorrect",
  "version": "0.1.0",
  "description": "Automatic spelling correction using local LanguageTool",
  "main": "main.js",
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "node esbuild.config.mjs production"
  },
  "keywords": ["obsidian", "languagetool", "autocorrect"],
  "license": "MIT",
  "devDependencies": {
    "obsidian": "latest",
    "@types/node": "^20.14.0",
    "typescript": "^5.5.0",
    "esbuild": "^0.21.0",
    "builtin-modules": "^4.0.0"
  }
}
```

---

## 11. tsconfig.json

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "inlineSourceMap": true,
    "inlineSources": true,
    "module": "ESNext",
    "target": "ES6",
    "allowJs": true,
    "noImplicitAny": true,
    "moduleResolution": "node",
    "importHelpers": true,
    "isolatedModules": true,
    "strictNullChecks": true,
    "lib": ["DOM", "ES6"]
  },
  "include": ["src/**/*.ts"]
}
```
