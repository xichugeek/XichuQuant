import type { RiskLevel } from "@xichu-risk/shared";

const labels: Record<RiskLevel, string> = {
  DANGER: "高风险",
  LOW: "低风险",
  MEDIUM: "中低风险",
  VIOLATION: "严重违纪",
  WARNING: "警告",
};

export function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <span className={["risk-badge", "risk-badge--" + level.toLowerCase()].join(" ")}>
      <i />
      {labels[level]}
    </span>
  );
}
