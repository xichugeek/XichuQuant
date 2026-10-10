# Demo 与数据来源

Demo 使用独立 `XichuQuantDemo_*` 数据库，显式 Seed 确认和强管理员密码；默认启动不 Seed。DLA2/DLB2、交易价格、事故与行情均为虚构/合成。它不是当前用户账户，也不是 IBKR 模拟账户。

| 来源 | 解释 |
| --- | --- |
| DEMO | 虚构展示账户/资料 |
| SYNTHETIC | 合成日线、测试与事故输入 |
| HISTORICAL | 用户明确导入的历史资料，需要来源/覆盖核验 |
| INTERNAL_PAPER | 内部模拟撮合与独立 Paper 账本 |
| IBKR_PAPER | 经身份校验同步的券商模拟账户 |
| LIVE_READ_ONLY | 真实账户读取，无写能力 |
| UNKNOWN | 旧资料或证据不足，不能作为新增风险放行依据 |

SQL Server 只是存储，不能证明行情实时。合成日线上的计算结果可以真实计算，但不是实际市场成交或获利证据。Daily MAE/MFE 是 approximation，拆股来源和时间粒度需显示；无历史权益时返回未知。

本地 Demo 可体验内部模拟；公共 Demo 加 readonly overlay 后只读结果，禁止上传、执行、修改和券商连接。公共界面始终显示 `DEMO MODE｜虚构数据｜未连接真实券商`。

断连时不向真实账户页面填入演示事故；来源未知显示不可用。完整 Seed 重跑保留用户已修改的 Demo，不能通过 Seed 刷新/覆盖账本。需要另一场体验则选择全新独立 Demo 库。

具体验收和历史隐私限制见 [新项目回归报告](REGRESSION_REPORT.md) 与 [隐私审计](PRIVACY_AUDIT_REPORT.md)。
