/**
 * 配置的装载与热重载接线（SPEC 9.3 第 1、7 条）。
 *
 * 界面在 hydrate 完成前用默认值渲染，不挡首屏——读配置是一次本地小文件读，
 * 为它加一个加载态得不偿失，代价只是极短暂地可能闪一下默认主题。
 */
import { useEffect } from 'react';
import { onConfigReloaded, readConfig } from '../ipc/config';
import { isTauriAvailable } from '../ipc/invoke';
import { flushConfigWrites, useAppStore } from '../store/appStore';
import { logger } from '../lib/logger';

export function useConfig(): void {
  const adoptConfig = useAppStore((state) => state.adoptConfig);

  useEffect(() => {
    if (!isTauriAvailable()) return;

    let cancelled = false;
    readConfig()
      .then((snapshot) => {
        if (cancelled) return;
        adoptConfig(snapshot.config);
        if (snapshot.problems.length > 0) {
          // 只记字段名，不记值：配置里可能有代理地址一类的东西（AGENTS.md 第 9.2 节）
          logger.warn(`config fields fell back to defaults: ${snapshot.problems.join(', ')}`);
        }
      })
      .catch((error: unknown) => logger.warn('failed to read config', error));

    // 用户完全可能就用本应用打开并编辑自己的配置文件，改完不生效会很突兀
    const off = onConfigReloaded((event) => adoptConfig(event.config));

    return () => {
      cancelled = true;
      off();
    };
  }, [adoptConfig]);

  useEffect(() => {
    // 关窗口走的是 beforeunload，不是组件卸载；不接这一下，
    // 最后 200 ms 防抖窗口里的设置改动会永远落不了盘
    const onBeforeUnload = () => void flushConfigWrites();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
}
