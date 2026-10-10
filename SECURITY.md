# 安全边界与问题报告

推荐单用户本地部署。Live place/modify/cancel 固定禁用，READ_ONLY_LIVE 不升级权限；IBKR Paper 需要精确身份、证据、人工审批和二次确认。普通 Override 不绕过硬风控。

开发模式只用于本机调试，不提供生产认证。生产使用安全 Session、CSRF、来源白名单及登录/API 限流；远程部署需 HTTPS、访问代理/VPN 和私有数据库/Connector 网络。当前不承诺多租户用户级授权。

公共 Demo 只能独立虚构只读数据、Broker OFFLINE，无个人会话、上传或执行。不得在官网放置个人 Gateway。Linux 和公共环境未实际验收前不得标成已认证。

凭据只保存在受保护本地配置；IBKR 登录和 MFA 只输入官方客户端。不记录 Session/CSRF/Set-Cookie、SQL 密码或券商标识到公开日志。不要公开 `.git` 辅助引用、数据库导出、备份、storageState 或未脱敏截图。

遇到疑似安全问题先停止新增风险，保留失败证据并核对实际订单；不要批量重提或试验 Live 写能力。发现泄露凭据时撤销/轮换并独立调查传播范围；清理当前文件不能清理旧 Git 历史。

请联系维护者取得私密报告渠道，提供脱敏复现、影响范围和时间。未确认私密渠道前，不在公共 Issue/PR 放敏感细节；本文件不假设 GitHub private vulnerability reporting 已开启。

新项目独立历史与隐私结果见 docs/PRIVACY_AUDIT_REPORT.md；公开推送、许可证和 Release PENDING_APPROVAL。安全报告不是外部认证声明。
