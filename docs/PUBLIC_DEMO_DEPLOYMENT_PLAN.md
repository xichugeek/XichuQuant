# XichuQuant 官网 Demo 计划（尚未上线）

官网 Docker Demo 尚未部署，域名、DNS、TLS、资源与上线时间均待单独审批。本轮没有连接官网服务器、修改路由或开始 Episode 007 制作。

公共体验使用独立只读 Demo：DEMO 账户、SYNTHETIC 行情、Broker OFFLINE/DISABLED、外部 Paper 与 Live 写能力全 false。禁止加载个人 Gateway overlay、真实券商凭据、个人持仓、上传与外部执行。页面显示 DEMO MODE / 虚构数据 / 未连接真实券商。

保留现有 base Compose、生产 HTTPS overlay 与 docker-compose.demo.yml。API 启动同时核验配置和实际账户、BrokerAccount、行情来源、连接状态；不能凭数据库名认定安全。写接口只保留应用登录/退出，定时策略和恢复任务跳过。

本地操作环境先生成合成回测与内部 Paper 的已审查结果，再进入只读展示。不能把合成收益暗示为真实历史盈利。保护 Stop、未知行情、风险超限和 Kill Switch 的拒绝原因必须保留。

当前为单用户管理员模型，共享账号登录会撤销旧 Session；不承诺无限访客并发。上线前须确定访客身份/会话方式，完成真实 Linux 容器、持久化、备份恢复、网络权限、HTTPS、限流、SSRF、上传/执行绕过、日志脱敏、资源和稳定性验收。现有容器资源上限只是配置，不是负载认证。

维护者批准项目许可及权属、最终代码隐私与目标运行证据后，再单独批准官网部署。失败保留证据，不自动 reset、删卷、重置数据或扩大交易权限。见 [发行门禁](RELEASE_READINESS_REPORT.md) 与 [Docker 指南](DOCKER_LOCAL_DEPLOYMENT.md)。
