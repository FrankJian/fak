import { describe, expect, it } from "vitest";
import { describeProxy, isValidProxy } from "./updateProxy";

describe("更新代理校验", () => {
  it("空串表示不配代理，是合法的", () => {
    expect(isValidProxy("")).toBe(true);
    expect(isValidProxy("   ")).toBe(true);
  });

  it("接受四种协议", () => {
    expect(isValidProxy("http://127.0.0.1:8080")).toBe(true);
    expect(isValidProxy("https://proxy.example.com:443")).toBe(true);
    expect(isValidProxy("socks5://127.0.0.1:1080")).toBe(true);
    expect(isValidProxy("socks5h://127.0.0.1:1080")).toBe(true);
  });

  it("接受带账号密码的形式", () => {
    expect(isValidProxy("http://user:pass@127.0.0.1:8080")).toBe(true);
  });

  it("拒绝协议不在白名单里的地址", () => {
    expect(isValidProxy("ftp://127.0.0.1")).toBe(false);
    expect(isValidProxy("127.0.0.1:8080")).toBe(false);
    expect(isValidProxy("javascript:alert(1)")).toBe(false);
  });

  it("拒绝没有主机名的地址", () => {
    expect(isValidProxy("http://")).toBe(false);
  });

  it("只报告「配了没配」，绝不回显代理串本身", () => {
    expect(describeProxy("http://user:secret@host:8080")).toBe("configured");
    expect(describeProxy("")).toBe("none");
  });
});
