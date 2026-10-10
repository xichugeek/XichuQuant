# 故障排查

| 现象 | 检查与处理 |
| --- | --- |
| setup 创建示例后停止 | 编辑选定环境中的本地值；占位符不能继续。已有文件不会自动覆盖 |
| Duplicate key / database parameter | 删除歧义参数，明确唯一目标；不能只改第一个 database |
| Node/Corepack/Python 不匹配 | 检查 PATH、Node >=22.12、pnpm 11.9、py -3.12；不升级锁文件来绕过 |
| SQL 无连接 | 本地 SQL 认证、TCP、sqlcmd、用户名权限；密码不放日志或 -P 参数 |
| Initialize refuses nonempty | 检查所选数据库，保留数据；已有库先备份/恢复再审查迁移 |
| Prisma migration pending | 明确选定目标，备份后手动 db:deploy；启动不会偷偷迁移 |
| 端口占用 | 使用原窗口 Ctrl+C；本项目 launcher 可用 stop-dev.cmd。未知进程不会被强杀 |
| 页面无数据 | 检查生产登录/会话、Cookie、WEB_ORIGIN、API_INTERNAL_URL、来源与 selected account；不填假数据 |
| 401/403/426 | 过期会话/CSRF/Origin/HTTPS/公共 Demo 只读；修正配置或重新登录，不取消安全校验 |
| 登录锁定 | 5 次失败后等待 15 分钟并核实自己的应用密码；不是 IBKR 密码 |
| Broker OFFLINE | 默认正常安全状态；只读连接须用户登录官方客户端并明确配置，不自动切模式 |
| 公共 Demo 报 external configuration | 使用新版启动入口与完整独立环境文件；明确清空外部字段，避免 Prisma 从根配置填回。不能删除门禁来继续 |
| Paper 年度上下文未知 | 补全、核验年度 statement；session PnL 不能代替年度利润证据 |
| Stop 或订单状态未知 | 停新增风险，回读订单/成交/佣金并对账；不重复提交 |
| Docker CLI 有但 daemon 无 | 启动/修复自己 Docker 环境后重跑；当前状态 NOT_RUN，静态 config 不能替代 |
| 容器里 127.0.0.1 连不到 Gateway | 那是容器自身。核对受控 host-gateway 映射、宿主机真实绑定和权限；不关闭券商安全控制 |
| Restore target already exists | 保留旧演练库，选新隔离恢复目标/源库；禁止 WITH REPLACE 覆盖 |
| 运维 UI 审计警告 | API 不在线或无认证会话；保留 SQL 与本地证据，不能声称 UI 已审计 |

报告错误时只提供脱敏日志、时间、服务和关联 ID。不要上传 .env、Session Cookie、数据库备份、券商密码、真实账户导出或未脱敏截图到公共 Issue。
