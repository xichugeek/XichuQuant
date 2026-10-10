# IB Gateway / TWS 本机指南

用户自己登录官方 IB Gateway 或 Trader Workstation，并完成 MFA；XichuQuant 不收集登录密码或双重验证码。应用的管理员密码只用于本地网站，环境中的 Paper account ID 是账户身份校验信息，不是券商登录密码。

准备合法可用的 IBKR 账户及 Paper 权限、官方客户端、本地电脑、网络、必要行情权限，以及已运行的本地服务。账户或行情未核实不能通过新增风险门禁。

## 先保持只读

1. 用户打开官方客户端，选择 **IB API / Simulated Trading** 并自行登录。检查客户端确为 Paper，不能只凭账户金额判断。
2. 在 API 配置中启用官方 Socket 客户端入口，保持 Read-Only API；限制访问到本地且保留 Trusted IP、认证和 MFA。不要关闭重要安全控制或允许任意公网地址。
3. 核对实际 Socket Port。默认 Gateway Paper 4002 / Live 4001，TWS Paper 7497 / Live 7496；官方允许配置变更，应用当前 Socket Paper 实现只允许 4002/7497，端口不匹配时拒绝，不猜测身份。
4. 受保护环境选择 `IBKR_PAPER_TRANSPORT=TWS_SOCKET`、`IBKR_TWS_HOST=127.0.0.1`，填写实际 Paper 端口、一个不与其他客户端重复的 Client ID、实际 Gateway 登录时区。不能将缺少时区的执行时间解释为本机当前时间。
5. 只在明确启用自己 Paper 只读连接时设置 `BROKER_CONNECTOR_MODE=IBKR_PAPER`、`BROKER_CONNECTOR_ENVIRONMENT=PAPER`，仍保持 `IBKR_TWS_API_READ_ONLY=true`。填写经核实的 Paper account ID、账户哈希白名单、相同的账户哈希 pepper 及明确的本地账户关联。
6. 在设置中核对系统连接模式与账户关联，检查只读返回的账户身份、币种、权益、时间戳和来源。来源不得是 DEMO/MOCK。不要选择“第一个账户”代替核对。

端口默认值、Read-Only 和市场数据权限的解释来自 [IBKR 官方安装配置说明](https://www.interactivebrokers.com/campus/trading-lessons/installing-configuring-tws-for-the-api/)。默认端口不能独立证明账户身份。

当前 Socket Provider 强制 Paper 身份；不能把端口改成 Live 端口以取得 Live 写入。现有 READ_ONLY_LIVE 是 HTTP 只读适配，需要对应只读网关配置；没有本轮 Live Socket 认证。

## Paper 与 Live

| 模式 | 允许能力 | 必须保留的门禁 |
| --- | --- | --- |
| INTERNAL_PAPER | 内部合成/历史模拟账本 | 策略批准、退出条件、资金与风险规则；不连接券商 |
| IBKR_PAPER | 已批准且二次确认的模拟券商测试 | 精确 Paper 身份、来源、哈希白名单、行情质量、年度账本证据、预算、保护 Stop、审批、幂等与对账 |
| LIVE_READ_ONLY | 真实账户读取 | place/modify/cancel 永久 false；不能通过配置或 Override 开启 |
| DEMO | 完全虚构展示 | Broker OFFLINE，无外部写能力 |

取消券商只读不是安装步骤，也不代表系统订单获准。单独批准外部 Paper 测试后才评估客户端 Paper 写权限；Live 客户端始终保持只读。阶段 C 没有提交外部 Paper 订单。

年度 statement 覆盖尚未核实的账户会被门禁拒绝，即使权益、端口和报价已连接。不能把 session PnL 当作年度收益，不能为演示交易而虚构年度证据。

## 稳定运行与恢复

- 实时行情需要券商来源、有效时间戳、已验证质量和新鲜度；延迟、冻结、未知、过期或无订阅状态均阻止新增风险。历史日线不能冒充盘中实时数据。
- 交易日使用 America/New_York 和交易日历，节假日、半日和美国夏令时会改变北京时间对应关系；不把北京时间固定钟点当作开盘依据。
- 客户端会话可能过期、重新认证或在重启后要求 MFA；自动重连不能替代用户认证。客户端和电脑需要持续运行，网络中断、休眠或关机都会影响 API。
- 重连后先回读 open/completed orders、executions 和佣金，核对 orderRef、Socket ID、Permanent ID、Execution ID；不得批量重新发送“可能已提交”的订单。
- Unknown、Rejected、Cancelled 或保护 Stop 数量/状态不一致时保持拒绝，写入审计并人工对账；没有确认的佣金保留 null，不能记成已确认零费用。
- Stop 缺失或失效不能继续增加风险；跳空时 Stop 不保证按止损价成交。Live 撤单也被固定禁用，不能依赖本系统替真实账户处理保护单。
- Linux Docker 访问宿主机不等于 localhost；安全网络验证见 [Docker 指南](DOCKER_LOCAL_DEPLOYMENT.md)。未完成宿主机绑定、访问白名单和账户证据时记 BLOCKED/NOT_RUN。

## 独立外部测试计划（未执行）

需要人工另行批准：具体的已核实 Paper 账户（标识保存在私有证据中）、测试标的 AAPL、数量 1、RTH 限价 BUY、原子保护 Stop、预先计算的风险预算、当日报价证据、退出和取消规则。具体限价/Stop 只能根据批准时的有效行情填写；字段未知时不提交。

先测试只读身份和权限，再测试预览/硬风控拒绝，再提交最小订单；确认真实 Order/Execution/Commission、部分成交保护数量、断线后回读和零重复提交。保留费用、滑点、拒绝和失败证据。若年度证据或任何门禁无法通过，计划本身不得绕过系统；先补证据再申请执行。

预期：仅 IBKR Paper 账本变化，普通账户和内部 Paper 不变，Live 写能力始终 false。这个计划不是订单授权或盈利承诺。
