"use client";

import * as echarts from "echarts";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import { useEffect, useRef } from "react";

import type { BacktestRunView } from "@/lib/quant-types";

const axisStyle = {
  axisLabel: { color: "#8fa2b8", fontSize: 10 },
  axisLine: { lineStyle: { color: "#344454" } },
  splitLine: { lineStyle: { color: "rgba(137, 158, 179, .11)" } },
};

export function BacktestPerformanceCharts({ run }: { run: BacktestRunView }) {
  const equityRef = useRef<HTMLDivElement>(null);
  const drawdownRef = useRef<HTMLDivElement>(null);
  const heatmapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!equityRef.current || !drawdownRef.current || !heatmapRef.current) return;
    const points = run.equityPoints ?? [];
    const equity = echarts.init(equityRef.current, undefined, { renderer: "canvas" });
    const drawdown = echarts.init(drawdownRef.current, undefined, { renderer: "canvas" });
    const heatmap = echarts.init(heatmapRef.current, undefined, { renderer: "canvas" });
    equity.setOption({
      animation: false,
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        valueFormatter: (value: unknown) => `$${Number(value).toLocaleString()}`,
      },
      legend: { data: ["策略权益", "Buy & Hold"], textStyle: { color: "#a9b8c9" }, top: 5 },
      grid: { left: 62, right: 20, top: 42, bottom: 38 },
      xAxis: {
        ...axisStyle,
        type: "category",
        boundaryGap: false,
        data: points.map((point) => point.tradeDate),
      },
      yAxis: { ...axisStyle, type: "value", scale: true },
      dataZoom: [
        { type: "inside" },
        {
          type: "slider",
          height: 14,
          bottom: 5,
          borderColor: "#344454",
          textStyle: { color: "#8fa2b8" },
        },
      ],
      series: [
        {
          name: "策略权益",
          type: "line",
          showSymbol: false,
          data: points.map((point) => point.equity),
          lineStyle: { color: "#65d4aa", width: 2 },
          areaStyle: { color: "rgba(101,212,170,.09)" },
        },
        {
          name: "Buy & Hold",
          type: "line",
          showSymbol: false,
          data: points.map((point) => point.benchmarkEquity),
          lineStyle: { color: "#f1ba63", width: 1.3, type: "dashed" },
        },
      ],
    });
    drawdown.setOption({
      animation: false,
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        valueFormatter: (value: unknown) => `${Number(value).toFixed(2)}%`,
      },
      grid: { left: 58, right: 18, top: 20, bottom: 28 },
      xAxis: {
        ...axisStyle,
        type: "category",
        boundaryGap: false,
        data: points.map((point) => point.tradeDate),
        axisLabel: { show: false },
      },
      yAxis: { ...axisStyle, type: "value", max: 0 },
      series: [
        {
          name: "回撤",
          type: "line",
          showSymbol: false,
          data: points.map((point) => point.drawdown),
          lineStyle: { color: "#ff7a80", width: 1.5 },
          areaStyle: { color: "rgba(255,122,128,.18)" },
        },
      ],
    });
    const years = [...new Set(run.monthlyReturns.map((item) => item.month.slice(0, 4)))];
    const data = run.monthlyReturns.map((item) => [
      Number(item.month.slice(5, 7)) - 1,
      years.indexOf(item.month.slice(0, 4)),
      item.return,
    ]);
    heatmap.setOption({
      animation: false,
      tooltip: {
        formatter: (params: { value: [number, number, number] }) =>
          `${years[params.value[1]]}-${String(params.value[0] + 1).padStart(2, "0")}：${params.value[2].toFixed(2)}%`,
      },
      grid: { left: 48, right: 14, top: 18, bottom: 30 },
      xAxis: {
        type: "category",
        data: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"],
        ...axisStyle,
      },
      yAxis: { type: "category", data: years, ...axisStyle },
      visualMap: {
        min: -10,
        max: 10,
        show: false,
        inRange: { color: ["#8e353e", "#26323f", "#23785f"] },
      },
      series: [
        {
          type: "heatmap",
          data,
          label: {
            show: true,
            color: "#dce5ef",
            fontSize: 9,
            formatter: (params: { value: [number, number, number] }) =>
              `${params.value[2].toFixed(1)}%`,
          },
        },
      ],
    });
    const resize = () => {
      equity.resize();
      drawdown.resize();
      heatmap.resize();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(equityRef.current);
    return () => {
      observer.disconnect();
      equity.dispose();
      drawdown.dispose();
      heatmap.dispose();
    };
  }, [run]);

  return (
    <div className="backtest-echarts-grid">
      <div>
        <h3>权益曲线与基准</h3>
        <div className="equity-chart" ref={equityRef} />
      </div>
      <div>
        <h3>回撤曲线</h3>
        <div className="drawdown-chart" ref={drawdownRef} />
      </div>
      <div>
        <h3>月度收益热力图</h3>
        <div className="monthly-heatmap" ref={heatmapRef} />
      </div>
    </div>
  );
}

export function BacktestPriceChart({ run }: { run: BacktestRunView }) {
  const chartRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!chartRef.current) return;
    const chart = createChart(chartRef.current, {
      autoSize: true,
      height: 330,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#91a4b9",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(137,158,179,.08)" },
        horzLines: { color: "rgba(137,158,179,.08)" },
      },
      rightPriceScale: { borderColor: "#344454" },
      timeScale: { borderColor: "#344454", timeVisible: false },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#55c99e",
      downColor: "#ef7179",
      borderVisible: false,
      wickUpColor: "#55c99e",
      wickDownColor: "#ef7179",
    });
    candles.setData(
      (run.marketData ?? []).map((bar) => ({
        time: bar.tradeDate as Time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      })),
    );
    const markers: SeriesMarker<Time>[] = (run.trades ?? [])
      .filter((trade) => trade.symbol === run.symbol)
      .map((trade) => ({
        time: trade.executionTime.slice(0, 10) as Time,
        position: trade.side === "BUY" ? "belowBar" : "aboveBar",
        color: trade.side === "BUY" ? "#65d4aa" : "#ff7a80",
        shape: trade.side === "BUY" ? "arrowUp" : "arrowDown",
        text: `${trade.side} ${trade.quantity}`,
      }));
    createSeriesMarkers(candles, markers);
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [run]);
  return <div className="price-chart" ref={chartRef} />;
}
