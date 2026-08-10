/**
 * 外壳集成的 IPC 封装（AGENTS.md §5.2）。
 *
 * 注册会改写系统关联，必须由用户显式触发，绝不在启动时自动执行。
 */
import { invoke } from "./invoke";

export interface ShellIntegrationStatus {
  registered: boolean;
  /** 非 Windows 平台走 bundle 声明，不需要运行时注册 */
  supported: boolean;
}

export function shellIntegrationStatus(): Promise<ShellIntegrationStatus> {
  return invoke<ShellIntegrationStatus>("shell_integration_status");
}

/** `menuLabel` 是右键菜单上显示的文案，跟随界面语言。 */
export function registerShellIntegration(menuLabel: string): Promise<void> {
  return invoke<void>("register_shell_integration", { menuLabel });
}

export function unregisterShellIntegration(): Promise<void> {
  return invoke<void>("unregister_shell_integration");
}

/** 本次启动实际生效的单实例状态，不是配置里的值。 */
export function singleInstanceActive(): Promise<boolean> {
  return invoke<boolean>("single_instance_active");
}
