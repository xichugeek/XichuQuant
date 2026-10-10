"use client";

import * as echarts from "echarts";
import { useEffect, useRef } from "react";

export function PaperEquityChart({
  points,
}: {
  points: Array<{ snapshotTime: string; totalEquity: number; drawdown: number }>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption({
      animation: false,
      tooltip: { trigger: "axis" },
      legend: { data: ["模拟权益", "回撤"], textStyle: { color: "#aebccc" } },
      grid: { bottom: 36, left: 62, right: 62, top: 42 },
      xAxis: {
        type: "category",
        data: points.map((point) => point.snapshotTime.slice(0, 10)),
        axisLabel: { color: "#98aabd" },
        axisLine: { lineStyle: { color: "#405061" } },
      },
      yAxis: [
        { type: "value", scale: true, axisLabel: { color: "#98aabd" }, splitLine: { lineStyle: { color: "rgba(145,166,186,.1)" } } },
        { type: "value", max: 0, axisLabel: { color: "#98aabd", formatter: "{value}%" }, splitLine: { show: false } },
      ],
      series: [
        { name: "模拟权益", type: "line", showSymbol: false, data: points.map((point) => point.totalEquity), lineStyle: { color: "#58cfa5", width: 2 }, areaStyle: { color: "rgba(88,207,165,.08)" } },
        { name: "回撤", type: "line", yAxisIndex: 1, showSymbol: false, data: points.map((point) => point.drawdown), lineStyle: { color: "#ff7880", width: 1.4 } },
      ],
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [points]);
  return <div className="paper-equity-chart" ref={ref} />;
}
