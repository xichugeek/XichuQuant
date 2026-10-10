"use client";

import * as echarts from "echarts";
import { useEffect, useRef } from "react";

export function PortfolioEquityChart({
  points,
}: {
  points: Array<{
    benchmarkEquity: number;
    drawdown: number;
    snapshotDate: string;
    totalEquity: number;
  }>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption({
      animation: false,
      tooltip: { trigger: "axis" },
      legend: {
        data: ["组合权益", "BuyAndHold 基准", "组合回撤"],
        textStyle: { color: "#aebccc" },
      },
      grid: { bottom: 36, left: 62, right: 62, top: 45 },
      xAxis: {
        type: "category",
        data: points.map((point) => point.snapshotDate.slice(0, 10)),
        axisLabel: { color: "#98aabd" },
        axisLine: { lineStyle: { color: "#405061" } },
      },
      yAxis: [
        {
          type: "value",
          scale: true,
          axisLabel: { color: "#98aabd" },
          splitLine: { lineStyle: { color: "rgba(145,166,186,.1)" } },
        },
        {
          type: "value",
          max: 0,
          axisLabel: { color: "#98aabd", formatter: "{value}%" },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: "组合权益",
          type: "line",
          showSymbol: false,
          data: points.map((point) => point.totalEquity),
          lineStyle: { color: "#48cabb", width: 2 },
          areaStyle: { color: "rgba(72,202,187,.08)" },
        },
        {
          name: "BuyAndHold 基准",
          type: "line",
          showSymbol: false,
          data: points.map((point) => point.benchmarkEquity || null),
          lineStyle: { color: "#7aa5ff", type: "dashed", width: 1.5 },
        },
        {
          name: "组合回撤",
          type: "line",
          yAxisIndex: 1,
          showSymbol: false,
          data: points.map((point) => point.drawdown),
          lineStyle: { color: "#ff7078", width: 1.3 },
        },
      ],
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [points]);
  return <div className="v16-equity-chart" ref={ref} />;
}
