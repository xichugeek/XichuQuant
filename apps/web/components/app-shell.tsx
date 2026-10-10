"use client";

import type { RiskSummary } from "@xichu-risk/shared";

import {
  Activity,
  AlertTriangle,
  Bell,
  BellRing,
  Boxes,
  BookOpenText,
  BriefcaseBusiness,
  Building2,
  ChartSpline,
  ChartCandlestick,
  ChevronRight,
  ClipboardCheck,
  DatabaseBackup,
  DatabaseZap,
  FileCheck2,
  FileClock,
  FileUp,
  FlaskConical,
  Home,
  Landmark,
  LockKeyhole,
  Menu,
  Search,
  Server,
  Settings,
  RadioTower,
  RefreshCcw,
  Scale,
  SlidersHorizontal,
  ListTodo,
  Microscope,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  WalletCards,
  Telescope,
  Timer,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { fetchWithFallback, type DataSource } from "@/lib/api-client";
import { emptyRiskSummary } from "@/lib/operational-fallbacks";
import { useShellStore } from "@/lib/stores/shell-store";
import { MarketClock } from "@/components/market-clock";

const navigation = [
  { href: "/", icon: Home, label: "首页总览" },
  { href: "/performance", icon: ChartSpline, label: "账户表现" },
  { href: "/imports", icon: FileUp, label: "数据导入" },
  { href: "/market-data", icon: ChartCandlestick, label: "行情中心" },
  { href: "/market-research", icon: Telescope, label: "研究因子" },
  { href: "/data-quality", icon: Microscope, label: "数据质量" },
  { href: "/strategies", icon: FlaskConical, label: "策略管理" },
  { href: "/strategy-evidence", icon: DatabaseZap, label: "策略证据" },
  { href: "/portfolios", icon: Boxes, label: "策略组合" },
  { href: "/portfolio-performance", icon: Scale, label: "组合表现" },
  { href: "/capital-allocation", icon: SlidersHorizontal, label: "资金分配" },
  { href: "/rebalance-center", icon: RefreshCcw, label: "再平衡中心" },
  { href: "/backtests", icon: ChartSpline, label: "回测中心" },
  { href: "/validations", icon: ScanSearch, label: "策略验证" },
  { href: "/signals", icon: RadioTower, label: "信号中心" },
  { href: "/paper-trading", icon: WalletCards, label: "模拟交易" },
  { href: "/forward-observation", icon: Telescope, label: "前向观察" },
  { href: "/broker-connections", icon: RadioTower, label: "券商连接" },
  { href: "/broker-accounts", icon: Landmark, label: "IBKR 账户" },
  { href: "/broker-sync", icon: RefreshCcw, label: "账户同步" },
  { href: "/reconciliation", icon: Scale, label: "账户对账" },
  { href: "/shadow-trading", icon: Telescope, label: "影子交易" },
  { href: "/live-readiness", icon: ShieldCheck, label: "实盘准备度" },
  { href: "/service-status", icon: Server, label: "服务状态" },
  { href: "/broker-paper-execution", icon: WalletCards, label: "券商模拟执行" },
  { href: "/order-approvals", icon: ClipboardCheck, label: "订单审批" },
  { href: "/paper-broker-orders", icon: FileClock, label: "Paper 订单" },
  { href: "/paper-broker-executions", icon: Activity, label: "Paper 成交" },
  { href: "/paper-broker-reconciliation", icon: Scale, label: "Paper 对账" },
  { href: "/execution-monitor", icon: Server, label: "执行监控" },
  { href: "/execution-incidents", icon: AlertTriangle, label: "执行事故" },
  { href: "/security-center", icon: LockKeyhole, label: "安全中心" },
  { href: "/backup-recovery", icon: DatabaseBackup, label: "备份恢复" },
  { href: "/external-certification", icon: ShieldCheck, label: "外部认证" },
  { href: "/ibkr-paper-certification", icon: WalletCards, label: "IBKR Paper 认证" },
  { href: "/linux-certification", icon: Server, label: "Linux 认证" },
  { href: "/soak-testing", icon: Timer, label: "长时间稳定性" },
  { href: "/fault-injection", icon: FlaskConical, label: "故障注入" },
  { href: "/ledger-integrity", icon: DatabaseBackup, label: "账本完整性" },
  { href: "/release-evidence", icon: FileCheck2, label: "发布证据" },
  { href: "/tasks", icon: ListTodo, label: "任务中心" },
  { href: "/notifications", icon: BellRing, label: "通知中心" },
  { href: "/positions", icon: BriefcaseBusiness, label: "持仓监控" },
  { href: "/risk", icon: ShieldAlert, label: "风控红线", badge: "5" },
  { href: "/risk-discipline", icon: ShieldAlert, label: "风险纪律" },
  { href: "/trade-plans", icon: ClipboardCheck, label: "买入审查" },
  { href: "/trades", icon: FileClock, label: "交易记录" },
  { href: "/reviews", icon: BookOpenText, label: "交易复盘" },
  { href: "/instruments", icon: Building2, label: "标的管理" },
  { href: "/settings", icon: Settings, label: "系统设置" },
];

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const dashboard = pathname === "/";
  const [dataSource, setDataSource] = useState<DataSource>("mock");
  const [alertCount, setAlertCount] = useState(0);
  const [accountName, setAccountName] = useState("账户数据加载中");
  const [riskDataSource, setRiskDataSource] = useState<RiskSummary["dataSource"]>();
  const [dataOrigin, setDataOrigin] = useState<string>("UNKNOWN");
  const [snapshotTime, setSnapshotTime] = useState<string>();
  const mobileNavigationOpen = useShellStore((state) => state.mobileNavigationOpen);
  const setMobileNavigationOpen = useShellStore((state) => state.setMobileNavigationOpen);
  const currentPage = navigation.find((item) => item.href === pathname)?.label ?? "业务页面";

  useEffect(() => {
    if (pathname === "/login") return;
    let active = true;
    const refreshRiskStatus = () => {
      void fetchWithFallback<RiskSummary>("/risk/summary", emptyRiskSummary).then((result) => {
        if (!active) return;
        setDataSource(result.source);
        setAlertCount(result.data.alerts.length);
        setAccountName(result.data.accountName);
        setRiskDataSource(result.data.dataSource);
        setDataOrigin(result.data.dataOrigin ?? "UNKNOWN");
        setSnapshotTime(result.data.snapshotTime);
      });
    };
    refreshRiskStatus();
    const refreshTimer = window.setInterval(() => {
      refreshRiskStatus();
      if (["/", "/performance", "/positions", "/risk", "/risk-discipline"].includes(pathname)) {
        router.refresh();
      }
    }, 60_000);
    window.addEventListener("xichu:data-updated", refreshRiskStatus);
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
      window.removeEventListener("xichu:data-updated", refreshRiskStatus);
    };
  }, [pathname, router]);

  if (pathname === "/login") return <>{children}</>;

  return (
    <div className={["app-shell", dashboard ? "app-shell--dashboard" : ""].join(" ")}>
      <button
        aria-label="关闭导航菜单"
        className={[
          "sidebar-backdrop",
          mobileNavigationOpen ? "sidebar-backdrop--visible" : "",
        ].join(" ")}
        onClick={() => setMobileNavigationOpen(false)}
        type="button"
      />

      <aside className={["sidebar", mobileNavigationOpen ? "sidebar--open" : ""].join(" ")}>
        <div className="sidebar__brand">
          <span className="sidebar__brand-mark">
            <ShieldCheck aria-hidden="true" size={21} />
          </span>
          <span>
            <strong>XichuQuant / 西楚量化交易系统</strong>
            <small>XICHU QUANT TRADING</small>
          </span>
          <button
            aria-label="关闭导航菜单"
            className="sidebar__close"
            onClick={() => setMobileNavigationOpen(false)}
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        <div className="account-switcher">
          <span className="account-switcher__icon">
            <Landmark aria-hidden="true" size={16} />
          </span>
          <span>
            <small>当前账户</small>
            <strong>{accountName}</strong>
          </span>
          <ChevronRight aria-hidden="true" size={14} />
        </div>

        <nav className="sidebar__nav" aria-label="业务导航">
          <span className="sidebar__label">风险管理</span>
          {navigation.map(({ badge, href, icon: Icon, label }) => {
            const active = pathname === href;
            const visibleBadge = href === "/risk" ? String(alertCount) : badge;

            return (
              <Link
                className={["nav-item", active ? "nav-item--active" : ""].join(" ")}
                href={href}
                key={href}
                onClick={() => setMobileNavigationOpen(false)}
              >
                <Icon aria-hidden="true" size={17} />
                <span>{label}</span>
                {visibleBadge ? <em>{visibleBadge}</em> : null}
              </Link>
            );
          })}
        </nav>

        <div className="sidebar__footer">
          <div>
            <span className="status-dot" />
            <span>{riskDataSource === "BROKER_SYNC" ? "IBKR Paper" : "本地模式"}</span>
            <strong>
              {dataSource === "api"
                ? riskDataSource === "BROKER_SYNC"
                  ? "券商同步"
                  : `${dataOrigin} · 本地存储`
                : "API 暂不可用"}
            </strong>
          </div>
          <p>仅允许人工审批 IBKR Paper · 禁止实盘写入</p>
        </div>
      </aside>

      <section className="app-workspace">
        <header className="top-status">
          <div className="top-status__left">
            <button
              aria-label="打开导航菜单"
              className="mobile-menu"
              onClick={() => setMobileNavigationOpen(true)}
              type="button"
            >
              <Menu size={19} />
            </button>
            <span>风控中心</span>
            <ChevronRight aria-hidden="true" size={13} />
            <strong>{currentPage}</strong>
          </div>
          <MarketClock />
          <div className="top-status__right">
            <span className="data-status">
              {dataSource === "api"
                ? riskDataSource === "BROKER_SYNC"
                  ? "IBKR Paper 同步数据"
                  : `${dataOrigin} · 本地存储`
                : "API 暂不可用"}
              {snapshotTime
                ? ` · ${new Date(snapshotTime).toLocaleString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })}`
                : ""}
            </span>
            <button aria-label="搜索" className="icon-button" type="button">
              <Search size={16} />
            </button>
            <button
              aria-label="风险通知，5 条未读"
              className="icon-button icon-button--notice"
              type="button"
            >
              <Bell size={16} />
              <i />
            </button>
            <span className="user-avatar">楚</span>
          </div>
        </header>
        <main className={["page-content", dashboard ? "page-content--dashboard" : ""].join(" ")}>
          {children}
        </main>
      </section>
    </div>
  );
}
