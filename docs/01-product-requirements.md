# 01 — Product Requirements Document (PRD)

## 1. Visão do produto

### 1.1 Problema

Usuários do Obsidian que escrevem notas longas em português (e ocasionalmente em inglês) não têm autocorreção automática confiável integrada ao editor. Plugins existentes focam em sublinhar erros ou exigir ação manual; não há solução consolidada que corrija **enquanto digita** usando LanguageTool **local**.

### 1.2 Solução

Plugin Obsidian que monitora a digitação, consulta um servidor LanguageTool local e aplica correções ortográficas automaticamente quando a confiança é alta — com mecanismo de desfazer que ensina o plugin a não repetir correções indesejadas.

### 1.3 Usuário-alvo

- Escreve notas diárias, documentação e rascunhos no Obsidian
- Já roda LanguageTool via Docker em `localhost:8010`
- Quer comportamento similar ao autocorrect do Microsoft Word
- Aceita correção automática **somente** para erros óbvios (typos)

---

## 2. Escopo funcional (v1)

### 2.1 Funcionalidades incluídas

#### F1 — Autocorreção automática

- O plugin DEVE corrigir erros de escrita automaticamente após o usuário parar de digitar por um intervalo configurável (padrão: 500 ms).
- A correção DEVE ocorrer apenas na **última palavra** (ou token) sendo editada, não no documento inteiro.
- O usuário DEVE poder desfazer qualquer correção com `Ctrl+Z` / `Cmd+Z` (comportamento nativo do editor).

#### F2 — Alta confiança

- O plugin DEVE aplicar correções **somente** quando o match satisfizer **todas** as regras de alta confiança definidas em [03-business-rules.md](03-business-rules.md#3-regras-de-alta-confiança).
- Erros ambíguos (ex.: `esta` → `está`, `por que` → `porque`) NÃO DEVEM ser corrigidos automaticamente.

#### F3 — Desfazer e aprender (ignorar palavra)

- Após uma correção automática, o plugin DEVE abrir uma **janela de rejeição** (padrão: 3 segundos).
- Se o usuário pressionar o atalho de rejeição (`Mod+Shift+Z`) nesse período:
  1. A correção DEVE ser revertida (texto original restaurado).
  2. A palavra original DEVE ser adicionada ao **dicionário de ignorados**.
  3. O plugin NÃO DEVE tentar corrigir essa palavra novamente (mesmo contexto, mesmo arquivo, qualquer arquivo).
- O dicionário de ignorados DEVE persistir entre sessões.

#### F4 — Detecção de idioma (PT-BR e EN)

- O plugin DEVE suportar **apenas** português brasileiro (`pt-BR`) e inglês (`en`).
- O idioma DEVE ser detectado automaticamente a cada requisição (via LanguageTool `language=auto`).
- Se o idioma detectado não for PT ou EN, o plugin DEVE usar `pt-BR` como fallback.
- O usuário PODE forçar um idioma nas configurações (`auto` | `pt-BR` | `en`).

#### F5 — Servidor local e baixa latência

- O plugin DEVE usar exclusivamente servidor LanguageTool local (padrão: `http://localhost:8010`).
- O plugin DEVE enviar apenas um trecho curto de texto (janela de contexto) para minimizar latência.
- Requisições DEVE ser debounced e canceláveis (nova digitação cancela requisição pendente).

---

### 2.2 Funcionalidades explicitamente excluídas (v1)

| Exclusão | Motivo |
|----------|--------|
| Sublinhado / decoração visual de erros | Fora do escopo |
| Painel de sugestões / menu de replacements | Fora do escopo |
| Correção gramatical automática | Risco alto de falsos positivos |
| Mais de 2 idiomas | Escopo fechado pelo usuário |
| API pública `api.languagetool.org` | Privacidade e rate limits |
| Correção em arquivos não-Markdown | Complexidade desnecessária |
| Sincronização do dicionário entre dispositivos | v2+ |
| Modo "destacar palavra corrigida por 2s" | Não solicitado na lista final |

---

## 3. Requisitos não funcionais

| ID | Requisito | Meta |
|----|-----------|------|
| RNF-01 | Latência percebida após parar de digitar | < 300 ms (rede local) |
| RNF-02 | Impacto na digitação | Imperceptível (async, sem bloquear UI) |
| RNF-03 | Memória do dicionário de ignorados | Suportar 10.000+ entradas |
| RNF-04 | Compatibilidade Obsidian | Desktop 1.5+ (mobile: melhor esforço) |
| RNF-05 | Privacidade | Nenhum dado enviado para internet |
| RNF-06 | Falha do servidor | Degradação silenciosa (sem popup intrusivo) |

---

## 4. Configurações do usuário

| Configuração | Tipo | Padrão | Descrição |
|--------------|------|--------|-----------|
| `enabled` | boolean | `true` | Liga/desliga o plugin |
| `serverUrl` | string | `http://localhost:8010` | URL base do LanguageTool |
| `debounceMs` | number | `500` | Ms após parar de digitar |
| `rejectWindowMs` | number | `3000` | Janela para rejeitar correção |
| `languageMode` | enum | `auto` | `auto` \| `pt-BR` \| `en` |
| `contextWordCount` | number | `5` | Palavras enviadas ao LT |
| `minConfidenceScore` | number | `0.85` | Limiar heurístico (0–1) |
| `ignoredWords` | string[] | `[]` | Dicionário de ignorados |

---

## 5. Critérios de aceite (Definition of Done)

### CA-01 — Typo óbvio corrigido

**Dado** que o plugin está ativo e o servidor responde  
**Quando** o usuário digita `facudade` e pausa 500 ms  
**Então** o texto vira `faculdade` automaticamente

### CA-02 — Ambiguidade não corrigida

**Dado** que o plugin está ativo  
**Quando** o usuário digita `esta casa` (sentença válida)  
**Então** o texto permanece `esta casa` (sem trocar para `está`)

### CA-03 — Rejeição e aprendizado

**Dado** que o plugin corrigiu `teh` → `the`  
**Quando** o usuário pressiona `Mod+Shift+Z` dentro de 3 s  
**Então** o texto volta para `teh` e `teh` entra no dicionário de ignorados

### CA-04 — Sem loop após ignorar

**Dado** que `teh` está no dicionário de ignorados  
**Quando** o usuário digita `teh` novamente  
**Então** nenhuma correção automática ocorre

### CA-05 — Detecção de idioma

**Dado** `languageMode = auto`  
**Quando** o usuário digita texto claramente em inglês  
**Então** a requisição usa idioma detectado `en` (ou variante `en-*`)

### CA-06 — Servidor offline

**Dado** que o servidor em `localhost:8010` está indisponível  
**Quando** o usuário digita normalmente  
**Então** nenhum erro modal aparece; o plugin continua funcionando sem correções

### CA-07 — Desfazer nativo

**Dado** que uma correção foi aplicada  
**Quando** o usuário pressiona `Ctrl+Z`  
**Então** a correção é desfeita (stack de undo do editor)

---

## 6. Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|-------|---------------|-----------|
| Falso positivo em palavra válida | Média | Regras de alta confiança + dicionário de ignorados |
| Loop de correção | Baixa | Flag `isApplyingCorrection` + origin customizado |
| LanguageTool sem score de confiança por match | Alta | Heurísticas compostas (ver doc 03) |
| Latência em notas muito longas | Baixa | Enviar só janela de contexto |
| Mobile sem servidor local | Alta | Documentar como desktop-first |

---

## 7. Métricas de sucesso (pós-lançamento)

- Taxa de rejeição (`Mod+Shift+Z`) < 5% das correções
- Zero relatos de loop infinito de correção
- Tempo médio correção < 300 ms em ambiente local
