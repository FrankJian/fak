import { useCallback } from 'react';
import { t, type Language, type MessageKey } from './index';
import { useAppStore } from '../store/appStore';

export function useTranslation() {
  const language: Language = useAppStore((s) => s.language);
  const translate = useCallback(
    (key: MessageKey, params?: Record<string, string | number>) => t(language, key, params),
    [language],
  );
  // 语言标签同时就是 `toLocaleString` 认得的 locale，日期时间格式跟着界面语言走
  return { t: translate, language, locale: language };
}
