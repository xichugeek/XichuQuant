"use client";

import * as echarts from "echarts";
import { useEffect, useRef } from "react";

const axis = {
  axisLabel: { color: "#9aabbd", fontSize: 10 },
  axisLine: { lineStyle: { color: "#405061" } },
  splitLine: { lineStyle: { color: "rgba(145,166,186,.1)" } },
};

export type ValidationChartData = {
  parameterResults: Array<{
    parameterKey: string;
    totalReturn: number;
    maxDrawdown: number;
    stabilityScore: number | null;
  }>;
  stressResults: Array<{
    scenarioCode: string;
    returnDegradation: number;
    failed: boolean;
  }>;
  windows: Array<{
    sequence: number;
    totalReturn: number | null;
    maxDrawdown: number | null;
  }>;
};

export function ValidationCharts({ data }: { data: ValidationChartData }) {
  const sweepRef = useRef<HTMLDivElement>(null);
  const stressRef = useRef<HTMLDivElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sweepRef.current || !stressRef.current || !windowRef.current) return;
    const sweep = echarts.init(sweepRef.current);
    const stress = echarts.init(stressRef.current);
    const windows = echarts.init(windowRef.current);
    sweep.setOption({
      animation: false,
      tooltip: {
        formatter: (item: { data: [number, number, number, string] }) =>
          `${item.data[3]}<br/>收益 ${item.data[0].toFixed(2)}%<br/>回撤 ${item.data[1].toFixed(2)}%`,
      },
      grid: { bottom: 38, left: 54, right: 22, top: 20 },
      xAxis: { ...axis, name: "总收益 %", nameTextStyle: { color: "#8ea0b3" }, type: "value" },
      yAxis: { ...axis, name: "最大回撤 %", nameTextStyle: { color: "#8ea0b3" }, type: "value" },
      series: [
        {
          type: "scatter",
          symbolSize: (item: [number, number, number]) => 7 + Math.max(0, item[2]) / 8,
          itemStyle: { color: "#5bd1bf", opacity: 0.72 },
          data: data.parameterResults.map((item) => [
            item.totalReturn,
            item.maxDrawdown,
            item.stabilityScore ?? 0,
            item.parameterKey,
          ]),
        },
      ],
    });
    stress.setOption({
      animation: false,
      tooltip: { trigger: "axis", valueFormatter: (value: unknown) => `${Number(value).toFixed(2)}%` },
      grid: { bottom: 72, left: 54, right: 18, top: 20 },
      xAxis: {
        ...axis,
        axisLabel: { color: "#9aabbd", fontSize: 9, interval: 0, rotate: 35 },
        data: data.stressResults.map((item) => item.scenarioCode),
        type: "category",
      },
      yAxis: { ...axis, name: "收益退化 %", nameTextStyle: { color: "#8ea0b3" }, type: "value" },
      series: [
        {
          type: "bar",
          data: data.stressResults.map((item) => ({
            value: item.returnDegradation,
            itemStyle: { color: item.failed ? "#ff7880" : "#f0b861" },
          })),
        },
      ],
    });
    windows.setOption({
      animation: false,
      legend: { data: ["样本外收益", "最大回撤"], textStyle: { color: "#aebccc" }, top: 0 },
      tooltip: { trigger: "axis", valueFormatter: (value: unknown) => `${Number(value).toFixed(2)}%` },
      grid: { bottom: 34, left: 54, right: 18, top: 42 },
      xAxis: { ...axis, data: data.windows.map((item) => `W${item.sequence}`), type: "category" },
      yAxis: { ...axis, type: "value" },
      series: [
        { name: "样本外收益", type: "bar", data: data.windows.map((item) => item.totalReturn ?? 0), itemStyle: { color: "#55c9a0" } },
        { name: "最大回撤", type: "line", data: data.windows.map((item) => item.maxDrawdown ?? 0), lineStyle: { color: "#ff7880" } },
      ],
    });
    const resize = () => {
      sweep.resize();
      stress.resize();
      windows.resize();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(sweepRef.current);
    return () => {
      observer.disconnect();
      sweep.dispose();
      stress.dispose();
      windows.dispose();
    };
  }, [data]);

  return (
    <div className="validation-chart-grid">
      <article><h3>参数稳定区域</h3><div ref={sweepRef} /></article>
      <article><h3>Walk-forward 分窗表现</h3><div ref={windowRef} /></article>
      <article className="validation-chart-grid__wide"><h3>压力测试收益退化</h3><div ref={stressRef} /></article>
    </div>
  );
}
