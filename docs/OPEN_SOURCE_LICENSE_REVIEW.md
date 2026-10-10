# MIT 落地与第三方权属复审

2026-10-10（Asia/Shanghai）。维护者正式批准 `LICENSE_TYPE=MIT`、`COPYRIGHT_YEAR=2026`、`COPYRIGHT_HOLDER=XichuGeek`。根 [LICENSE](../LICENSE) 已采用标准完整 MIT 正文，UTF-8 无 BOM，无异常控制字符；版权为 `Copyright (c) 2026 XichuGeek`。7 个项目原创工作区 manifest 均声明 MIT，版本、依赖、锁文件与业务代码保持本轮开始时的内容。`private: true` 表示不发布 npm 包，不取消源码许可。

MIT 覆盖维护者有权授权的项目原创部分；第三方适配代码、依赖、数据、商标和客户端分别保留原条件。以本次明确人工批准作为原创部分授权依据，不以 Git 作者或 AI 编写经历证明第三方权利。公开 Push 与 Release 仍需单独批准。标准依据：[OSI MIT](https://opensource.org/license/mit)。

## 当前交付范围与权属检查

当前仅申请公开 Git 源码树及依赖声明/锁文件，供用户 Windows 本地安装。Git 不含 node_modules、Python 虚拟环境、前端 `.next`/静态 bundle、浏览器、SQL Server、IBKR 客户端、系统库、媒体或导出行情。未发布包含这些内容的二进制包或 Docker 镜像。

检查拟公开全部文本的 Copyright、All Rights Reserved、UNLICENSED、Proprietary、适配/复制来源、旧品牌及研究链接。未发现需要额外授权而来源不明的实质性复制代码；此为当前文件和已标注来源的工程复审范围，不声称证明任意历史未标注复制。旧 XichuRisk / @xichu-risk / XICHURISK 标识是迁移来源、兼容键或安全拒绝条件，不是第三方版权主体。历史根提交中的待批准许可是当时状态，本轮用普通后续提交完成 MIT，没有重写历史。

明确发现 `apps/quant-engine/app/models.py` 的 TimeSeriesMomentum 适配说明及 Seed 来源。核对 [backtesting-engine 上游固定提交](https://github.com/bonnie-mcconnell/backtesting-engine/tree/403831616b80d3ef2a0bfb72c5f903dbae082b0b) 的 LICENSE 与 momentum 实现；上游 MIT，`Copyright (c) 2026 Bonnie McConnell`。保留原来源说明，为该适配补入 [上游完整 MIT](licenses/backtesting-engine-MIT.txt)，SHA-256 `122e1337a52ebee631027875fb292899263806f103a3d481af9c9ed19db43dd8`。本项目实现使用自己的 Pydantic/pandas 回测接口，不将上游贡献改署 XichuGeek。研究链接仅指向公开资料，不附全文、外部缓存或市场数据；既有研究结果不是本轮收益验证，合成行情结果也不是历史盈利证据。

## 实际依赖复审

从当前安装重新运行 pnpm 全量及 production licenses、Python distribution metadata，并读取实际许可文件。结果为 **656 Node 包名 / 701 安装实例 / 39 Python distributions**；Node production 图 240 包名、仅开发图 416，Python 运行 requirements 闭包 23、开发或安装工具 16。全量清点读取 691 个 Node 许可/NOTICE/作者文件和 65 个 Python 文件（含重复安装路径）；读取与哈希清点不等同于逐文件法律认证。常见 SPDX 条目按当前源码仅声明依赖的范围分类，重点特殊条目逐项复核，详见 [第三方通知](THIRD_PARTY_NOTICES.md) 与 [完整清单](THIRD_PARTY_INVENTORY.json)。

Python 元数据缺失项已按原文解决：colorama BSD-3-Clause，pathspec MPL-2.0，ruff MIT 及内含第三方通知；pandas BSD-3-Clause，python-dateutil Apache/BSD 双许可并保留较早 BSD 代码通知。保留原 UNKNOWN/多行字段用于追溯，不伪造全树 MIT。NumPy 顶层 SPDX 没有概括 Windows wheel 的全部原生许可：其实际 LICENSE 明确包括 OpenBLAS/LAPACK 的 BSD 和 GCC runtime 的 GPL-3.0-or-later WITH GCC-exception-3.1。wheel 未进 Git。

`@img/sharp-win32-x64` 为 Apache AND LGPL；MPL 项为 axe-core、lightningcss、Windows binding、Python pathspec/certifi；caniuse-lite 为 CC-BY-4.0。当前 Node metadata 未发现纯 GPL/AGPL 或 UNKNOWN；这不否认 NumPy 原生许可，也不说明目标 Linux 镜像已审查。

## 分类结论与后续产物门禁

| 分类 | 当前结论 |
| --- | --- |
| 已核查且兼容当前源码交付 | 原创 MIT；已标注上游 MIT 适配保留完整许可；依赖仅声明和锁定，不把第三方重新许可 |
| 需保留版权/NOTICE | MIT/BSD/ISC/Apache 等原文本；ECharts、TradingView、Lucide/Feather 通知；MPL/LGPL/CC-BY 与 NumPy 原生组件的实际条件 |
| 仅开发/安装环境、未分发 | 416 Node 仅开发图、16 Python 开发/安装项；所有 240 Node production 与 23 Python runtime 也未随当前 Git 树分发 |
| 尚未确认，需要后续人工处理 | 当前源码交付无未解决实质性权属项；未来二进制包/镜像需补目标 OS 组件、22 个无独立 LICENSE 文件的 Node 包、pip vendor、LGPL/MPL 源码提供及图表网页归属显示审查 |

22 个 Node 包虽有许可 metadata，但安装目录没有独立许可文件，完整名称/版本见机器清单；不能把这种情况当作通知义务已履行。它们没有进入当前 Git 分发，因此不是本次源码 Push 阻断项；若以后捆绑它们，必须先从准确上游版本取得原许可与通知。SQL Server、Node/Python 与 IBKR 使用/行情条件独立，不能据本项目 MIT 自行再分发其客户端或数据。

TradingView 实际 npm 包缺 NOTICE，本轮从匹配 v5.2.0 官方 tag 取得并保存在第三方通知。现有图表未关闭默认 attributionLogo，已检查库默认值；未来发布网站/bundle 时还需保证用户可访问页面显示原归属与链接，不把源码通知当作已上线网站认证。参考 [TradingView 文档](https://tradingview.github.io/lightweight-charts/docs)、[Apache 条件](https://www.apache.org/licenses/LICENSE-2.0)、[MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)、[sharp 安装说明](https://sharp.pixelplumbing.com/install/) 与 [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/)。

`XICHUQUANT_LICENSE=PASS`；`XICHUQUANT_THIRD_PARTY_REVIEW=PASS` 仅针对当前 Windows 源码交付。二进制/镜像授权包与系统清单尚未放行；该结论不解除单独公开 Push 审批。
