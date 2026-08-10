/**
 * 更新代理串的校验（SPEC §12.3.2）。
 *
 * 纯函数：设置界面即时校验、检查更新前的守卫都用它，两处判定必须一致——
 * 不一致的表现是「设置里显示合法，点检查却说地址不对」。
 *
 * **绝不把代理串写进日志**：它可能带账号密码（AGENTS.md §9.2）。
 */

const SCHEMES = ["http://", "https://", "socks5://", "socks5h://"] as const;

/**
 * 空串表示「不配代理」，是合法的。
 *
 * 只校验到「插件能认」的程度：协议在白名单内、有主机名。
 * 更严的校验（比如端口范围）留给实际连接去报错，那里的错误信息更准确。
 */
export function isValidProxy(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  if (!SCHEMES.some((scheme) => trimmed.toLowerCase().startsWith(scheme))) {
    return false;
  }
  try {
    // URL 能解析出非空 hostname 才算数：`http://` 后面什么都没有的情况要挡掉
    return new URL(trimmed).hostname.length > 0;
  } catch {
    return false;
  }
}

/** 日志里只允许出现这个，绝不能是代理串本身。 */
export function describeProxy(value: string): "configured" | "none" {
  return value.trim().length > 0 ? "configured" : "none";
}
