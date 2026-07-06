# 08 — Testes

## 1. Estratégia de testes

| Nível | Escopo | Ferramenta |
|-------|--------|------------|
| Unitário | `utils/text.ts`, `ConfidenceEvaluator` | Vitest ou Jest (opcional) |
| Integração | `LanguageToolClient` | curl / teste manual com Docker |
| E2E manual | Fluxo completo no Obsidian | Checklist abaixo |

**v1:** Priorizar testes manuais E2E. Testes unitários para `ConfidenceEvaluator` e `extractLastWords` são recomendados mas opcionais.

---

## 2. Pré-requisitos de teste

```bash
# 1. Subir LanguageTool
docker run --rm -p 8010:8010 erikvl87/languagetool

# 2. Verificar
curl -s -X POST "http://localhost:8010/v2/check" \
  -d "text=teste" -d "language=pt-BR" | head -c 100

# 3. Build do plugin
cd obsidian-languagetool-autocorrect
npm install && npm run build

# 4. Link para vault de teste do Obsidian
```

Criar nota de teste: `test-autocorrect.md` com conteúdo vazio.

---

## 3. Critérios de aceite — checklist

### CA-01 — Typo óbvio corrigido (PT)

| Passo | Ação | Resultado esperado |
|-------|------|-------------------|
| 1 | Abrir `test-autocorrect.md` | Editor ativo |
| 2 | Digitar `Hoje fui na facudade` | Texto aparece |
| 3 | Parar de digitar por 1s | Texto vira `Hoje fui na faculdade` |
| 4 | Verificar cursor | Após `faculdade` |

**Status:** [ ] Passou

---

### CA-02 — Ambiguidade não corrigida (PT)

| Passo | Ação | Resultado esperado |
|-------|------|-------------------|
| 1 | Nova linha | — |
| 2 | Digitar `Esta casa é bonita` | Texto aparece |
| 3 | Parar 1s | Permanece `Esta` (não vira `Está`) |

**Status:** [ ] Passou

---

### CA-02b — Ambiguidade não corrigida (EN)

| Passo | Ação | Resultado esperado |
|-------|------|-------------------|
| 1 | Digitar `Their house is big` | Texto aparece |
| 2 | Parar 1s | `Their` não muda para `There` |

**Status:** [ ] Passou

---

### CA-03 — Rejeição e aprendizado

| Passo | Ação | Resultado esperado |
|-------|------|-------------------|
| 1 | Digitar `The teh cat` | Após 1s: `The the cat` |
| 2 | Imediatamente `Mod+Shift+Z` | Volta para `The teh cat` |
| 3 | Abrir settings → ignorados | `teh` na lista |
| 4 | Digitar `teh` em outra linha | Não corrige |

**Status:** [ ] Passou

---

### CA-04 — Sem loop após ignorar

| Passo | Ação | Resultado esperado |
|-------|------|-------------------|
| 1 | Com `teh` ignorado | — |
| 2 | Digitar `teh` múltiplas vezes | Nunca corrige |
| 3 | Esperar 5s entre digitações | Sem requisições de correção |

**Status:** [ ] Passou

---

### CA-05 — Detecção de idioma

| Passo | Ação | Resultado esperado |
|-------|------|-------------------|
| 1 | `languageMode = auto` | — |
| 2 | Digitar `I recieved the package` | Corrige para `received` |
| 3 | Digitar `Eu fui na facudade` | Corrige para `faculdade` |

**Status:** [ ] Passou

---

### CA-06 — Servidor offline

| Passo | Ação | Resultado esperado |
|-------|------|-------------------|
| 1 | Parar container Docker | — |
| 2 | Digitar `facudade` | Permanece `facudade` |
| 3 | Observar | Sem modal de erro |

**Status:** [ ] Passou

---

### CA-07 — Desfazer nativo (Ctrl+Z)

| Passo | Ação | Resultado esperado |
|-------|------|-------------------|
| 1 | Reiniciar Docker | — |
| 2 | Digitar `facudade` → corrigido | `faculdade` |
| 3 | `Ctrl+Z` | Volta `facudade` |
| 4 | Verificar ignorados | `facudade` **não** está na lista |

**Status:** [ ] Passou

---

## 4. Casos de teste adicionais

### TC-01 — Debounce

| Ação | Esperado |
|------|----------|
| Digitar `facudade` letra por letra rápido | Só corrige após parar ~500ms |
| Continuar digitando após correção | Sem crash |

### TC-02 — Múltiplos matches

| Ação | Esperado |
|------|----------|
| Palavra com 2+ sugestões LT | Não corrige automaticamente |

### TC-03 — Code block

| Ação | Esperado |
|------|----------|
| Dentro de \`\`\` code block \`\`\` digitar `facudade` | Não corrige |

### TC-04 — Inline code

| Ação | Esperado |
|------|----------|
| Digitar \`facudade\` (backticks) | Não corrige |

### TC-05 — Seleção ativa

| Ação | Esperado |
|------|----------|
| Selecionar palavra e digitar | Não dispara autocorrect |

### TC-06 — Origin loop prevention

| Ação | Esperado |
|------|----------|
| Correção aplicada | Não dispara segundo editor-change que re-corrige |

### TC-07 — Janela de rejeição expirada

| Ação | Esperado |
|------|----------|
| Corrigir → esperar 4s → Mod+Shift+Z | Não faz nada |

### TC-08 — Settings: alterar debounce

| Ação | Esperado |
|------|----------|
| debounceMs = 1000 | Correção demora ~1s após parar |

### TC-09 — Settings: min confidence

| Ação | Esperado |
|------|----------|
| minConfidenceScore = 0.99 | Menos correções automáticas |

### TC-10 — Remover palavra ignorada

| Ação | Esperado |
|------|----------|
| Remover `teh` da lista | Próxima digitação de `teh` pode corrigir |

---

## 5. Testes unitários sugeridos (opcional)

### ConfidenceEvaluator

```typescript
describe('ConfidenceEvaluator', () => {
  it('aceita typo claro facudade → faculdade', () => {
    const result = evaluator.evaluate(mockMatch('faculdade'), 'facudade', 'faculdade');
    expect(result.isHighConfidence).toBe(true);
  });

  it('rejeita palavra ambígua esta → está', () => {
    const result = evaluator.evaluate(mockMatch('está'), 'esta', 'está');
    expect(result.isHighConfidence).toBe(false);
  });

  it('rejeita múltiplas sugestões', () => {
    const match = mockMatch(['opt1', 'opt2']);
    const result = evaluator.evaluate(match, 'word', 'opt1');
    expect(result.isHighConfidence).toBe(false);
  });
});
```

### extractLastWords

```typescript
describe('extractLastWords', () => {
  it('extrai última palavra e contexto de 5 palavras', () => {
    const text = 'Hoje eu fui na facudade';
    const result = extractLastWords(text, 5);
    expect(result.targetWord).toBe('facudade');
    expect(result.contextText).toBe('Hoje eu fui na facudade');
  });
});
```

### IgnoredWordsStore

```typescript
describe('IgnoredWordsStore', () => {
  it('case insensitive', () => {
    const store = new IgnoredWordsStore(new Set(['Teh']));
    expect(store.isIgnored('teh')).toBe(true);
    expect(store.isIgnored('TEH')).toBe(true);
  });
});
```

---

## 6. Testes de performance

| Cenário | Meta | Como medir |
|---------|------|------------|
| Latência local | < 300ms | `console.time` em `AutoCorrect.process` |
| Nota 10.000 linhas | Sem lag | Digitar no final da nota |
| 100 palavras ignoradas | Sem degradação | Tempo de `isIgnored` < 1ms |
| Requests concorrentes | Apenas 1 ativo | Log de requests no client |

---

## 7. Regressões conhecidas a evitar

| Bug | Sintoma | Prevenção |
|-----|---------|-----------|
| Loop infinito | Palavra oscila entre original e correção | `PLUGIN_ORIGIN` + mutex |
| Correção stale | Substitui texto errado após cursor mover | `requestGeneration` check |
| Falso positivo PT | `esta` → `está` | `AMBIGUOUS_WORDS` |
| Crash offline | Modal de erro | try/catch silencioso no client |
| Perda de ignorados | Lista some ao reload | `saveSettings` após `add()` |

---

## 8. Definition of Done (release 0.1.0)

- [ ] CA-01 a CA-07 passam
- [ ] TC-01 a TC-07 passam
- [ ] `npm run build` sem erros TypeScript
- [ ] README com instruções de instalação
- [ ] Nenhuma requisição para domínio externo (verificar DevTools Network)
- [ ] Plugin funciona com Obsidian 1.5+ desktop
