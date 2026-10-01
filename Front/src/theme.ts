import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const storageKey = "unsolvable-oj-theme-v1";
const themeColor: Record<Theme, string> = {
  light: "#fbfcfe",
  dark: "#171d27",
};

function stored(): Theme | null {
  try {
    const value = localStorage.getItem(storageKey);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function system(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", themeColor[theme]);
}

/**
 * 저장된 선택 → 없으면 시스템 설정을 따른다.
 * 직접 바꾸면 그 선택을 저장하고, 이후에는 시스템 변화를 따라가지 않는다.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => stored() ?? system());

  useEffect(() => apply(theme), [theme]);

  useEffect(() => {
    if (stored()) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (!stored()) setTheme(media.matches ? "dark" : "light");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const toggle = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      /* 저장소를 쓸 수 없어도 이번 방문에는 적용한다 */
    }
    setTheme(next);
  }, [theme]);

  return { theme, toggle };
}
