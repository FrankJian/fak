/**
 * 编辑器外观（SPEC §9.2）。
 *
 * 主编辑区与对比视图的两栏用的是同一套外观值：字号或 Tab 宽度一改，
 * 三处必须一起变，否则对比视图的行高与主编辑区对不上。
 */
import { useMemo } from "react";
import { useAppStore } from "../store/appStore";
import type { Appearance } from "./extensions";

export function useEditorAppearance(): Appearance {
  const fontFamily = useAppStore((state) => state.fontFamily);
  const fontSize = useAppStore((state) => state.fontSize);
  const lineHeight = useAppStore((state) => state.lineHeight);
  const letterSpacing = useAppStore((state) => state.letterSpacing);
  const fontLigatures = useAppStore((state) => state.fontLigatures);
  const tabWidth = useAppStore((state) => state.tabWidth);
  const tabIndentMode = useAppStore((state) => state.tabIndentMode);
  const showLineNumbers = useAppStore((state) => state.showLineNumbers);
  const highlightCurrentLine = useAppStore(
    (state) => state.highlightCurrentLine,
  );
  const wordWrap = useAppStore((state) => state.wordWrap);
  const cursorStyle = useAppStore((state) => state.cursorStyle);
  const cursorBlink = useAppStore((state) => state.cursorBlink);
  const rulers = useAppStore((state) => state.rulers);
  const pasteImageMode = useAppStore((state) => state.pasteImageMode);

  return useMemo<Appearance>(
    () => ({
      fontFamily,
      fontSize,
      lineHeight,
      letterSpacing,
      fontLigatures,
      tabWidth,
      tabIndentMode,
      showLineNumbers,
      highlightCurrentLine,
      wordWrap,
      cursorStyle,
      cursorBlink,
      rulers,
      pasteImageMode,
    }),
    [
      fontFamily,
      fontSize,
      lineHeight,
      letterSpacing,
      fontLigatures,
      tabWidth,
      tabIndentMode,
      showLineNumbers,
      highlightCurrentLine,
      wordWrap,
      cursorStyle,
      cursorBlink,
      rulers,
      pasteImageMode,
    ],
  );
}
