# Especificação — LanguageTool AutoCorrect para Obsidian

Documentação de engenharia para implementação do plugin. Leia nesta ordem:

1. **[01-product-requirements.md](01-product-requirements.md)** — O que construir e o que *não* construir
2. **[02-system-architecture.md](02-system-architecture.md)** — Visão arquitetural e fluxos
3. **[03-business-rules.md](03-business-rules.md)** — Regras de correção, confiança, idioma, ignore
4. **[04-languagetool-integration.md](04-languagetool-integration.md)** — Contrato HTTP com LanguageTool
5. **[05-obsidian-api.md](05-obsidian-api.md)** — Integração com editor e plugin API
6. **[06-project-structure.md](06-project-structure.md)** — Arquivos, classes, interfaces TypeScript
7. **[07-implementation-plan.md](07-implementation-plan.md)** — Tarefas sequenciais para o Cursor
8. **[08-testing.md](08-testing.md)** — Casos de teste manuais e automatizáveis

## Convenções desta especificação

- **DEVE** = requisito obrigatório
- **PODE** = opcional, mas recomendado
- **NÃO DEVE** = proibido na v1
- Offset sempre em **caracteres UTF-16** (compatível com `Editor.posToOffset`)
- Servidor padrão: `http://localhost:8010`

## Glossário

| Termo | Definição |
|-------|-----------|
| **Janela de contexto** | Trecho de texto enviado ao LanguageTool (última sentença ou N palavras) |
| **Match** | Um erro detectado pelo LanguageTool com offset, length e replacements |
| **Correção aplicada** | Substituição feita pelo plugin via `editor.replaceRange` |
| **Janela de rejeição** | Período após correção em que o usuário pode desfazer e ensinar o plugin |
| **Dicionário de ignorados** | Lista persistente de palavras que o plugin nunca corrige automaticamente |
| **Alta confiança** | Conjunto de heurísticas que classificam um match como seguro para autocorreção |

## Referências externas (links oficiais)

- [Obsidian Plugin Developer Docs](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin)
- [Obsidian Editor API](https://docs.obsidian.md/Reference/TypeScript+API/Editor)
- [LanguageTool HTTP API](https://dev.languagetool.org/http-server)
- [LanguageTool JSON API (Swagger)](https://languagetool.org/http-api/swagger-ui/)
- [Obsidian Sample Plugin](https://github.com/obsidianmd/obsidian-sample-plugin)
- [Plugin Guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)
