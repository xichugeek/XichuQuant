# XichuQuant v1.0.0 发行门禁

2026-10-10（Asia/Shanghai）。维护者已批准 MIT，当前 Windows 本地源码候选 **READY_FOR_APPROVAL**。实际公开 Push 尚未授权，本轮没有上传代码、创建 Tag 或 Release。

| 门禁 | 状态 | 依据与范围 |
| --- | --- | --- |
| 有效项目许可 | PASS | MIT 标准全文，Copyright (c) 2026 XichuGeek，7 个原创包一致 |
| 当前源码交付第三方权属 | PASS | 重清点 656 Node / 39 Python；上游适配许可与通知保留；不包含第三方二进制 |
| 允许清单/完整性/功能 | PASS | 414 源文件，365 原样/49 审阅变更，36 排除，427 公开文本；19 migrations 未变 |
| 独立 Git | CLEAN | 原审计根 + 普通 MIT 提交；一个已审计本地 capture tree；仅正确 origin，无旧历史/tag/alternates |
| 隐私 | PASS | Gitleaks 8.30.1 工作树/index/全部历史含 reflog；对象、上下文与新秘密重叠检查 |
| 本轮回归 | PASS | 实际重跑 250 tests + lint/typecheck/build + Prisma Validate/Generate |
| Windows 安装/SQL/生产浏览器 | PASS（复用，未重跑） | 原候选实际 18 步、SQL 7、Playwright 300、认证/回测/Fill/备份恢复；本轮无运行变更 |
| Live 写入 | 禁用 | 既有保护和 OFFLINE/DISABLED 未变；未连接外部下单 |
| Docker | NOT_RUN | Engine 不可用；静态 Compose 不代替实测；未来镜像还须权属清点 |
| 外部 IBKR Paper | NOT_RUN / 未认证 | 不声明外部订单闭环通过 |
| GitHub 远端 | Public / main 默认 / 空仓库 | 只读 API 核对 xichugeek/XichuQuant；ls-remote 无 refs |
| Push/Tag/Release | PENDING_APPROVAL | 仅申请源码 Push；实际操作须另获明确批准 |
| Public Demo / Episode 007 | NOT_DEPLOYED / NOT_STARTED | 未部署官网、未制作视频 |

当前源码候选无未解决技术、隐私或第三方实质性权属阻断项；唯一公开操作门禁是维护者明确 Push 授权。未来含依赖 ZIP/Docker 镜像、网站部署、外部 IBKR 认证和公开媒体分别审查授权，不包含在本次源码 PASS 内。远端出现任何用户新增 refs/历史必须停止，不能覆盖。

完整结果与本轮文件清单见 [最终发布验收](FINAL_PUBLICATION_AUDIT.md)、[许可复审](OPEN_SOURCE_LICENSE_REVIEW.md)、[第三方通知](THIRD_PARTY_NOTICES.md)、[隐私](PRIVACY_AUDIT_REPORT.md) 和 [回归](REGRESSION_REPORT.md)。

```text
XICHUQUANT_LICENSE = PASS
XICHUQUANT_THIRD_PARTY_REVIEW = PASS
XICHUQUANT_PRIVACY = PASS
XICHUQUANT_GIT_HISTORY = CLEAN
XICHUQUANT_REGRESSION = PASS
XICHUQUANT_WINDOWS_INSTALL = PASS
XICHUQUANT_DOCKER = NOT_RUN
XICHUQUANT_IBKR_PAPER_EXTERNAL = NOT_RUN
XICHUQUANT_PUBLIC_PUSH_READINESS = READY_FOR_APPROVAL
XICHUQUANT_GITHUB_PUSH = PENDING_APPROVAL
XICHUQUANT_RELEASE = PENDING_APPROVAL
XICHUQUANT_PUBLIC_DEMO = NOT_DEPLOYED
XICHUQUANT_EPISODE_007 = NOT_STARTED
```
