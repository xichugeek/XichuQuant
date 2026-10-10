import { Injectable } from "@nestjs/common";

export type UsMarketSession = {
  date: string;
  holidayName: string | null;
  isTradingDay: boolean;
  sessionCloseUtc: Date | null;
  sessionOpenUtc: Date | null;
  timeZone: "America/New_York";
};

export type UsMarketClock = {
  asOfUtc: string;
  daylightSaving: boolean;
  holidayName: string | null;
  marketDate: string;
  phase: "AFTER_HOURS" | "CLOSED" | "OVERNIGHT" | "PRE_MARKET" | "REGULAR";
  regularSession: MarketClockSession;
  statusLabel: string;
  timeZone: "America/New_York";
  overnightSession: MarketClockSession & { eligibleSymbolsOnly: true };
};

type MarketClockSession = {
  endAtUtc: string;
  endBeijing: string;
  endDayOffset: number;
  startAtUtc: string;
  startBeijing: string;
};

const TIME_ZONE = "America/New_York" as const;

@Injectable()
export class UsMarketCalendarService {
  session(dateInput: string | Date): UsMarketSession {
    const date = typeof dateInput === "string" ? dateInput : this.newYorkDate(dateInput);
    const [year, month, day] = date.split("-").map(Number) as [number, number, number];
    const utcDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const holidayName = this.holidayName(date);
    const isTradingDay = utcDay !== 0 && utcDay !== 6 && holidayName === null;
    return {
      date,
      holidayName,
      isTradingDay,
      sessionOpenUtc: isTradingDay ? this.localMarketTimeToUtc(date, 9, 30) : null,
      sessionCloseUtc: isTradingDay ? this.localMarketTimeToUtc(date, 16, 0) : null,
      timeZone: TIME_ZONE,
    };
  }

  latestCompletedSession(now = new Date()): UsMarketSession {
    const parts = this.newYorkParts(now);
    const cursor = this.utcDate(parts.date);
    if (parts.hour < 16 || (parts.hour === 16 && parts.minute < 15)) {
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    for (let offset = 0; offset < 15; offset += 1) {
      const candidate = this.session(cursor.toISOString().slice(0, 10));
      if (candidate.isTradingDay) return candidate;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    throw new Error("无法确定最近一个完整的美股交易日");
  }

  tradingDays(startDate: string, endDate: string): UsMarketSession[] {
    const start = this.utcDate(startDate);
    const end = this.utcDate(endDate);
    const result: UsMarketSession[] = [];
    for (
      const cursor = new Date(start);
      cursor <= end;
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    ) {
      const session = this.session(cursor.toISOString().slice(0, 10));
      if (session.isTradingDay) result.push(session);
    }
    return result;
  }

  marketClock(now = new Date()): UsMarketClock {
    const newYork = this.newYorkParts(now);
    const today = this.session(newYork.date);
    const minutes = newYork.hour * 60 + newYork.minute;
    const tomorrowDate = this.shiftDate(newYork.date, 1);
    const tomorrow = this.session(tomorrowDate);

    let phase: UsMarketClock["phase"] = "CLOSED";
    if (today.isTradingDay && minutes >= 9 * 60 + 30 && minutes < 16 * 60) {
      phase = "REGULAR";
    } else if (
      (today.isTradingDay && minutes < 3 * 60 + 50) ||
      (tomorrow.isTradingDay && minutes >= 20 * 60)
    ) {
      phase = "OVERNIGHT";
    } else if (today.isTradingDay && minutes >= 4 * 60 && minutes < 9 * 60 + 30) {
      phase = "PRE_MARKET";
    } else if (today.isTradingDay && minutes >= 16 * 60 && minutes < 20 * 60) {
      phase = "AFTER_HOURS";
    }

    const target = this.nextRelevantSession(today, minutes);
    const regularStart = target.sessionOpenUtc as Date;
    const regularEnd = target.sessionCloseUtc as Date;
    const overnightStart = this.localMarketTimeToUtc(this.shiftDate(target.date, -1), 20, 0);
    const overnightEnd = this.localMarketTimeToUtc(target.date, 3, 50);
    const labels: Record<UsMarketClock["phase"], string> = {
      AFTER_HOURS: "美股盘后",
      CLOSED: today.holidayName ? `美股休市 · ${today.holidayName}` : "美股已收盘",
      OVERNIGHT: "IBKR 夜盘中",
      PRE_MARKET: "美股盘前",
      REGULAR: "美股交易中",
    };

    return {
      asOfUtc: now.toISOString(),
      daylightSaving: this.newYorkOffsetMinutes(regularStart) === -240,
      holidayName: today.holidayName,
      marketDate: target.date,
      overnightSession: {
        ...this.clockSession(overnightStart, overnightEnd),
        eligibleSymbolsOnly: true,
      },
      phase,
      regularSession: this.clockSession(regularStart, regularEnd),
      statusLabel: labels[phase],
      timeZone: TIME_ZONE,
    };
  }

  private holidayName(date: string): string | null {
    const [year] = date.split("-").map(Number) as [number];
    const holidays = new Map<string, string>();
    const addObserved = (month: number, day: number, name: string) => {
      const actual = new Date(Date.UTC(year, month - 1, day));
      const weekDay = actual.getUTCDay();
      if (weekDay === 6) actual.setUTCDate(actual.getUTCDate() - 1);
      if (weekDay === 0) actual.setUTCDate(actual.getUTCDate() + 1);
      holidays.set(actual.toISOString().slice(0, 10), name);
    };
    addObserved(1, 1, "New Year's Day");
    const nextNewYear = new Date(Date.UTC(year + 1, 0, 1));
    if (nextNewYear.getUTCDay() === 6) {
      holidays.set(`${year}-12-31`, "New Year's Day");
    }
    holidays.set(this.nthWeekday(year, 1, 1, 3), "Martin Luther King Jr. Day");
    holidays.set(this.nthWeekday(year, 2, 1, 3), "Presidents' Day");
    const goodFriday = this.easterSunday(year);
    goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
    holidays.set(goodFriday.toISOString().slice(0, 10), "Good Friday");
    holidays.set(this.lastWeekday(year, 5, 1), "Memorial Day");
    if (year >= 2022) addObserved(6, 19, "Juneteenth");
    addObserved(7, 4, "Independence Day");
    holidays.set(this.nthWeekday(year, 9, 1, 1), "Labor Day");
    holidays.set(this.nthWeekday(year, 11, 4, 4), "Thanksgiving Day");
    addObserved(12, 25, "Christmas Day");
    return holidays.get(date) ?? null;
  }

  private nthWeekday(year: number, month: number, weekDay: number, nth: number) {
    const date = new Date(Date.UTC(year, month - 1, 1));
    const offset = (7 + weekDay - date.getUTCDay()) % 7;
    date.setUTCDate(1 + offset + (nth - 1) * 7);
    return date.toISOString().slice(0, 10);
  }

  private lastWeekday(year: number, month: number, weekDay: number) {
    const date = new Date(Date.UTC(year, month, 0));
    date.setUTCDate(date.getUTCDate() - ((7 + date.getUTCDay() - weekDay) % 7));
    return date.toISOString().slice(0, 10);
  }

  private easterSunday(year: number) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(year, month - 1, day));
  }

  private localMarketTimeToUtc(date: string, hour: number, minute: number) {
    const [year, month, day] = date.split("-").map(Number) as [number, number, number];
    const noonUtc = new Date(Date.UTC(year, month - 1, day, 16));
    const offsetMinutes = this.newYorkOffsetMinutes(noonUtc);
    return new Date(Date.UTC(year, month - 1, day, hour, minute) - offsetMinutes * 60_000);
  }

  private nextRelevantSession(today: UsMarketSession, minutes: number) {
    if (today.isTradingDay && minutes < 16 * 60) return today;
    const cursor = this.utcDate(this.shiftDate(today.date, 1));
    for (let offset = 0; offset < 15; offset += 1) {
      const candidate = this.session(cursor.toISOString().slice(0, 10));
      if (candidate.isTradingDay) return candidate;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    throw new Error("无法确定下一个美股交易日");
  }

  private clockSession(start: Date, end: Date): MarketClockSession {
    const startDate = this.beijingDate(start);
    const endDate = this.beijingDate(end);
    return {
      endAtUtc: end.toISOString(),
      endBeijing: this.beijingTime(end),
      endDayOffset: Math.round(
        (this.utcDate(endDate).getTime() - this.utcDate(startDate).getTime()) / 86_400_000,
      ),
      startAtUtc: start.toISOString(),
      startBeijing: this.beijingTime(start),
    };
  }

  private beijingDate(date: Date) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        day: "2-digit",
        month: "2-digit",
        timeZone: "Asia/Shanghai",
        year: "numeric",
      })
        .formatToParts(date)
        .map((part) => [part.type, part.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  private beijingTime(date: Date) {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      timeZone: "Asia/Shanghai",
    }).format(date);
  }

  private shiftDate(date: string, days: number) {
    const shifted = this.utcDate(date);
    shifted.setUTCDate(shifted.getUTCDate() + days);
    return shifted.toISOString().slice(0, 10);
  }

  private newYorkOffsetMinutes(date: Date) {
    const part =
      new Intl.DateTimeFormat("en-US", {
        timeZone: TIME_ZONE,
        timeZoneName: "longOffset",
      })
        .formatToParts(date)
        .find((item) => item.type === "timeZoneName")?.value ?? "GMT-05:00";
    const match = part.match(/GMT([+-])(\d{2}):(\d{2})/);
    if (!match) return -300;
    const value = Number(match[2]) * 60 + Number(match[3]);
    return match[1] === "+" ? value : -value;
  }

  private newYorkDate(date: Date) {
    return this.newYorkParts(date).date;
  }

  private newYorkParts(date: Date) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        day: "2-digit",
        hour: "2-digit",
        hour12: false,
        minute: "2-digit",
        month: "2-digit",
        timeZone: TIME_ZONE,
        year: "numeric",
      })
        .formatToParts(date)
        .map((part) => [part.type, part.value]),
    );
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      hour: Number(parts.hour),
      minute: Number(parts.minute),
    };
  }

  private utcDate(input: string) {
    const date = new Date(`${input}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) throw new Error("日期格式必须为 YYYY-MM-DD");
    return date;
  }
}
