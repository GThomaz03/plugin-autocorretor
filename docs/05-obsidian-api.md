# 05 — Integração com API do Obsidian

## 1. Visão geral

O plugin usa a **Plugin API** oficial do Obsidian, focando na abstração `Editor` (não CodeMirror direto) para compatibilidade entre plataformas.

**Versão mínima:** Obsidian 1.5.0  
**Template base:** [obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin)

---

## 2. APIs utilizadas (mapa completo)

### 2.1 Plugin lifecycle

| API | Uso |
|-----|-----|
| `Plugin` | Classe base do plugin |
| `onload()` | Inicialização |
| `onunload()` | Cleanup |
| `loadData()` | Carregar settings + ignored words |
| `saveData()` | Persistir settings |
| `registerEvent()` | Registrar listeners com cleanup automático |
| `addCommand()` | Comando de rejeição |
| `addSettingTab()` | UI de configurações |

```typescript
import { Plugin } from 'obsidian';

export default class LanguageToolAutoCorrectPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    // ...
  }

  onunload() {
    this.editorWatcher?.destroy();
    this.ltClient?.abortPending();
  }
}
```

### 2.2 Workspace events

| API | Uso |
|-----|-----|
| `app.workspace.on('editor-change', callback)` | Detectar digitação |
| `app.workspace.getActiveViewOfType(MarkdownView)` | Obter editor ativo |

```typescript
this.registerEvent(
  this.app.workspace.on('editor-change', (editor, info) => {
    this.editorWatcher.handleChange(editor, info);
  })
);
```

**`EditorChange` (info):**

```typescript
interface EditorChange {
  docChanged: boolean;
  origin?: string;  // 'languagetool-autocorrect' quando nós aplicamos
}
```

### 2.3 Editor — leitura

| Método | Uso no plugin |
|--------|---------------|
| `getValue()` | Texto completo (para offsets) |
| `getRange(from, to)` | Validar texto antes de corrigir |
| `getCursor()` | Posição do cursor |
| `posToOffset(pos)` | Converter posição → offset absoluto |
| `offsetToPos(offset)` | Converter offset → posição |
| `somethingSelected()` | Ignorar se há seleção |
| `wordAt(pos)` | **Opcional:** obter bounds da palavra |

```typescript
const cursor = editor.getCursor();
const cursorOffset = editor.posToOffset(cursor);
const textAtMatch = editor.getRange(from, to);
```

### 2.4 Editor — escrita

| Método | Uso no plugin |
|--------|---------------|
| `replaceRange(replacement, from, to, origin)` | Aplicar/reverter correção |
| `setCursor(pos)` | Reposicionar cursor após correção |
| `undo()` | **Não chamar** — usuário usa atalho nativo |

```typescript
const ORIGIN = 'languagetool-autocorrect';
editor.replaceRange('faculdade', from, to, ORIGIN);
editor.setCursor(editor.offsetToPos(newOffset));
```

### 2.5 Commands

| API | Uso |
|-----|-----|
| `addCommand({ id, name, hotkeys, editorCallback })` | Rejeitar correção |

```typescript
this.addCommand({
  id: 'reject-last-correction',
  name: 'Reject last auto-correction and ignore word',
  hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'z' }],
  editorCallback: (editor) => {
    this.autoCorrect.rejectLastCorrection(editor);
  },
});
```

### 2.6 Settings

| API | Uso |
|-----|-----|
| `PluginSettingTab` | UI de configurações |
| `Setting` | Campos individuais |
| `requestUrl` | **Não usar** — usar `fetch` direto |

```typescript
import { App, PluginSettingTab, Setting } from 'obsidian';

class LTSettingTab extends PluginSettingTab {
  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Enable auto-correction')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enabled)
        .onChange(async (value) => {
          this.plugin.settings.enabled = value;
          await this.plugin.saveSettings();
        }));
  }
}
```

---

## 3. manifest.json

```json
{
  "id": "languagetool-autocorrect",
  "name": "LanguageTool AutoCorrect",
  "version": "0.1.0",
  "minAppVersion": "1.5.0",
  "description": "Automatic spelling correction using local LanguageTool server.",
  "author": "Seu Nome",
  "authorUrl": "https://github.com/seu-usuario",
  "isDesktopOnly": false
}
```

**Nota:** Marcar `isDesktopOnly: true` se desistir do suporte mobile (servidor local indisponível).

---

## 4. Estrutura do evento editor-change

### 4.1 Fluxo recomendado

```
editor-change
    │
    ├─ info.docChanged === false → return
    ├─ info.origin === PLUGIN_ORIGIN → return
    ├─ !settings.enabled → return
    ├─ isInIgnoredContext(editor) → return
    ├─ extractEditorContext(editor)
    │     ├─ targetWord vazio → return
    │     └─ isIgnored(targetWord) → return
    └─ debounce → autoCorrect.process(context)
```

### 4.2 Usando `editor.wordAt()` (opcional)

```typescript
const cursor = editor.getCursor();
const wordRange = editor.wordAt(cursor);
if (wordRange) {
  const word = editor.getRange(wordRange.from, wordRange.to);
  // wordRange.from / wordRange.to são EditorPosition
}
```

Preferir `wordAt` se disponível na versão alvo; fallback para tokenização manual (ver doc 02).

---

## 5. Conversão de posições

### 5.1 Offset absoluto

O LanguageTool trabalha com offsets lineares no texto enviado. O Obsidian usa `{ line, ch }`.

```typescript
function getAbsoluteOffset(editor: Editor, pos: EditorPosition): number {
  return editor.posToOffset(pos);
}

function getPositions(editor: Editor, start: number, end: number): { from: EditorPosition; to: EditorPosition } {
  return {
    from: editor.offsetToPos(start),
    to: editor.offsetToPos(end),
  };
}
```

### 5.2 Armadilhas

| Problema | Solução |
|----------|---------|
| `\r\n` vs `\n` | Obsidian normaliza; usar sempre API do Editor |
| Emojis e surrogate pairs | `posToOffset` do Obsidian lida com isso |
| Cursor após correção | Recalcular com `targetWordStart + replacement.length` |

---

## 6. Detecção de contexto ignorado

### 6.1 Code block fenced

```typescript
function isInsideCodeBlock(editor: Editor, cursor: EditorPosition): boolean {
  let fenceCount = 0;
  for (let i = 0; i < cursor.line; i++) {
    const line = editor.getLine(i);
    if (line.trimStart().startsWith('```')) {
      fenceCount++;
    }
  }
  return fenceCount % 2 === 1;
}
```

### 6.2 Inline code

```typescript
function isInsideInlineCode(editor: Editor, cursor: EditorPosition): boolean {
  const line = editor.getLine(cursor.line);
  const before = line.substring(0, cursor.ch);
  const backticks = (before.match(/`/g) || []).length;
  return backticks % 2 === 1;
}
```

---

## 7. Persistência de dados

```typescript
interface PersistedData {
  settings: PluginSettings;
}

async loadSettings() {
  const data = (await this.loadData()) as PersistedData | null;
  this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings);
}

async saveSettings() {
  await this.saveData({ settings: this.settings });
}
```

Arquivo gerado pelo Obsidian:  
`.obsidian/plugins/languagetool-autocorrect/data.json`

---

## 8. Build e desenvolvimento

### 8.1 Dependências

```json
{
  "devDependencies": {
    "obsidian": "latest",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "esbuild": "^0.20.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0"
  }
}
```

### 8.2 Scripts

```json
{
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "node esbuild.config.mjs production"
  }
}
```

### 8.3 Link simbólico para teste

```bash
# Windows (Admin)
mklink /D "%APPDATA%\Obsidian\plugins\languagetool-autocorrect" "C:\caminho\do\plugin"

# macOS/Linux
ln -s /caminho/do/plugin ~/.obsidian/plugins/languagetool-autocorrect
```

---

## 9. APIs do Obsidian NÃO utilizadas (v1)

| API | Motivo |
|-----|--------|
| `registerEditorExtension` (CM6) | Sem decorações na v1 |
| `WorkspaceLeaf` / custom views | Sem UI extra |
| `Notice` | Degradação silenciosa preferida |
| `MetadataCache` | Sem relação com correção |
| `Vault.modify` | Modificamos via Editor, não arquivo direto |

---

## 10. Referências oficiais

| Recurso | URL |
|---------|-----|
| Build a plugin | https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin |
| Editor class | https://docs.obsidian.md/Reference/TypeScript+API/Editor |
| replaceRange | https://docs.obsidian.md/Reference/TypeScript+API/Editor/replaceRange |
| posToOffset | https://docs.obsidian.md/Reference/TypeScript+API/Editor/posToOffset |
| Events | https://docs.obsidian.md/Reference/TypeScript+API/Workspace/on('editor-change') |
| Plugin guidelines | https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines |
| Sample plugin | https://github.com/obsidianmd/obsidian-sample-plugin |
| Editor guide | https://docs.obsidian.md/Plugins/Editor/Editor |
