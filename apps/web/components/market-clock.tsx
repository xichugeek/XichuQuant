"use client";

import { Clock3 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { getJson } from "@/lib/api-client";

type MarketClockPayload = {
  asOfUtc: string;
  daylightSaving: boolean;
  marketDate: string;
  overnightSession: MarketClockSession & { eligibleSymbolsOnly: true };
  phase: "AFTER_HOURS" | "CLOSED" | "OVERNIGHT" | "PRE_MARKET" | "REGULAR";
  regularSession: MarketClockSession;
  statusLabel: string;
};

type MarketClockSession = {
  endBeijing: string;
  endDayOffset: number;
  startBeijing: string;
};

function currentBeijingLabel(value: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("zh-CN", {
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      month: "2-digit",
      second: "2-digit",
      timeZone: "Asia/Shanghai",
    })
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function sessionEndLabel(session: MarketClockSession) {
  return `${session.endDayOffset > 0 ? "次日" : ""}${session.endBeijing}`;
}

export function MarketClock() {
  const [clock, setClock] = useState<MarketClockPayload | null>(null);
  const [currentUtc, setCurrentUtc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const serverOffsetMs = useRef(0);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void getJson<MarketClockPayload>("/operations/market-clock")
        .then((result) => {
          if (!active) return;
          serverOffsetMs.current = Date.parse(result.asOfUtc) - Date.now();
          setClock(result);
          setCurrentUtc(result.asOfUtc);
          setFailed(false);
        })
        .catch(() => {
          if (!active) return;
          setFailed(true);
        });
    };

    refresh();
    const refreshInterval = window.setInterval(refresh, 60_000);
    const ticker = window.setInterval(() => {
      setCurrentUtc(new Date(Date.now() + serverOffsetMs.current).toISOString());
    }, 1_000);
    return () => {
      active = false;
      window.clearInterval(refreshInterval);
      window.clearInterval(ticker);
    };
  }, []);

  if (!clock) {
    return (
      <section
        aria-live="polite"
        className={["market-clock", failed ? "market-clock--error" : ""].join(" ")}
      >
        <Clock3 aria-hidden="true" size={15} />
        <span>{failed ? "交易时钟暂不可用" : "正在读取交易时钟…"}</span>
      </section>
    );
  }

  const season = clock.daylightSaving ? "美东夏令时" : "美东冬令时";
  const title = [
    `当前北京时间 ${currentBeijingLabel(currentUtc ?? clock.asOfUtc)}`,
    `常规交易 ${clock.regularSession.startBeijing}–${sessionEndLabel(clock.regularSession)}`,
    `IBKR 夜盘 ${clock.overnightSession.startBeijing}–${sessionEndLabel(clock.overnightSession)}`,
    `${season}，夜盘仅限支持标的`,
  ].join("；");

  return (
    <section aria-label={title} className="market-clock" data-phase={clock.phase} title={title}>
      <div className="market-clock__now">
        <span>
          <Clock3 aria-hidden="true" size={13} />
          北京时间
        </span>
        <strong>{currentBeijingLabel(currentUtc ?? clock.asOfUtc)}</strong>
      </div>
      <div className="market-clock__sessions">
        <span className="market-clock__session">
          <b>美股开盘</b>
          <span>
            {clock.regularSession.startBeijing}–{sessionEndLabel(clock.regularSession)}
          </span>
        </span>
        <span className="market-clock__session">
          <b>IBKR 夜盘</b>
          <span>
            {clock.overnightSession.startBeijing}–{sessionEndLabel(clock.overnightSession)}
          </span>
          <small>仅限支持标的</small>
        </span>
      </div>
      <span className="market-clock__status">
        <i />
        <span>{clock.statusLabel}</span>
      </span>
    </section>
  );
}
