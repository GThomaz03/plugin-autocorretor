import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import { IgnoredWordsStore } from './IgnoredWordsStore';
import { LanguageToolClient } from './LanguageToolClient';
import type LanguageToolAutoCorrectPlugin from './main';
import type { LanguageMode } from './types';

export class LTSettingTab extends PluginSettingTab {
  plugin: LanguageToolAutoCorrectPlugin;

  constructor(app: App, plugin: LanguageToolAutoCorrectPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Geral' });

    new Setting(containerEl)
      .setName('Ativar autocorreção')
      .setDesc('Liga ou desliga a correção automática enquanto digita.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enabled)
          .onChange(async (value) => {
            this.plugin.settings.enabled = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Debounce (ms)')
      .setDesc('Tempo de espera após parar de digitar antes de verificar (200–1500 ms).')
      .addSlider((slider) =>
        slider
          .setLimits(200, 1500, 50)
          .setValue(this.plugin.settings.debounceMs)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.debounceMs = value;
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl('h2', { text: 'LanguageTool' });

    new Setting(containerEl)
      .setName('URL do servidor')
      .setDesc('Servidor LanguageTool local. Apenas http/https (ex.: http://localhost:8010).')
      .addText((text) =>
        text
          .setPlaceholder('http://localhost:8010')
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (value) => {
            const trimmed = value.trim();
            if (!trimmed) {
              return;
            }
            this.plugin.settings.serverUrl = trimmed;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Testar conexão')
      .setDesc('Verifica se o servidor local responde e suporta PT/EN.')
      .addButton((button) =>
        button.setButtonText('Testar').onClick(async () => {
          if (!LanguageToolClient.isValidServerUrl(this.plugin.settings.serverUrl)) {
            new Notice('URL do servidor inválida.');
            return;
          }

          button.setButtonText('Testando...');
          button.setDisabled(true);
          try {
            const ok = await this.plugin.testConnection();
            button.setButtonText(ok ? 'Conectado ✓' : 'Falhou ✗');
            new Notice(
              ok
                ? 'LanguageTool conectado com sucesso.'
                : 'Não foi possível conectar ao LanguageTool. Verifique se o Docker está rodando.',
            );
          } finally {
            setTimeout(() => {
              button.setButtonText('Testar');
              button.setDisabled(false);
            }, 2000);
          }
        }),
      );

    containerEl.createEl('h2', { text: 'Correção' });

    new Setting(containerEl)
      .setName('Idioma')
      .setDesc('Automático detecta PT-BR ou EN a cada verificação.')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('auto', 'Automático')
          .addOption('pt-BR', 'Português (BR)')
          .addOption('en', 'Inglês')
          .setValue(this.plugin.settings.languageMode)
          .onChange(async (value) => {
            this.plugin.settings.languageMode = value as LanguageMode;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Palavras de contexto')
      .setDesc('Quantas palavras enviar ao LanguageTool por verificação (3–10).')
      .addSlider((slider) =>
        slider
          .setLimits(3, 10, 1)
          .setValue(this.plugin.settings.contextWordCount)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.contextWordCount = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Confiança mínima')
      .setDesc('Limiar para aplicar correção automática. Valores mais altos = menos correções.')
      .addSlider((slider) =>
        slider
          .setLimits(0.5, 1, 0.05)
          .setValue(this.plugin.settings.minConfidenceScore)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.minConfidenceScore = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Janela de rejeição (ms)')
      .setDesc('Tempo para pressionar Mod+Shift+Z após uma correção (1000–10000 ms).')
      .addSlider((slider) =>
        slider
          .setLimits(1000, 10000, 500)
          .setValue(this.plugin.settings.rejectWindowMs)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.rejectWindowMs = value;
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl('h2', { text: 'Atalhos' });

    containerEl.createEl('p', {
      text: 'Após uma correção automática, pressione Mod+Shift+Z para desfazer e adicionar a palavra à lista de ignorados. Ctrl+Z apenas desfaz, sem aprender.',
      cls: 'setting-item-description',
    });

    containerEl.createEl('h2', { text: 'Palavras ignoradas' });

    const ignoredWords = this.plugin.ignoredStore.toArray();

    if (ignoredWords.length === 0) {
      containerEl.createEl('p', {
        text: 'Nenhuma palavra ignorada.',
        cls: 'setting-item-description',
      });
    } else {
      containerEl.createEl('p', {
        text: `${ignoredWords.length} palavra(s) ignorada(s):`,
        cls: 'setting-item-description',
      });

      for (const word of ignoredWords) {
        new Setting(containerEl)
          .setName(word)
          .addButton((button) =>
            button
              .setButtonText('Remover')
              .setWarning()
              .onClick(async () => {
                this.plugin.settings.ignoredWords =
                  this.plugin.ignoredStore.remove(word);
                await this.plugin.saveSettings();
                this.display();
              }),
          );
      }
    }

    new Setting(containerEl)
      .setName('Limpar todas')
      .setDesc('Remove todas as palavras do dicionário de ignorados.')
      .addButton((button) =>
        button
          .setButtonText('Limpar')
          .setWarning()
          .onClick(async () => {
            const confirmed = confirm(
              'Remover todas as palavras ignoradas? Esta ação não pode ser desfeita.',
            );
            if (!confirmed) {
              return;
            }

            this.plugin.settings.ignoredWords = [];
            this.plugin.ignoredStore = IgnoredWordsStore.fromList([]);
            await this.plugin.saveSettings();
            this.display();
          }),
      );
  }
}
