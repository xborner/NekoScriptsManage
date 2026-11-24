export type ThemeId = "sakura" | "mint" | "sky" | "cream";

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  tagline: string;
  dot: string;
  bg: string;
  border: string;
}

export const THEMES: ThemeMeta[] = [
  {
    id: "sakura",
    name: "樱花奶冻",
    tagline: "温柔粉嫩 · 奶油浅底",
    dot: "#f47c9b",
    bg: "#fff1f5",
    border: "#f5dce3",
  },
  {
    id: "mint",
    name: "薄荷苏打",
    tagline: "清新治愈 · 冰爽轻盈",
    dot: "#45b996",
    bg: "#eafaf3",
    border: "#cdeee0",
  },
  {
    id: "sky",
    name: "天空云朵",
    tagline: "澄澈软蓝 · 猫耳同款",
    dot: "#5ba4ee",
    bg: "#edf5ff",
    border: "#d2e4f8",
  },
  {
    id: "cream",
    name: "奶油布丁",
    tagline: "暖杏甜点 · 柔光护眼",
    dot: "#e5a93c",
    bg: "#fff8e6",
    border: "#f0e1be",
  },
];

export type NavTab = "apps" | "scripts" | "logs" | "settings";
