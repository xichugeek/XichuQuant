# XichuQuant v1.0.0 迁移交付报告

日期：2026-10-10（Asia/Shanghai）。执行 Q1–Q8 本地范围，停在人工公开 Push 审批前。

源 XichuRisk 实际 HEAD：`37f5e4e750abd515f5bce0c92b1493be815628e0`，分支 `codex/v1.11-open-source-release`，开工与收尾均工作区干净。原始代码、.env、IBKR 配置、私有历史/证据与业务库保持不变；未改旧仓库可见性或远端。

新 XichuQuant 的实际 HEAD 是本报告所属的独立 `main` 根提交；准确 SHA 由 `git rev-parse HEAD` / `python scripts/release-verify.py` 输出，并在最终交付回执中记录。文档不伪造包含自身 SHA 的自引用散列。新根提交没有父提交，唯一 origin 为 https://github.com/xichugeek/XichuQuant.git；未 Push/Tag/Release。

新旧对应：414 个允许源文件映射到新项目，371 个字节原样、43 个必要发行变更、36 个排除的历史文档。原跟踪文件 450；业务源码 296。新公开树的精确数量和逐文件 SHA 见 [源清单](SOURCE_COPY_MANIFEST.json)；本地安装产生的依赖/缓存/凭据不计入公开树。

功能完整保留，未大规模重构/新增策略/重设计前端。必要逻辑差异限于独立数据库安全前缀，附拒绝测试与实际数据库验证；展示品牌与虚构测试标识变更单列。Prisma schema、全部 Migration、内部路由与幂等键维持原样。

独立回归 **557 项通过**；Lint/Typecheck/Build、Prisma、19 migrations、Windows 安装/生产认证/回测/内部 Fill/备份与隔离恢复通过，详见 [回归报告](REGRESSION_REPORT.md)。Windows 为当前已有前置环境机器认证，非全新机器认证。

源码与全部新提交 Gitleaks+自定义+上下文审查通过，未继承旧历史，见 [隐私报告](PRIVACY_AUDIT_REPORT.md)。正式 Release/媒体尚未生成，未来产物仍需审查。

MIT 为建议，Apache-2.0 为候选，仍 UNLICENSED；完整原创权属、贡献者授权和依赖实际分发义务等待维护者确认。许可证状态 READY_FOR_REVIEW 只表示方案可审阅，不能宣称许可生效。656 Node / 39 Python 依赖清单已重建，Linux 二进制清单待实测。

Docker **NOT_RUN**（Engine 不可用）；外部 Paper **NOT_RUN / 未认证**（无订单授权）；官网/DNS/视频制作未执行。源码可进入许可与工程交付人工审阅，**暂不能无条件放行最终公开 Push**：先批准并落实有效许可证及权属，之后对确定的提交重扫并单独批准 Push。Docker 未实测需明确披露，不能发布已认证容器声明。

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
