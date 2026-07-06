import { REQUEST_TIMEOUT_MS } from './constants';
import type { LTCheckResponse } from './types';

export class LanguageToolError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'LanguageToolError';
  }
}

export class LanguageToolAbortedError extends LanguageToolError {
  constructor(message = 'Request aborted') {
    super(message, 0);
    this.name = 'LanguageToolAbortedError';
  }
}

interface LanguageEntry {
  code?: string;
  longCode?: string;
}

export class LanguageToolClient {
  private abortController: AbortController | null = null;

  constructor(private baseUrl: string) {
    this.baseUrl = LanguageToolClient.normalizeBaseUrl(baseUrl);
  }

  static tryCreate(baseUrl: string, fallback: string): LanguageToolClient {
    try {
      return new LanguageToolClient(baseUrl);
    } catch {
      return new LanguageToolClient(fallback);
    }
  }

  setBaseUrl(url: string): void {
    this.baseUrl = LanguageToolClient.normalizeBaseUrl(url);
  }

  trySetBaseUrl(url: string): boolean {
    try {
      this.baseUrl = LanguageToolClient.normalizeBaseUrl(url);
      return true;
    } catch {
      return false;
    }
  }

  static isValidServerUrl(url: string): boolean {
    try {
      LanguageToolClient.normalizeBaseUrl(url);
      return true;
    } catch {
      return false;
    }
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  abortPending(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  async check(text: string, language: string): Promise<LTCheckResponse> {
    if (!text.trim()) {
      return { language: { code: language === 'auto' ? 'pt-BR' : language }, matches: [] };
    }

    this.abortPending();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const timeoutId = setTimeout(() => {
      this.abortController?.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
      return await this.doCheck(text, language, signal);
    } catch (error) {
      throw this.wrapError(error);
    } finally {
      clearTimeout(timeoutId);
      this.abortController = null;
    }
  }

  async healthCheck(): Promise<boolean> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.baseUrl}/v2/languages`, {
        method: 'GET',
        signal: controller.signal,
      });

      if (!response.ok) {
        return false;
      }

      const languages = (await response.json()) as LanguageEntry[];
      if (!Array.isArray(languages)) {
        return false;
      }

      const codes = languages.flatMap((lang) => [lang.code, lang.longCode].filter(Boolean));
      const hasPortuguese = codes.some((code) => code!.toLowerCase().startsWith('pt'));
      const hasEnglish = codes.some((code) => code!.toLowerCase().startsWith('en'));

      return hasPortuguese && hasEnglish;
    } catch {
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  static isAbortError(error: unknown): boolean {
    return (
      error instanceof LanguageToolAbortedError ||
      (error instanceof DOMException && error.name === 'AbortError')
    );
  }

  private async doCheck(
    text: string,
    language: string,
    signal: AbortSignal,
  ): Promise<LTCheckResponse> {
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

    const data = (await response.json()) as LTCheckResponse;

    if (!data.language || !Array.isArray(data.matches)) {
      throw new LanguageToolError('Invalid response from LanguageTool', 0);
    }

    return data;
  }

  private static normalizeBaseUrl(url: string): string {
    const trimmed = url.trim().replace(/\/$/, '');
    if (!trimmed) {
      throw new LanguageToolError('Server URL is empty', 0);
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new LanguageToolError('Invalid server URL', 0);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new LanguageToolError('Server URL must use http or https', 0);
    }

    return trimmed;
  }

  private wrapError(error: unknown): LanguageToolError {
    if (error instanceof LanguageToolError) {
      return error;
    }

    if (error instanceof DOMException && error.name === 'AbortError') {
      return new LanguageToolAbortedError();
    }

    if (error instanceof TypeError) {
      return new LanguageToolError(error.message || 'Network error', 0);
    }

    if (error instanceof Error) {
      return new LanguageToolError(error.message, 0);
    }

    return new LanguageToolError('Unknown error', 0);
  }
}
