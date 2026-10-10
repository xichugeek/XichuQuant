# XichuQuant v1.0.0 发行门禁

2026-10-10（Asia/Shanghai）。本轮只完成本地候选工程，没有公开代码。

| 门禁 | 状态 | 依据 |
| --- | --- | --- |
| 源允许清单/哈希/完整功能 | PASS | 414 源文件、36 明确排除、全部模块/测试/19 migrations |
| 全新 Git | CLEAN | main、1 个无父根提交、仅正确 origin、无旧 refs/tag/alternates |
| 源码/全部提交隐私 | PASS | Gitleaks 8.30.1 + 自定义规则 + 上下文，0 未解决真实秘密 |
| 独立回归 | PASS | 557 项与完整静态/生产构建；实际数据库与 HTTP 验证 |
| 新数据库/账本隔离 | PASS | 五个全新独立测试库和 RestoreTest；旧配置/业务库未连接 |
| Live 写入 | PASS | 合约测试及 OFFLINE 实际能力全 false；未执行外部订单 |
| Windows 本地安装 | PASS | 当前 Windows 18 步范围；前置环境已存在 |
| Linux Docker 实测 | NOT_RUN | Engine 不可用；不以静态 config 替代 |
| 外部 IBKR Paper | NOT_RUN / 未认证 | 不在本轮授权范围 |
| README 与安全指南 | PASS | 独立品牌/新库/18 步/来源/安装/限制；在线 Demo 尚未上线 |
| 第三方 metadata 清点 | READY_FOR_REVIEW | 656 Node / 39 Python，重点原通知已读；不重新许可依赖 |
| 有效原创许可/完整权属 | BLOCKED | UNLICENSED；需维护者选择 MIT/Apache 并确认版权/贡献者权利 |
| GitHub Push/Release | PENDING_APPROVAL | 未 Push/Tag/Release；只在人工门禁后执行 |
| Episode 007 | NOT_STARTED | 仅证据清单，尚无正式制作 |

## 下一步人工审阅

审阅 [许可证建议与权属事项](OPEN_SOURCE_LICENSE_REVIEW.md)，批准版权主体、贡献者授权、原创文件覆盖范围及 MIT 或 Apache-2.0；批准后落地 LICENSE/manifest/README 的一致变更。独立源码提交通过隐私与回归不解除该项。

决定首轮是否仅发行已验证的 Windows 源码，并明确披露 Docker NOT_RUN、外部 Paper 未认证。若发行 Docker 镜像，须先补真实 Linux build/up/health、持久化/恢复/网络和完整 binary/system inventory/NOTICE。官网部署、外部订单与 Episode 007 制作均需各自授权。

对最终待公开提交与附件再次隐私扫描，再由维护者明确批准公开 Push。当前可进入工程与许可审阅；最终 Push 放行仍受有效许可/权属和单独审批约束。

```text
XICHUQUANT_SOURCE_COPY = PASS
XICHUQUANT_GIT_HISTORY = CLEAN
XICHUQUANT_PRIVACY = PASS
XICHUQUANT_FEATURE_PARITY = PASS
XICHUQUANT_REGRESSION = PASS
XICHUQUANT_WINDOWS_INSTALL = PASS
XICHUQUANT_DOCKER = NOT_RUN
XICHUQUANT_LICENSE = READY_FOR_REVIEW
XICHUQUANT_GITHUB_PUSH = PENDING_APPROVAL
XICHUQUANT_RELEASE = PENDING_APPROVAL
XICHUQUANT_EPISODE_007 = NOT_STARTED
```
