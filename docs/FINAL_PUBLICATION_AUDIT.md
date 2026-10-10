# GitHub Public Push 前最终验收

2026-10-10（Asia/Shanghai）。结论：**当前 Windows 本地源码候选 READY_FOR_APPROVAL，公开 Push PENDING_APPROVAL**。本轮只完成许可证、权属/隐私复审、必要回归和本地普通提交，停在维护者单独批准 Push 的边界。

## 实际版本与修改范围

开工 HEAD 和保留的独立根提交：`c955d79117eeb1182d04a1b7dd01345496a6f017`，main，工作区干净，唯一 origin 为 `https://github.com/xichugeek/XichuQuant.git`。本轮普通中文提交“发布准备：采用 MIT 许可证并完成开源授权复审”以此为唯一父提交。最终实际 HEAD/本轮提交 SHA 以本报告所属提交、`git rev-parse HEAD`、`python scripts/release-verify.py` 和本地最终回执为准；不写不可能包含自身的提交 SHA。最终共有 2 个 main 提交、1 个无父根。

本轮文件清单：

- `CHANGELOG.md`
- `LICENSE`
- `README.md`
- `SECURITY.md`
- `apps/api/package.json`
- `apps/broker-connector/package.json`
- `apps/quant-engine/package.json`
- `apps/web/package.json`
- `docs/FINAL_PUBLICATION_AUDIT.md`
- `docs/OPEN_SOURCE_LICENSE_REVIEW.md`
- `docs/PRIVACY_AUDIT_REPORT.md`
- `docs/REGRESSION_EVIDENCE.json`
- `docs/REGRESSION_REPORT.md`
- `docs/RELEASE_MIGRATION_REPORT.md`
- `docs/RELEASE_READINESS_REPORT.md`
- `docs/SOURCE_COPY_MANIFEST.json`
- `docs/SOURCE_COPY_MANIFEST.md`
- `docs/THIRD_PARTY_INVENTORY.json`
- `docs/THIRD_PARTY_NOTICES.md`
- `docs/licenses/backtesting-engine-MIT.txt`
- `package.json`
- `packages/shared/package.json`
- `packages/validators/package.json`
- `scripts/release-verify.py`

只有 7 个原创 package.json 的 license 字段、根 MIT、第三方适配许可、文档/机器清单和只读发行校验发生变化。子包新增许可保留原换行；原依赖、版本与锁文件未更新。业务代码、安装/交易安全配置、数据库 Schema、全部 19 migrations 和测试代码未改。

## 许可证与第三方

根 LICENSE 为完整 MIT 标准授权、通知保留和免责正文，UTF-8 无 BOM，无异常控制字符；`Copyright (c) 2026 XichuGeek`。7 个原创包均 MIT，README/CHANGELOG/SECURITY/许可报告一致。MIT 仅覆盖维护者有权授权部分；上游与独立依赖不被重署版权。

本轮实际重建 656 Node 包名 / 701 实例 / 39 Python distributions；Node production 240、仅开发 416；Python runtime 23、开发/安装 16。原许可和注意事项见 [通知](THIRD_PARTY_NOTICES.md)。已核对时间序列动量上游并补完整 MIT，核对 TradingView 缺失 NOTICE 并从匹配版本补录，保留 ECharts、Lucide/Feather 原归属。MPL、LGPL、CC-BY、NumPy wheel 的 GCC runtime GPL 例外和 22 个无独立许可文件包均单独披露。当前 Git 源码不包含这些依赖包体或构建产物，未解决实质性源码权属项为 0。

未来二进制包/镜像/网站需要实际产物清单、原版权/许可/NOTICE、必要对应源码与图表归属显示；SQL Server、Node/Python 系统组件、IBKR 客户端/行情条件独立。当前 PASS 不替代该未来审查。

## 隐私与 Git 独立性

公开树 427 个文件全部文本：414 个保留源文件、365 原样、49 审阅变更、13 新增发行文件；源排除 36。仅同步真实目标变更 SHA，源 Git blob/archive SHA 不改；增强为所有新增报告实际哈希，唯一自引用 manifest 自身由 Git 与完整跟踪集合检查保护，没有关闭完整性检查。

Gitleaks 8.30.1 重扫工作树、新增文件、index 快照、全部可达历史含 reflog；自定义检查对象/commit、IBKR 格式、凭据、JWT/私钥、路径、IP、旧事故组合及新配置/Session 精确重叠。0 未解决秘密；所有格式误报逐项脱敏记录。实际 `.env`、私有证据/日志/storageState、图片、数据库、备份、缓存、依赖和 `.git` 辅助资料均未跟踪。完整范围见 [隐私报告](PRIVACY_AUDIT_REPORT.md)。

检查全部 refs：main commit 与一个 Codex 自动 capture tree；该 tree 与已审计根提交的 tree OID 完全一致，保留并记录，未删除或改写。发行脚本仅接受已审计 main 树对应的这种精确 ref 类型/路径，未知 ref、额外 commit 或不匹配树全部拒绝。无 tag、其他 remote、alternates、继承源提交或旧历史；新旧仓库全部可达 commit SHA 集合无交集，原 HEAD 对象在新仓库不存在。reflog 中有前轮本地发行根候选，额外扫描通过，不是旧源历史，也不是 main 推送内容。

原 XichuRisk 只读 HEAD 仍为 `37f5e4e750abd515f5bce0c92b1493be815628e0`，工作区干净；未载入其私有环境，未访问业务库或下单。本轮未执行 reset、clean、force、rebase 或 filter-repo。

## 实际重跑与明确复用

本轮新执行 **250 项**：API 183、Connector 20、Python 47，全部通过；lint、typecheck、生产 build、Prisma Validate/Generate 均通过。现有 Python 弃用警告保留。`git diff --check`、许可/元数据/README/通知、锁文件不变和清单核验通过，提交后再次复核。

复用原根候选证据，**未重跑**：SQL B/C 4+3、生产桌面/手机 Playwright 300、Windows 18 步安装、生产 Session/CSRF/只读门禁、合成回测、内部 Paper Fill/幂等、备份/RestoreTest/CHECKDB/19 migrations 与表摘要。原 557 不是本轮新执行总数。真实日志 SHA 与轮次见 [机器回归证据](REGRESSION_EVIDENCE.json)。本轮未改运行配置/依赖/业务，无需再次操作数据库或客户端。

## 能力边界与远端

推荐用户 Windows 本地部署。IBKR 官方 Gateway/TWS 由用户自行安装登录/MFA，应用不采集券商密码/MFA；Live 始终只读。内部 Paper 的模拟验证复用；外部 IBKR Paper 全生命周期未认证、NOT_RUN。Docker Engine 不可用，Linux 实际 build/up/恢复/网络认证 NOT_RUN；官网 Demo NOT_DEPLOYED，Episode 007 NOT_STARTED。合成结果不是历史盈利，不宣称 72h 或保证收益。

只读 GitHub API 核对仓库 owner `xichugeek`、name `XichuQuant`、visibility `public`、default branch `main`；`git ls-remote origin` 返回空 refs，origin/main 尚无提交。API 的创建时 pushed_at 字段不是已存在提交的证据，以空 refs 实查为准。没有上传文件、Push、Tag、Release、网站部署或外部订单。正式 Push 之前仍必须重新只读核对远端，出现用户内容即停止。

当前没有未解决源码工程阻断项，可以申请维护者批准公开源码 Push。**本次不包含 Push 授权，须等待明确批准后才能操作。** Tag、Release、镜像、官网和视频均另待批准。

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
