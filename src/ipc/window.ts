/**
 * 窗口控制的封装。组件不直接碰 `@tauri-apps/api`（AGENTS.md §5.2），
 * 也方便在纯前端 `pnpm dev` 下退化成空操作而不是抛异常。
 */
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriAvailable } from './invoke';

/**
 * 订阅操作系统交给当前窗口的文件拖放。只转发真正的 `drop`，悬停和离开事件
 * 留给 Tauri 处理，避免一次拖动在前端触发多次打开。
 */
export async function listenDroppedPaths(
  handler: (paths: string[]) => void,
): Promise<() => void> {
  if (!isTauriAvailable()) return () => {};
  return getCurrentWindow().onDragDropEvent((event) => {
    if (event.payload.type === 'drop' && event.payload.paths.length > 0) {
      handler(event.payload.paths);
    }
  });
}

export interface WindowControls {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  setTitle: (title: string) => Promise<void>;
}

const noop: WindowControls = {
  minimize: async () => {},
  toggleMaximize: async () => {},
  close: async () => {},
  isMaximized: async () => false,
  setTitle: async () => {},
};

/**
 * 关闭请求的拦截。返回解绑函数。
 *
 * 处理器要 await 完才放行关闭，写「干净退出」标记就挂在这里——
 * 挂 `beforeunload` 是不行的，那里发不出能等到结果的异步调用。
 */
export async function onCloseRequested(
  handler: () => Promise<void>,
): Promise<() => void> {
  if (!isTauriAvailable()) return () => {};
  return getCurrentWindow().onCloseRequested(async () => {
    await handler();
  });
}

export function getWindowControls(): WindowControls {
  if (!isTauriAvailable()) return noop;
  const window = getCurrentWindow();
  return {
    minimize: () => window.minimize(),
    toggleMaximize: () => window.toggleMaximize(),
    close: () => window.close(),
    isMaximized: () => window.isMaximized(),
    setTitle: (title) => window.setTitle(title),
  };
}
