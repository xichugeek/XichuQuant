import type { Metadata } from "next";
import type { ReactNode } from "react";
import { APP_NAME } from "@xichu-risk/shared";

import { AppProviders } from "@/app/providers";
import { AppShell } from "@/components/app-shell";

import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "个人美股仓位管理、风险预警与交易纪律审查系统",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        {process.env.NEXT_PUBLIC_DATA_MODE === "DEMO" && (
          <div role="note" className="demo-mode-banner">DEMO MODE｜虚构数据｜未连接真实券商</div>
        )}
        <AppProviders>
          <AppShell>{children}</AppShell>
        </AppProviders>
      </body>
    </html>
  );
}
