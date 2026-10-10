# Episode 007 工程证据清单（制作未开始）

视频定位：用 AI 完成一套真正可以本地运行的量化交易与风险控制系统。不得用策略收益保证作为卖点。本轮只生成清单；以下素材制作/公开取用均未启动。

| 证据 | 本轮工程依据 | 后续取证与说明 |
| --- | --- | --- |
| 最终 Dashboard | 生产登录、真实 Demo SSR、桌面/手机 QA | 截图保留 DEMO / 虚构数据，先做最终媒体隐私复查 |
| 回测结果 | AAPL 基准策略实际 COMPLETED | 明示 SEED_V1_3 / SYNTHETIC，不暗示真实历史盈利 |
| 风险拒单 | 风险超限/未知行情/Stop/Kill Switch 全测试 | 展示原原因及审计，禁止放宽门禁获取演示单 |
| 模拟订单与成交 | 实际内部 PaperFill、重复 run 幂等 | 标注 INTERNAL_PAPER，不能冒充 IBKR 外部成交 |
| 资金分配/策略组合 | 既有页面/组合规则/Python 回归 | 只选已审查虚构账户与预设策略，不增加策略 |
| 事故复盘 | SYNTHETIC_LAB / 合成拆股与 Daily 近似 | 隐藏真实事故资料，保留来源和近似声明 |
| Windows 启动 | 新项目 setup / Production / health / stop | 只显示脱敏命令与结果，隐藏本机路径/密码/Session |
| 备份恢复 | COPY_ONLY/CHECKSUM/VERIFYONLY/CHECKDB/19 migrations/10 表摘要 | 不展示实际备份文件内容、SQL 地址或私人路径 |
| GitHub 页面 | 新空远端已核查；本轮未推送 | 推送审批后才能录制含公开源码的项目页，不伪造已发布 |
| 可复现测试 | 新目录 557 项，SHA 清单与机器回执 | 显示脱敏摘要；不展示 storageState/环境变量/原始敏感日志 |
| 未认证事项 | Docker NOT_RUN、外部 Paper 未认证 | 必须在解说中披露；不把 Windows 测试冒充 Linux/券商认证 |

禁止出现真实 IBKR 账户/个人交易/持仓资金、登录/MFA、JWT/Session/CSRF、服务器公网 IP、个人邮箱、本机私人路径与环境。截图/录屏须逐帧检查；后续视频制作需独立授权。

本轮 Dashboard QA 图片只在忽略的本地 output/playwright 保存，不加入 Release 或公开仓库。公开证据与下载仅来自最终批准的 XichuQuant 提交。源码根提交、源映射、隐私与回归见 [迁移报告](RELEASE_MIGRATION_REPORT.md)。
