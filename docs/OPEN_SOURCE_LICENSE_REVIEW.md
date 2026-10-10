# 许可证选择与第三方审查

项目当前 `UNLICENSED`。根 LICENSE 是“尚未选择”的通知，不是 MIT/Apache 许可正文；公开源码不等同于授予开源许可。必须由具有授权权利的维护者决定，当前 `LICENSE_DECISION = PENDING_APPROVAL`。

## 候选比较

| 项目 | MIT | Apache-2.0 |
| --- | --- | --- |
| 主要特点 | 短、易使用；分发保留版权与许可通知 | 包含明确专利授权及相关终止条件，分发与 NOTICE 条件更详细 |
| 适用偏好 | 个人项目希望简单使用与二次开发 | 希望贡献和专利授权边界更明确 |
| 都不能代替 | 第三方许可、券商/市场数据授权、商标和用户资料处理 | 同左；不会自动重新许可整个依赖树 |

建议先评估 MIT 作为个人开源项目的简洁选择；若计划吸引企业贡献并明确专利授权，则评估 Apache-2.0。尚未批准任何一种。依据 [OSI MIT 正文](https://opensource.org/license/mit)、[Apache-2.0 正文](https://www.apache.org/licenses/LICENSE-2.0) 与 [GitHub 许可指南](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)。

## 实际调查与未完成事项

已清点项目原创源码目录、Docker/脚本/文档、工作区 manifest/锁文件与实际安装依赖元数据。清单见 [第三方说明](THIRD_PARTY_NOTICES.md) 和 [机器清单](THIRD_PARTY_INVENTORY.json)。包含 Windows 运行与开发依赖，不等同于所有目标 Linux 二进制均已审查。

发现 MIT/Apache/BSD/ISC 等，也有 MPL-2.0、Apache AND LGPL-3.0-or-later、CC-BY-4.0 等条目。不能仅看顶层 framework 的 MIT 就宣称整个 Docker 包可以统一 MIT。尤其 native sharp/libvips、CSS 组件、浏览器测试工具和数据表的版权/来源要求需核对实际分发文件。

SQL Server 镜像是另有许可的 Microsoft 产品，不能随原创代码重新许可；IBKR 客户端、API 使用和行情数据同样需要使用者核对官方条件。Node/Python 镜像所含系统库也需在真实构建后补清单。

代码中已有第三方研究/行情参考，不把链接引用视为获得再分发市场数据或全文的许可。本轮没有新增策略、复制外部策略源码或发布个人交易数据。完整原创权属、所有贡献者授权、历史复制来源和第三方 binary/NOTICE 文件的法律审查仍 BLOCKED；不能由 Git author 字段或 AI 生成经历推断权利已清楚。

## 人工决定后的执行计划

确认版权主体、贡献者权利与覆盖范围；保存第三方原通知与必要源码/分发信息；决定原创代码许可证；替换根 LICENSE 并一致更新 package.json/README；从最终 Linux 镜像生成实际 inventory 与 NOTICE 包；复核数据授权和隐私后再发布。不要顺手给旧 Tag 追加“已获许可”声明。

本阶段不声称法律审查完成，不自动选择许可证，不因增加 pending LICENSE 文件解除 Release 门禁。

## XichuQuant v1.0.0 本轮审查（2026-10-10）

清单已从新项目实际 frozen-lockfile 安装重建：656 个 Node 包名、39 个 Python distribution。检查了 @stoqey/ib、sharp Windows 包、axe-core、lightningcss 和 caniuse-lite 的实际 LICENSE/NOTICE 文本；私人审查记录只保存文件名和 SHA-256，原通知中的第三方作者联系方式不混作项目用户隐私。仓库没有随源码复制 node_modules、浏览器或 SQL 二进制；Docker 拉取/构建的完整分发仍待实际镜像审查。

原创源码建议 MIT（条件简洁、适合个人维护和广泛复用）；如维护者希望明确贡献专利授权，则选择 Apache-2.0。此为工程建议，不是已批准许可。参考 [MIT 正文](https://opensource.org/license/mit)、[Apache-2.0 正文](https://www.apache.org/licenses/LICENSE-2.0)、[Mozilla MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)、[sharp 安装说明](https://sharp.pixelplumbing.com/install/) 与 [SQL Server 容器官方说明](https://learn.microsoft.com/en-us/sql/linux/install-upgrade/quickstart-install-docker?view=sql-server-ver17)。

现有依赖中 MPL、CC-BY、LGPL/native 组合和 SQL Server EULA 不能被原创代码 MIT/Apache 重新许可。源码分发目前仅保留依赖 manifest/lock；未来发布包含依赖的 ZIP/镜像前，须保留原版权/许可/NOTICE，核对适用源代码获取要求及目标 Linux 原生组件。IBKR API 与市场数据使用条件独立审查。

需维护者确认：版权主体、所有贡献者授权、外部片段与研究资料的实际使用权，以及 MIT 或 Apache-2.0 的最终选择。Git 作者或 AI 编写经历不能证明这些权利。当前 LICENSE_DECISION=PENDING_APPROVAL；XICHUQUANT_LICENSE=READY_FOR_REVIEW 指建议与清单可审阅，正式授予仍 BLOCKED。
