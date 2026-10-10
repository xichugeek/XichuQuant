# XichuQuant 隐私审计

2026-10-10（Asia/Shanghai）。审查完整新发行文件集合：四个应用、Seed/Mock/Fixture、Prisma schema 与 19 migrations、全部 tests、README/文档、Docker/Compose、安装/部署/备份脚本、环境模板、第三方机器清单、公开源清单、Git 新增 blob/commit 元数据。正式 Release 附件尚未创建，公开媒体/附件数量为 0。

## 方法与结论

使用官方 Gitleaks **8.30.1**（下载 ZIP SHA-256 与官方 checksums 一致）默认规则扫描最终独立源码快照及新仓库全部提交，开启 100% 输出脱敏且忽略 inline allow 注释；不配置宽泛跳过路径或秘密基线。自定义扫描补充私钥、Token/JWT、IBKR 账户格式、个人绝对路径、邮箱、公网 IPv4、旧事故衍生组合，以及环境模板、Seed 和 Fixture 上下文人工核查。

结果：新发行源码与提交历史没有有效凭据、私人交易/账户、私人路径或服务器公网 IP 命中；Gitleaks 未发现秘密。所有发行文件为文本，0 个二进制/大文件被跳过。明确合成账户格式测试、示例邮箱和回环/文档地址单独审阅，不因格式命中假称真实泄露。

四个账户格式 Fixture 文件用于导入、掩码、环境身份与拒绝测试：broker-v1.7.test.ts、certification.rules.test.ts、import-v1.2.test.ts、provider.test.ts。顺序数字/明确构造的 Paper/Live 标识与真实客户端无关联；其中一个来源不够明确的掩码测试标识本轮改为明确虚构标识，并保持完整断言。发现真凭据即阻断公开的规则仍保留。

DEMO_ALPHA / DEMO_BETA、DLA2 / DLB2、SYNTHETIC_LAB 及虚构案例保留；行情为 SYNTHETIC，不能声称真实历史获利。数据来源七种枚举保留；未知行情、连接失败和未知来源不会静默当作正常 Demo/真实数据。公共 Demo 实际数据库检查拒绝 UNKNOWN 账户与 HISTORICAL 行情，事务回滚。

## 排除与历史边界

只从源审定提交的明确允许路径生成 archive。旧 .git、codex-checkpoints、实际 .env、私人 CSV/导出、SQL 文件/备份、账户/持仓快照、真实事故、Agent 历史日志/截图、storageState、私人媒体/报告、依赖/缓存/虚拟环境均未复制；36 个历史跟踪文档明确排除，见 [源清单](SOURCE_COPY_MANIFEST.md)。旧 18 个事故衍生历史文本对象没有进入新仓库，未操作旧历史。

新项目本地 .release-private、logs、output/playwright、.playwright-cli、test-results 和新 .venv/node_modules 不公开，Git 与 Docker 忽略规则保护它们。本轮新数据库密码、JWT、pepper、浏览器 Session/storageState 未进入 Git。审计原始日志只保留本地，报告不写匹配敏感原值。

独立 Git 保留已审计无父根提交并追加普通 MIT 提交；无旧项目 refs、其他 remote、tag 或 alternates。Codex 自动生成的一个本地 capture ref 是与已审计根提交完全一致的 tree，没有额外提交或私人内容；完整记录并保留，不以删除/重写掩盖检查。发行校验拒绝任何额外提交、未知 ref 或不匹配的 capture tree。元数据使用软件维护者名称和 GitHub noreply 邮箱。每个新提交与未来附件需继续重扫，不能从此次 PASS 推论任意未来发布物安全。

本轮 QA Dashboard 桌面/手机图片人工检查仅有 DEMO 与虚构持仓，保留于忽略目录，不作为公开 Release 附件。Episode 007 尚未制作。许可证/权属与公开 Push 批准独立于隐私 PASS，不因扫描通过自动公开。

结论 **XICHUQUANT_PRIVACY=PASS**，仅覆盖最终候选源码/独立提交和已审阅本地 QA；扫描器不是绝对安全保证，未来实际分发包必须按同一门禁复查。

## MIT 落地后最终复扫

本轮再次扫描全部 427 个公开文本候选，包含新增 MIT、上游许可、包 manifest、第三方通知/清单及最终报告；暂存区也导出为独立文本快照，Gitleaks 8.30.1 默认规则扫描工作树、index 与 `--all --reflog --full-history` 提交集合。补充扫描可达及 reflog 对象、commit 元数据和本輪生成配置/浏览器 cookie 的精确秘密重叠。未使用新增 ignore、inline allow 或秘密基线。最终提交后再复扫相同范围并保存准确 HEAD 回执。

构造账户格式、示例标识、版本号与回环/文档地址每次命中均有对象、路径、行号、规则和上下文判断，完整脱敏记录在忽略的本地证据中；不输出匹配原值。没有未解决真实秘密或私人数据。旧本地发行根候选留在 reflog，额外扫描通过；它不是原 XichuRisk 历史，不被 main 推送。原项目 HEAD/状态只读核查未变。当前工作树、暂存区、最终提交及全部可达历史 PASS；公开附件尚未生成。
