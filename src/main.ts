import { Plugin } from 'obsidian';
import { AutoCorrect } from './AutoCorrect';
import { DEFAULT_SETTINGS } from './constants';
import { EditorWatcher } from './EditorWatcher';
import { IgnoredWordsStore } from './IgnoredWordsStore';
import { LanguageToolClient } from './LanguageToolClient';
import { LTSettingTab } from './settings';
import type { PersistedData, PluginSettings } from './types';
import { isInsideIgnoredContext } from './utils/context';

export default class LanguageToolAutoCorrectPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  ignoredStore!: IgnoredWordsStore;
  private ltClient!: LanguageToolClient;
  private autoCorrect!: AutoCorrect;
  private editorWatcher!: EditorWatcher;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.ltClient = LanguageToolClient.tryCreate(
      this.settings.serverUrl,
      DEFAULT_SETTINGS.serverUrl,
    );
    this.ignoredStore = IgnoredWordsStore.fromList(this.settings.ignoredWords);

    this.autoCorrect = new AutoCorrect(
      this.ltClient,
      this.ignoredStore,
      () => this.settings,
      async (words) => {
        this.settings.ignoredWords = words;
        await this.saveSettings();
      },
    );

    this.editorWatcher = new EditorWatcher(
      this.settings.debounceMs,
      this.settings.contextWordCount,
      (ctx) => void this.autoCorrect.process(ctx),
    );

    this.registerEvent(
      this.app.workspace.on('editor-change', (editor, _ctx) => {
        if (!this.settings.enabled) return;

        this.autoCorrect.validateLastCorrection(editor);

        if (this.autoCorrect.shouldIgnoreEditorChange()) return;
        if (isInsideIgnoredContext(editor)) return;

        this.editorWatcher.handleChange(editor);
      }),
    );

    this.addCommand({
      id: 'reject-last-correction',
      name: 'Reject last auto-correction and ignore word',
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'z' }],
      editorCallback: (editor) => {
        void this.autoCorrect.rejectLastCorrection(editor);
      },
    });

    this.addSettingTab(new LTSettingTab(this.app, this));
  }

  onunload(): void {
    this.editorWatcher?.destroy();
    this.autoCorrect?.abortPending();
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as PersistedData | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings);

    if (!LanguageToolClient.isValidServerUrl(this.settings.serverUrl)) {
      this.settings.serverUrl = DEFAULT_SETTINGS.serverUrl;
    }
  }

  async saveSettings(): Promise<void> {
    this.settings.ignoredWords = this.ignoredStore.toArray();
    await this.saveData({ settings: this.settings });

    if (!this.ltClient.trySetBaseUrl(this.settings.serverUrl)) {
      this.settings.serverUrl = this.ltClient.getBaseUrl();
    }

    this.editorWatcher?.setDebounceMs(this.settings.debounceMs);
    this.editorWatcher?.setContextWordCount(this.settings.contextWordCount);

    if (!this.settings.enabled) {
      this.editorWatcher?.cancelPending();
      this.autoCorrect?.abortPending();
    }
  }

  async testConnection(): Promise<boolean> {
    if (!this.ltClient.trySetBaseUrl(this.settings.serverUrl)) {
      return false;
    }
    return this.ltClient.healthCheck();
  }
}
