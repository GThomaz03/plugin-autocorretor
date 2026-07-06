# LanguageTool AutoCorrect

Plugin Obsidian que corrige erros de escrita automaticamente usando um servidor **LanguageTool local**.

## Funcionalidades

- Autocorreção enquanto digita (estilo Word)
- Somente correções com alta confiança
- `Mod+Shift+Z` para desfazer e aprender palavra ignorada
- Detecção automática PT-BR / EN
- Servidor local (`localhost:8010`) — nenhum dado enviado à internet

## Pré-requisitos

- Obsidian Desktop 1.5+
- [Docker](https://www.docker.com/) (para o LanguageTool)

## Instalação

### 1. Subir o LanguageTool

```bash
docker run --rm -p 8010:8010 erikvl87/languagetool
```

### 2. Instalar o plugin

```bash
git clone <repo-url> obsidian-languagetool-autocorrect
cd obsidian-languagetool-autocorrect
npm install
npm run build
```

Copie a pasta para o vault:

```powershell
# Windows — ajuste os caminhos
Copy-Item -Recurse . "C:\caminho\do\vault\.obsidian\plugins\languagetool-autocorrect"
```

Ou crie um link simbólico (requer Admin):

```powershell
mklink /D "%VAULT%\.obsidian\plugins\languagetool-autocorrect" "C:\caminho\do\plugin"
```

### 3. Ativar no Obsidian

**Configurações → Plugins da comunidade → LanguageTool AutoCorrect → Ativar**

## Uso

1. Digite normalmente em qualquer nota Markdown
2. Após ~500 ms sem digitar, typos óbvios são corrigidos (ex.: `facudade` → `faculdade`)
3. Para rejeitar uma correção: `Mod+Shift+Z` em até 3 segundos
4. `Ctrl+Z` desfaz sem adicionar à lista de ignorados

## Configurações

Abra **Configurações → LanguageTool AutoCorrect**:

| Opção | Padrão | Descrição |
|-------|--------|-----------|
| Debounce | 500 ms | Espera após parar de digitar |
| URL do servidor | `http://localhost:8010` | LanguageTool local |
| Idioma | Automático | PT-BR, EN ou auto |
| Confiança mínima | 0.85 | Limiar para autocorreção |
| Janela de rejeição | 3000 ms | Tempo para `Mod+Shift+Z` |

## Desenvolvimento

```bash
npm run dev    # watch mode
npm run build  # produção
npm test       # testes de aceite (lógica)
```

## Especificação

Documentação completa em [`docs/`](docs/).

## Licença

MIT
