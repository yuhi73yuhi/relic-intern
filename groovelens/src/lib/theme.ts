/** 可視化用カラートークン（ダーク面 #0b0f14 上で色覚多様性チェック済み） */
import type { Severity } from "./groove";

export const COLORS = {
  surface: "#0b0f14",
  panel: "#11161d",
  grid: "#1f2730",
  axis: "#3a4652",
  textMuted: "#7d8a97",
  text: "#d7dee6",
  pro: "#0891b2", // Cyan — 先生（お手本）
  proBright: "#22d3ee",
  user: "#a855f7", // Violet — あなた
  userBright: "#c084fc",
  accent: "#10b981", // Emerald — UI アクセント
  good: "#10b981",
  warning: "#f59e0b",
  critical: "#f43f5e",
} as const;

export const SEVERITY_COLOR: Record<Severity, string> = {
  good: COLORS.good,
  warning: COLORS.warning,
  critical: COLORS.critical,
};

export const SEVERITY_TEXT: Record<Severity, string> = {
  good: "OK",
  warning: "惜しい",
  critical: "要改善",
};

export const SEVERITY_ICON: Record<Severity, string> = {
  good: "✓",
  warning: "!",
  critical: "!!",
};

export const fmtMs = (ms: number) => `${ms >= 0 ? "+" : ""}${Math.round(ms)}ms`;
