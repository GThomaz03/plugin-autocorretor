# 03 — Regras de Negócio

Este documento define **todas** as decisões que o código deve implementar. É a fonte de verdade para lógica de correção.

---

## 1. Quando disparar verificação

| Condição | Disparar? |
|----------|-----------|
| Plugin `enabled = true` | Sim |
| Editor em modo edição (MarkdownView) | Sim |
| `info.docChanged = true` | Sim |
| `info.origin = 'languagetool-autocorrect'` | **Não** |
| Plugin está aplicando correção (`isApplyingCorrection`) | **Não** |
| Texto selecionado (selection não vazia) | **Não** |
| Cursor dentro de bloco de código (\`\`\` ou indentado) | **Não** |
| Cursor dentro de link/wiki-link `[[...]]` | **Não** |
| Palavra com apenas números/símbolos | **Não** |
| Palavra length < 2 | **Não** |
| Palavra no dicionário de ignorados | **Não** |

Após passar nos filtros, aguardar `debounceMs` (padrão 500 ms) sem novos `editor-change`.

---

## 2. O que enviar ao LanguageTool

### 2.1 Texto

- Enviar `contextText`: últimas `contextWordCount` palavras antes/incluindo cursor
- **Não** enviar documento inteiro
- Incluir a palavra incompleta sendo digitada (ex.: `facud` → enviar como está; LT pode ou não retornar match — se não retornar, aguardar próximo debounce)

### 2.2 Idioma

| `languageMode` | Parâmetro `language` |
|----------------|---------------------|
| `auto` | `auto` |
| `pt-BR` | `pt-BR` |
| `en` | `en-US` |

### 2.3 Pós-processamento do idioma detectado

Após resposta, ler `response.language.detectedLanguage.code` (se disponível):

```
detected = response.language.detectedLanguage?.code ?? response.language.code

if detected starts with "pt" → usar pt-BR
else if detected starts with "en" → usar en-US  
else → fallback pt-BR (usuário é 90% PT)
```

Se `languageMode` não é `auto`, ignorar detecção e usar idioma fixo.

---

## 3. Regras de alta confiança

A API local do LanguageTool **não fornece** percentual de confiança por replacement (ex.: "98%"). Portanto usamos **heurísticas compostas** que produzem um `confidenceScore` de 0.0 a 1.0.

### 3.1 Critérios obrigatórios (todos devem ser verdadeiros)

| # | Critério | Motivo |
|---|----------|--------|
| C1 | `match.replacements.length === 1` | Múltiplas sugestões = ambiguidade |
| C2 | `match.rule.issueType === 'misspelling'` | Exclui gramática e estilo |
| C3 | Match intersecta `targetWord` | Corrigir só o que o usuário está digitando |
| C4 | `editor.getRange(from,to) === original` | Evita corrida com edição concorrente |
| C5 | `original !== replacement` | Evita no-op |
| C6 | `confidenceScore >= minConfidenceScore` | Limiar configurável (padrão 0.85) |

### 3.2 Cálculo do `confidenceScore`

Começar em `1.0` e aplicar penalidades:

```typescript
function calculateConfidence(match: LTMatch, original: string, replacement: string): number {
  let score = 1.0;

  // Penalidade: categoria não é typo puro
  if (match.rule.category?.id !== 'TYPOS') {
    score -= 0.4;
  }

  // Penalidade: múltiplas sugiestões (já filtrado, mas segurança)
  if (match.replacements.length > 1) {
    return 0;
  }

  // Penalidade: diferença grande entre palavras (pode ser troca gramatical)
  const similarity = normalizedLevenshteinSimilarity(original, replacement);
  if (similarity < 0.5) {
    score -= 0.5;
  } else if (similarity < 0.7) {
    score -= 0.2;
  }

  // Bônus: similaridade alta (typo clássico)
  if (similarity >= 0.75 && similarity < 1.0) {
    score += 0.1;
  }

  // Penalidade: palavras de função ambíguas PT/EN
  if (AMBIGUOUS_WORDS.has(original.toLowerCase())) {
    score -= 0.6;
  }

  // Bônus: contextForSureMatch (quando LT fornece)
  if (match.contextForSureMatch && match.contextForSureMatch >= 1) {
    score += 0.15;
  }

  // Penalidade: detecção de idioma com baixa confiança
  if (detectedLanguageConfidence < 0.7) {
    score -= 0.15;
  }

  return clamp(score, 0, 1);
}
```

### 3.3 Lista de palavras ambíguas (não autocorrigir)

```typescript
const AMBIGUOUS_WORDS = new Set([
  // PT
  'esta', 'está', 'estas', 'estás',
  'porque', 'por que', 'porquê', 'por quê',
  'mas', 'mais',
  'sem', 'som',
  'hora', 'ora',
  'apoia', 'apóia',
  'mau', 'mal',
  'todo', 'tudo',
  // EN
  'their', 'there', "they're",
  'your', "you're",
  'its', "it's",
  'then', 'than',
  'affect', 'effect',
]);
```

Se `original.toLowerCase()` está em `AMBIGUOUS_WORDS` → `confidenceScore = 0` (não corrigir).

### 3.4 Exemplos

| Entrada | Replacement | Score estimado | Corrige? |
|---------|-------------|----------------|----------|
| `facudade` | `faculdade` | ~0.95 | Sim |
| `recieve` | `receive` | ~0.92 | Sim |
| `esta` | `está` | 0 (ambígua) | Não |
| `teh` | `the` | ~0.90 | Sim |
| `acess` | `access` / `acessar` | 0 (2+ replacements) | Não |

---

## 4. Seleção do match correto

Dado array `matches` da resposta:

1. Converter cada match para offsets absolutos
2. Filtrar matches que intersectam `[targetWordStart, targetWordEnd)`
3. Se `matches.length === 0` → não corrigir
4. Se `matches.length > 1` → não corrigir (ambiguidade)
5. Avaliar confiança do match único
6. Aplicar `replacements[0].value`

---

## 5. Aplicação da correção

```typescript
const ORIGIN = 'languagetool-autocorrect';

isApplyingCorrection = true;
try {
  editor.replaceRange(replacement, from, to, ORIGIN);

  // Ajustar cursor se estava no fim da palavra
  const newCursorOffset = targetWordStart + replacement.length;
  editor.setCursor(editor.offsetToPos(newCursorOffset));

  lastCorrection = {
    original,
    replacement,
    from,
    to,
    editor,
    timestamp: Date.now(),
    expiresAt: Date.now() + settings.rejectWindowMs,
  };
} finally {
  isApplyingCorrection = false;
}
```

**Não** usar `replaceSelection` — sempre `replaceRange` com posições calculadas.

---

## 6. Desfazer e aprender (rejeição)

### 6.1 Atalho

- **Comando:** `Reject last auto-correction`
- **ID:** `reject-last-correction`
- **Hotkey padrão:** `Mod+Shift+Z`

### 6.2 Condições para rejeição válida

| Condição | Obrigatório |
|----------|-------------|
| `lastCorrection !== null` | Sim |
| `Date.now() < lastCorrection.expiresAt` | Sim |
| Editor ativo é o mesmo de `lastCorrection.editor` | Sim |
| Texto atual em `from..to` === `replacement` | Sim |

### 6.3 Ações na rejeição

1. `editor.replaceRange(original, from, to, ORIGIN)` — restaurar
2. `ignoredWordsStore.add(original)` — aprendizado
3. `lastCorrection = null`
4. Posicionar cursor no fim da palavra restaurada

### 6.4 Normalização no dicionário

- Armazenar palavra **como digitada** (`original`)
- Comparação `isIgnored`: case-insensitive (`toLowerCase()`)
- Não armazenar duplicatas

### 6.5 Ctrl+Z vs Mod+Shift+Z

| Ação | Comportamento |
|------|---------------|
| `Ctrl+Z` / `Cmd+Z` | Undo nativo; **não** adiciona ao dicionário |
| `Mod+Shift+Z` | Reverte + adiciona ao dicionário |

Documentar isso na settings tab.

---

## 7. Detecção de idioma PT-BR vs EN

### 7.1 Estratégia primária

Usar detecção do LanguageTool (`language=auto`):

```json
{
  "language": {
    "code": "pt-BR",
    "detectedLanguage": {
      "code": "pt-BR",
      "confidence": 0.93
    }
  }
}
```

### 7.2 Normalização de códigos

```typescript
function normalizeLanguage(code: string): 'pt-BR' | 'en-US' {
  const c = code.toLowerCase();
  if (c.startsWith('pt')) return 'pt-BR';
  if (c.startsWith('en')) return 'en-US';
  return 'pt-BR'; // fallback
}
```

### 7.3 Heurística local (fallback se LT não detectar)

Se `detectedLanguage` ausente, analisar `targetWord` + `contextText`:

- Caracteres `ã`, `õ`, `ç`, `á`, `é`, `í`, `ó`, `ú`, `â`, `ê`, `ô` → PT
- Palavras PT comuns no contexto (`de`, `da`, `não`, `que`, `para`) → +peso PT
- Palavras EN comuns (`the`, `and`, `is`, `are`, `with`) → +peso EN
- Se empate → `pt-BR`

**Nota:** A heurística local **não** substitui o parâmetro da API; serve apenas para logging e validação cruzada.

### 7.4 Texto misto (PT com termos EN)

Exemplo: "Preciso configurar o **database** do projeto"

- Enviar janela de 5 palavras ao LT com `language=auto`
- LT detecta idioma dominante do trecho
- Corrigir apenas `targetWord` se match for alta confiança
- Termos técnicos em inglês dentro de frase PT: geralmente **não** terão match de typo → nenhuma ação

---

## 8. Blocos ignorados (não verificar)

Detectar contexto do cursor via análise de linhas anteriores:

| Contexto | Detecção |
|----------|----------|
| Code block fenced | Linha anterior com \`\`\` aberto (contagem ímpar) |
| Inline code | Cursor entre backticks na mesma linha |
| Frontmatter YAML | Cursor entre `---` no início do arquivo |
| Link URL | Cursor entre `(` e `)` após `](` |

Implementação mínima v1: **code blocks** e **inline code** (suficiente para notas típicas).

---

## 9. Palavras ignoradas — ciclo de vida

```
┌─────────────┐     add()      ┌──────────────────┐
│  Correção   │───────────────▶│ ignoredWords     │
│  rejeitada  │                │ (persistido)     │
└─────────────┘                └────────┬─────────┘
                                        │
                              isIgnored() retorna true
                                        │
                                        ▼
                               Próximas digitações:
                               skip LanguageTool call
                               (otimização) ou skip apply
```

**Otimização:** Se `isIgnored(targetWord)`, nem chamar LanguageTool (economiza latência).

**Gerenciamento:** Settings tab lista palavras ignoradas com botão remover.

---

## 10. Constantes padrão

```typescript
export const DEFAULT_SETTINGS = {
  enabled: true,
  serverUrl: 'http://localhost:8010',
  debounceMs: 500,
  rejectWindowMs: 3000,
  languageMode: 'auto' as const,
  contextWordCount: 5,
  minConfidenceScore: 0.85,
  ignoredWords: [] as string[],
};

export const PLUGIN_ORIGIN = 'languagetool-autocorrect';
export const REQUEST_TIMEOUT_MS = 2000;
```
