import { zhCN, type MessageKey } from './zh-CN';
import { enUS } from './en-US';

export type Language = 'zh-CN' | 'en-US';
export type { MessageKey };

const dictionaries: Record<Language, Record<MessageKey, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

export const LANGUAGES: Language[] = ['zh-CN', 'en-US'];

/** SPEC §11：缺失时回落到中文，再回落到 key 本身。 */
export function t(
  language: Language,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const template = dictionaries[language]?.[key] ?? zhCN[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

export function getDictionary(language: Language): Record<MessageKey, string> {
  return dictionaries[language] ?? zhCN;
}
