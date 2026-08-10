import { describe, expect, it } from "vitest";
import { zhCN as messages } from "../i18n/zh-CN";
import { DEFAULT_CONFIG } from "../ipc/config";
import {
  SETTINGS,
  SETTINGS_GROUPS,
  clampNumber,
  groupSettingsByGroup,
  parseRulers,
  searchSettings,
  type NumberSetting,
} from "./settingsSchema";

const translate = (key: keyof typeof messages) => messages[key];

describe("设置项清单", () => {
  it("每一项的文案 key 在字典里都存在", () => {
    for (const setting of SETTINGS) {
      expect(messages[setting.labelKey], setting.id).toBeTruthy();
      expect(messages[setting.descriptionKey], setting.id).toBeTruthy();
    }
  });

  it("id 不重复", () => {
    const ids = SETTINGS.map((setting) => setting.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每一项都归属于一个已声明的分组", () => {
    const groups = new Set(SETTINGS_GROUPS.map((entry) => entry.id));
    for (const setting of SETTINGS) {
      expect(groups.has(setting.group), setting.id).toBe(true);
    }
  });

  it("声明的默认值与 DEFAULT_CONFIG 一致", () => {
    // 两处不一致的表现是「重置此项」把设置改成了另一个值，而不是默认值
    for (const setting of SETTINGS) {
      expect(setting.read(DEFAULT_CONFIG), setting.id).toEqual(
        setting.defaultValue,
      );
    }
  });

  it("写回的补丁只含自己那一个字段", () => {
    for (const setting of SETTINGS) {
      const patch =
        setting.kind === "switch"
          ? setting.write(setting.defaultValue, DEFAULT_CONFIG)
          : setting.kind === "number"
            ? setting.write(setting.defaultValue)
            : setting.write(setting.defaultValue);
      expect(Object.keys(patch), setting.id).toHaveLength(1);
    }
  });

  it("嵌套的差异开关只改自己那一项，不碰同组的其他开关", () => {
    const setting = SETTINGS.find((item) => item.id === "diff.ignoreCase");
    expect(setting?.kind).toBe("switch");
    if (setting?.kind !== "switch") return;
    const config = {
      ...DEFAULT_CONFIG,
      diffOptions: { ...DEFAULT_CONFIG.diffOptions, ignoreBlankLines: true },
    };
    const patch = setting.write(true, config);
    expect(patch.diffOptions).toEqual({
      ...config.diffOptions,
      ignoreCase: true,
    });
  });

  it("数值项的范围两端都合法且默认值落在范围内", () => {
    for (const setting of SETTINGS.filter(
      (item): item is NumberSetting => item.kind === "number",
    )) {
      expect(setting.min, setting.id).toBeLessThan(setting.max);
      expect(setting.defaultValue, setting.id).toBeGreaterThanOrEqual(
        setting.min,
      );
      expect(setting.defaultValue, setting.id).toBeLessThanOrEqual(setting.max);
    }
  });

  it("下拉项的默认值必须是选项之一", () => {
    for (const setting of SETTINGS) {
      if (setting.kind !== "select") continue;
      const values = setting.options.map((option) => option.value);
      expect(values, setting.id).toContain(setting.defaultValue);
    }
  });
});

describe("设置搜索", () => {
  it("空查询返回全部并保持声明顺序", () => {
    const found = searchSettings(SETTINGS, "   ", translate);
    expect(found).toEqual([...SETTINGS]);
  });

  it("按字段名能搜到", () => {
    const found = searchSettings(SETTINGS, "backupIdle", translate);
    expect(found.map((item) => item.id)).toEqual(["backupIdleMs"]);
  });

  it("按说明里的词也能搜到", () => {
    const found = searchSettings(SETTINGS, "崩溃", translate);
    expect(found.map((item) => item.id)).toContain("backupEnabled");
  });

  it("搜不到时返回空数组而不是全部", () => {
    expect(searchSettings(SETTINGS, "zzzz-no-such-thing", translate)).toEqual(
      [],
    );
  });

  it("按定义的分组顺序组织搜索结果", () => {
    const found = searchSettings(SETTINGS, "备份", translate);
    const groups = groupSettingsByGroup(found);

    expect(groups).toHaveLength(1);
    expect(groups[0].group.id).toBe("dataSafety");
    expect(groups[0].settings.map((setting) => setting.id)).toContain(
      "backupEnabled",
    );
  });
});

describe("数值钳制", () => {
  const setting = SETTINGS.find(
    (item): item is NumberSetting =>
      item.kind === "number" && item.id === "fontSize",
  );

  it("越界值被拉回边界", () => {
    expect(setting).toBeDefined();
    if (!setting) return;
    expect(clampNumber(setting, 999)).toBe(setting.max);
    expect(clampNumber(setting, -3)).toBe(setting.min);
  });

  it("非数字回落到默认值", () => {
    expect(setting).toBeDefined();
    if (!setting) return;
    expect(clampNumber(setting, Number.NaN)).toBe(setting.defaultValue);
  });

  it("按步长的小数位收尾，不留浮点尾巴", () => {
    const lineHeight = SETTINGS.find(
      (item): item is NumberSetting =>
        item.kind === "number" && item.id === "lineHeight",
    );
    expect(lineHeight).toBeDefined();
    if (!lineHeight) return;
    expect(clampNumber(lineHeight, 1.4000000000000001)).toBe(1.4);
  });
});

describe("标尺列解析", () => {
  it("认逗号、空格与中文逗号", () => {
    expect(parseRulers("80, 120  100，60")).toEqual([60, 80, 100, 120]);
  });

  it("去重并升序", () => {
    expect(parseRulers("120,80,80")).toEqual([80, 120]);
  });

  it("丢掉非数字与越界项，不报错", () => {
    // 输入过程中必然经过半截状态，为它报错会让人没法打字
    expect(parseRulers("80, abc, 0, 9999, ")).toEqual([80]);
  });

  it("空串是空列表", () => {
    expect(parseRulers("")).toEqual([]);
    expect(parseRulers("   ")).toEqual([]);
  });
});
