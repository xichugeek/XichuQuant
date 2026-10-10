# 备份与隔离恢复

Windows 复用 backup.cmd / restore-test.cmd；明确传入同一个 `-EnvFile`。环境只字面解析，SQL 密码经 SQLCMDPASSWORD 子进程环境传递，不在参数或日志中输出。

```bat
backup.cmd -EnvFile .env.local-user
restore-test.cmd -EnvFile .env.local-user
```

备份使用 COPY_ONLY/CHECKSUM，立即 RESTORE VERIFYONLY。默认不压缩以支持 SQL Express，不默认清除旧备份。保留规则检查为 7–365 天；需要删除到期的项目备份时才显式使用 `-PruneExpired`，并检查目标目录与匹配文件名。磁盘余量未知不等于充足。

备份文件在 SQL Server 服务端默认备份目录，不一定能由应用电脑直接访问。需由维护者将备份加密复制到独立介质/受控离机存储，并记录密码、schema/迁移、源码和环境文件的恢复方式；不把这些内容放公共 Git 或 Web 路径。

恢复演练只创建 `${源库}_RestoreTest`，拒绝已有目标，不使用 WITH REPLACE。从最新 COPY_ONLY 备份读取逻辑文件名，恢复到独立 data/log 文件，执行 DBCC CHECKDB 和 migration 检查。源库不被覆盖；演练库保留供人工核对，不能自动 reset。

VERIFYONLY 不是完整恢复成功；CHECKDB、迁移数量、账户/持仓/成交/佣金/审计计数及关键金额都需要核对。本轮报告记录实际隔离恢复与摘要对照。正式恢复事故时先保全原库、停止新增风险、回读已提交订单，再审查切换计划，不能直接把旧备份覆盖活动交易账本。

生产 API 审计需要认证；脚本未获会话或 API 不在线时会警告 UI 审计未写入。`-SkipApiAudit` 用于独立测试/离线操作，保留本地脱敏和 SQL 校验证据，不将验证失败写成 PASS。

Linux 验收脚本包含备份、VERIFYONLY、独立恢复和 CHECKDB；实际未运行前仍 NOT_RUN。named volume 内备份不能抵御主机或磁盘损毁。
