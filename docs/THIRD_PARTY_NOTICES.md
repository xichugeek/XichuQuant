# 第三方依赖、版权与分发通知

2026-10-10（Asia/Shanghai）。本项目原创部分采用 MIT，Copyright (c) 2026 XichuGeek。下列第三方不由本项目重新许可。当前交付为源码与依赖声明/锁文件；依赖、前端 bundle、Python wheel、客户端、浏览器和系统二进制不随 Git 发布。

实际重新清点 **656 Node 包名（701 安装实例）与 39 Python distributions**，不是沿用历史数字。Node production 图 240、仅开发图 416；Python 当前 Windows runtime requirements 闭包 23、开发/安装工具 16。Node 分组：MIT 554；Apache-2.0 37；Apache-2.0 AND LGPL-3.0-or-later 1；BSD-3-Clause 11；ISC 27；Python-2.0 1；MPL-2.0 3；CC-BY-4.0 1；BSD-2-Clause 12；Unlicense 2；BlueOak-1.0.0 5；CC0-1.0 1；0BSD 1。每一条名称、版本、原始许可与实际范围见 [机器清单](THIRD_PARTY_INVENTORY.json)，不可一律改标 MIT。

## 随当前源码保留的上游适配通知

时间序列动量参考/适配来源：[bonnie-mcconnell/backtesting-engine](https://github.com/bonnie-mcconnell/backtesting-engine/tree/403831616b80d3ef2a0bfb72c5f903dbae082b0b)，MIT，Copyright (c) 2026 Bonnie McConnell。对应 models.py、backtest.py、validation.py 及 Seed 的来源说明；保留 [完整上游许可](licenses/backtesting-engine-MIT.txt)。上游来源与许可已核查，不宣称其原创贡献归 XichuGeek。

## 需要保留的主要运行与前端通知

| 组件/版本 | 实际许可及要求 | 当前分发分类 |
| --- | --- | --- |
| @stoqey/ib 1.6.9 | MIT，保留原作者版权与许可；不授权 IBKR 客户端或市场数据 | 运行依赖声明，包未分发 |
| ECharts 6.1.0 / zrender | Apache-2.0；ECharts LICENSE、NOTICE 及 bundled d3 BSD 许可都需保留 | 前端依赖声明，bundle 未分发 |
| lightweight-charts 5.2.0 | Apache-2.0、TradingView 归属及网页链接；安装包缺 NOTICE，从官方同版本 tag 核对补录 | 前端依赖声明，未来网页/bundle 需再次检查显示 |
| lucide-react 1.24.0 | metadata ISC；实际 LICENSE 含 Lucide ISC 和部分 Feather 图标的 MIT，不能只留一段 | 前端图标运行依赖，原许可证未覆盖/删除 |
| sharp Windows 0.34.5 / libvips | Apache-2.0 AND LGPL-3.0-or-later；实际二进制及源码获取/替换条件另审 | 运行原生包未分发 |
| caniuse-lite 1.0.30001805 | CC-BY-4.0；数据归属、许可链接及修改说明按实际分发保留 | production 图中的工具数据，当前未分发 |
| axe-core 4.12.1、lightningcss/binding 1.32.0 | MPL-2.0，保留原许可和必要对应源码；axe 另有 LICENSE-3RD-PARTY | 当前仅开发图，未分发 |
| pathspec 1.1.1、certifi 2026.7.22 | MPL-2.0；按实际文件许可，不据 Python metadata 缺失重标 | Python 开发依赖闭包，未分发 |
| NumPy 2.5.1 wheel | NumPy 多许可；OpenBLAS/LAPACK BSD；GCC runtime GPL-3.0-or-later WITH GCC-exception-3.1 | 运行依赖，wheel/DLL 未分发；未来须核对准确构建和例外条件 |
| pandas 3.0.3 / python-dateutil 2.9.0.post0 | BSD-3-Clause / Apache-2.0 OR BSD-3-Clause，保留旧代码 BSD 通知 | 运行依赖未分发 |
| colorama 0.4.6 / ruff 0.15.6 | BSD-3-Clause / MIT 及内含第三方文本，UNKNOWN 仅是 metadata 提示 | 开发/安装环境，未分发 |
| SQL Server、Node/Python、IB Gateway/TWS | 各自 EULA/许可、系统与 API/行情使用条件 | 用户另行安装；不由 MIT 授予 |

ECharts 实际 NOTICE 原文：

```text
Apache ECharts
Copyright 2017-2026 The Apache Software Foundation

This product includes software developed at
The Apache Software Foundation (https://www.apache.org/).
```

TradingView v5.2.0 官方 NOTICE 原文（保持其版权字符）：

```text
TradingView Lightweight Charts™
Copyright (с) 2025 TradingView, Inc. https://www.tradingview.com/
```

来源：[官方同版本 NOTICE](https://github.com/tradingview/lightweight-charts/blob/v5.2.0/NOTICE)，SHA-256 `f76c6afab94884448f0426e30d6e9d555ca7247894cd3484e477d2f87513036e`。此处补录通知不代表未来网站已显示必要归属。现有 chart 未禁用库默认 logo/link；发布网站前应在用户可访问页面落实完整归属和链接。

## 许可缺失与后续交付条件

实际清点读取 691 个 Node 许可/NOTICE/作者文件及 65 个 Python 许可文件，重点原文与 SHA 存在本地私有审计证据；未复制作者联系方式或个人目录到公开清单。以下 **22 个 Node 包名**的安装目录没有独立许可文件，但已有明确 metadata，包体也未进入当前 Git 交付。二进制/镜像再分发前须取得准确上游版本的原许可/NOTICE：

- `@esbuild/win32-x64` 0.28.1 — MIT
- `@next/env` 16.2.10 — MIT
- `@next/eslint-plugin-next` 16.2.10 — MIT
- `@next/swc-win32-x64-msvc` 16.2.10 — MIT
- `@tokenizer/token` 0.3.0 — MIT
- `@types/json5` 0.0.29 — MIT
- `@unrs/resolver-binding-win32-x64-msvc` 1.12.2 — MIT
- `client-only` 0.0.1 — MIT
- `command-buffer` 0.1.0 — MIT
- `eslint-config-next` 16.2.10 — MIT
- `fancy-canvas` 2.1.0 — MIT
- `function-rate-limit` 1.1.0 — MIT
- `imurmurhash` 0.1.4 — MIT
- `keyv` 4.5.4 — MIT
- `language-tags` 1.0.9 — MIT
- `natural-compare` 1.4.0 — MIT
- `stable-hash` 0.0.5 — MIT
- `unrs-resolver` 1.12.2 — MIT
- `@humanfs/types` 0.15.0 — Apache-2.0
- `esrecurse` 4.3.0 — BSD-2-Clause
- `glob-to-regexp` 0.4.1 — BSD-2-Clause
- `language-subtag-registry` 0.3.23 — CC0-1.0

Python UNKNOWN/多行项已阅读原文件，原始 metadata 保留并增加 review 字段。开发图与实际 bundle 内容不能简单等同；发布包含第三方代码的产物时必须按实际文件清单保留 MIT/BSD/ISC/Apache 原版权、免责及 NOTICE，核验 MPL/LGPL、CC-BY 和原生库的对应源码、归属、替换与其他条件。pip 的 vendored 文件、标准库、Linux 镜像系统包不由 distribution 数量完整覆盖，后续实际产物需再清点。

当前没有未解决的实质性源码交付权属阻断项；Linux Docker 与二进制/镜像再分发审查未执行，不能把本说明当作完整二进制 NOTICE 包。详见 [MIT 与权属复审](OPEN_SOURCE_LICENSE_REVIEW.md)。
