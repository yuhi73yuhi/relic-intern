/** 可視化用カラートークン（ダーク面 #0b0f14 上で色覚多様性チェック済み） */
export const COLORS = {
  surface: "#0b0f14",
  panel: "#11161d",
  grid: "#1f2730",
  axis: "#3a4652",
  textMuted: "#7d8a97",
  text: "#d7dee6",
  pro: "#0891b2", // Cyan — お手本
  proBright: "#22d3ee",
  user: "#a855f7", // Violet — 自分
  userBright: "#c084fc",
  accent: "#10b981", // Emerald — UI アクセント
  good: "#10b981",
  warning: "#f59e0b",
  critical: "#f43f5e",
} as const;

export type Severity = "good" | "warning" | "critical";

export function severityOf(devMs: number): Severity {
  const a = Math.abs(devMs);
  if (a <= 10) return "good";
  if (a <= 25) return "warning";
  return "critical";
}

export const SEVERITY_COLOR: Record<Severity, string> = {
  good: COLORS.good,
  warning: COLORS.warning,
  critical: COLORS.critical,
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  good: "±10ms以内",
  warning: "±25ms以内",
  critical: "25ms超",
};

export const fmtMs = (ms: number) => `${ms >= 0 ? "+" : ""}${Math.round(ms)}ms`;
