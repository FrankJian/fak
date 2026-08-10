import { invoke } from "./invoke";

export function commandPinyinInitials(titles: string[]): Promise<string[]> {
  return invoke<string[]>("command_pinyin_initials", { args: { titles } });
}
