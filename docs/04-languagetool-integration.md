# 04 — Integração com LanguageTool

## 1. Visão geral

O plugin comunica-se com uma instância **local** do LanguageTool via HTTP. Nenhuma requisição deve ir para `api.languagetool.org`.

**URL base padrão:** `http://localhost:8010`  
**Endpoint de verificação:** `POST /v2/check`  
**Content-Type:** `application/x-www-form-urlencoded`

---

## 2. Subindo o servidor local (referência)

### Docker (recomendado)

```bash
docker run --rm -p 8010:8010 erikvl87/languagetool
```

Ou com imagem oficial:

```bash
docker run -d --name languagetool -p 8010:8010 silviof/docker-languagetool
```

### Verificar saúde

```bash
curl -X POST "http://localhost:8010/v2/check" \
  -d "text=isto e um teste" \
  -d "language=pt-BR"
```

Resposta esperada: JSON com `matches` array (pode estar vazio).

---

## 3. Endpoint: POST /v2/check

### 3.1 Request

| Parâmetro | Obrigatório | Valor no plugin | Descrição |
|-----------|-------------|-----------------|-----------|
| `text` | Sim | `contextText` | Trecho a verificar |
| `language` | Sim | `auto` / `pt-BR` / `en-US` | Idioma ou detecção automática |
| `enabledOnly` | Não | `false` | Todas as regras |
| `level` | Não | `default` | Nível de verificação |

**Exemplo (português):**

```http
POST /v2/check HTTP/1.1
Host: localhost:8010
Content-Type: application/x-www-form-urlencoded

text=fui+na+facudade&language=auto
```

**Exemplo (inglês):**

```http
POST /v2/check HTTP/1.1
Host: localhost:8010
Content-Type: application/x-www-form-urlencoded

text=this+is+an+teh+test&language=auto
```

### 3.2 Implementação TypeScript

```typescript
async function check(text: string, language: string, signal: AbortSignal): Promise<LTCheckResponse> {
  const url = `${this.baseUrl}/v2/check`;
  const body = new URLSearchParams({
    text,
    language,
    enabledOnly: 'false',
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal,
  });

  if (!response.ok) {
    throw new LanguageToolError(`HTTP ${response.status}`, response.status);
  }

  return response.json();
}
```

---

## 4. Response — estrutura relevante

### 4.1 Exemplo completo

```json
{
  "software": {
    "name": "LanguageTool",
    "version": "6.5",
    "buildDate": "2024-09-27 11:27:57 +0200",
    "apiVersion": 1,
    "premium": false
  },
  "language": {
    "name": "Portuguese (Brazil)",
    "code": "pt-BR",
    "detectedLanguage": {
      "name": "Portuguese (Brazil)",
      "code": "pt-BR",
      "confidence": 0.99,
      "source": "fasttext"
    }
  },
  "matches": [
    {
      "message": "Possível erro de ortografia encontrado.",
      "shortMessage": "Erro de ortografia",
      "offset": 7,
      "length": 8,
      "replacements": [
        { "value": "faculdade" }
      ],
      "context": {
        "text": "fui na facudade",
        "offset": 7,
        "length": 8
      },
      "sentence": "fui na facudade",
      "type": { "typeName": "Other" },
      "rule": {
        "id": "HUNSPELL_RULE",
        "description": "Possível erro de ortografia",
        "issueType": "misspelling",
        "category": {
          "id": "TYPOS",
          "name": "Erros de ortografia"
        }
      },
      "contextForSureMatch": 0
    }
  ]
}
```

### 4.2 Campos utilizados pelo plugin

| Campo | Uso |
|-------|-----|
| `matches[].offset` | Posição do erro no `text` enviado |
| `matches[].length` | Comprimento do erro |
| `matches[].replacements` | Sugestões (usar `[0].value` se única) |
| `matches[].rule.issueType` | Filtrar `misspelling` |
| `matches[].rule.category.id` | Preferir `TYPOS` |
| `matches[].contextForSureMatch` | Bônus de confiança |
| `language.detectedLanguage.code` | Detecção PT/EN |
| `language.detectedLanguage.confidence` | Penalidade se baixa |

### 4.3 Campos ignorados (v1)

- `message`, `shortMessage` — não exibir ao usuário
- `rule.urls` — sem UI de ajuda
- `sentenceRanges`, `extendedSentenceRanges` — não necessários

---

## 5. Tipos TypeScript

```typescript
export interface LTReplacement {
  value: string;
}

export interface LTRule {
  id: string;
  description: string;
  issueType: string;
  category: {
    id: string;
    name: string;
  };
}

export interface LTMatch {
  message: string;
  shortMessage: string;
  offset: number;
  length: number;
  replacements: LTReplacement[];
  context: {
    text: string;
    offset: number;
    length: number;
  };
  sentence: string;
  rule: LTRule;
  contextForSureMatch?: number;
  ignoreForIncompleteSentence?: boolean;
}

export interface LTDetectedLanguage {
  name: string;
  code: string;
  confidence: number;
  source?: string;
}

export interface LTCheckResponse {
  software: {
    name: string;
    version: string;
    apiVersion: number;
    premium: boolean;
  };
  language: {
    name: string;
    code: string;
    detectedLanguage?: LTDetectedLanguage;
  };
  matches: LTMatch[];
}
```

---

## 6. Endpoint auxiliar: GET /v2/languages (opcional)

Usado apenas no health check / settings para validar servidor.

```bash
curl http://localhost:8010/v2/languages
```

Retorna array de idiomas suportados. Verificar presença de `pt-BR` e `en-US`.

---

## 7. Tratamento de erros HTTP

| Status | Causa provável | Ação do plugin |
|--------|----------------|----------------|
| 0 / network error | Servidor offline | Silencioso; `healthCheck` = false |
| 400 | Payload inválido | Log error; não corrigir |
| 413 | Texto muito grande | Reduzir `contextWordCount` (não deve ocorrer) |
| 429 | Rate limit | Não aplicável em local; log se ocorrer |
| 500 | Erro interno LT | Silencioso; retry na próxima digitação |
| Timeout (2s) | Servidor lento | Abortar; não corrigir |

```typescript
class LanguageToolError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'LanguageToolError';
  }
}
```

---

## 8. Performance

### 8.1 Metas

| Métrica | Meta |
|---------|------|
| Payload médio | < 50 bytes (5 palavras) |
| Tempo de resposta local | 50–200 ms |
| Requests por minuto | ~60–120 (1 por pausa de digitação) |
| Requests concorrentes | Máximo 1 (cancelar anterior) |

### 8.2 Cancelamento

```typescript
class LanguageToolClient {
  private abortController: AbortController | null = null;

  abortPending(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  async check(text: string, language: string): Promise<LTCheckResponse> {
    this.abortPending();
    this.abortController = new AbortController();

    const timeoutId = setTimeout(() => this.abortController?.abort(), REQUEST_TIMEOUT_MS);

    try {
      return await this.doCheck(text, language, this.abortController.signal);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
```

### 8.3 Cache (NÃO implementar na v1)

Cache de respostas pode causar correções stale. Rejeitado para v1.

---

## 9. Privacidade e segurança

- Todo processamento ocorre em `localhost` — notas não saem da máquina
- Não logar conteúdo completo das notas em produção (apenas debug mode)
- `serverUrl` configurável mas validar esquema `http://` ou `https://`
- Não desabilitar verificação TLS em produção (irrelevante para localhost)

---

## 10. Testes manuais com curl

### Typo PT — deve retornar match

```bash
curl -s -X POST "http://localhost:8010/v2/check" \
  -d "text=facudade" -d "language=pt-BR" | jq '.matches[0].replacements[0].value'
# Esperado: "faculdade"
```

### Palavra válida — não deve retornar match

```bash
curl -s -X POST "http://localhost:8010/v2/check" \
  -d "text=esta casa" -d "language=pt-BR" | jq '.matches | length'
# Esperado: 0 (ou match que será filtrado por ambiguidade)
```

### Detecção automática EN

```bash
curl -s -X POST "http://localhost:8010/v2/check" \
  -d "text=teh quick brown fox" -d "language=auto" | jq '.language.detectedLanguage.code'
# Esperado: "en-*"
```

---

## 11. Referências

- [LanguageTool HTTP Server](https://dev.languagetool.org/http-server)
- [Public HTTP API](https://dev.languagetool.org/public-http-api)
- [Swagger UI](https://languagetool.org/http-api/swagger-ui/#/default/check)
- [Docker Image erikvl87/languagetool](https://hub.docker.com/r/erikvl87/languagetool)
