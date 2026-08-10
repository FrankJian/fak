import { create } from 'zustand';
import { DEFAULT_CONFIG, writeConfig, type Config } from '../ipc/config';
import { PatchQueue } from '../lib/patchQueue';
import { logger } from '../lib/logger';

export type { Theme, Density } from '../ipc/config';

/**
 * SPEC P1：store 只放 UI 状态，不放文档正文。
 *
 * 配置项**平铺**在 store 上而不是塞进一个 `config` 子对象里，是为了让
 * `useAppStore((s) => s.theme)` 这类选择器保持逐字段订阅——套一层对象的话，
 * 改字号会让所有订阅主题的组件跟着重渲染。
 */
interface AppState extends Config {
  /** 配置是否已从磁盘读回。未 hydrate 时用的是默认值 */
  hydrated: boolean;
  /**
   * 本地立刻生效 + 落盘（防抖 200 ms）。设置面板一律走它。
   * 只提交改动的键，不提交整份配置（见 `ipc/config.ts` 的说明）
   */
  patchConfig: (patch: Partial<Config>) => void;
  /** 磁盘那边成为真相源时调用：启动 hydrate 与外部修改热重载 */
  adoptConfig: (config: Config) => void;
  setLanguage: (language: Config['language']) => void;
  setTheme: (theme: Config['theme']) => void;
  setDensity: (density: Config['density']) => void;
}

const queue = new PatchQueue<Config>(async (patch) => {
  try {
    await writeConfig(patch);
  } catch (error) {
    // 写不进去不该让界面回滚：用户看到的仍是自己刚选的值，
    // 只是重启后会丢。回滚反而更费解（点了没反应）
    logger.warn('config write failed', error);
  }
});

/** 退出前把最后 200 ms 内的改动写出去。 */
export function flushConfigWrites(): Promise<void> {
  return queue.flush();
}

export const useAppStore = create<AppState>((set) => ({
  ...DEFAULT_CONFIG,
  hydrated: false,

  patchConfig: (patch) => {
    set(patch);
    queue.push(patch);
  },
  adoptConfig: (config) => set({ ...config, hydrated: true }),

  setLanguage: (language) => {
    set({ language });
    queue.push({ language });
  },
  setTheme: (theme) => {
    set({ theme });
    queue.push({ theme });
  },
  setDensity: (density) => {
    set({ density });
    queue.push({ density });
  },
}));
