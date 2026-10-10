# 第三方依赖与分发说明（审查清单）

2026-10-10，依据新 XichuQuant 项目的本地 frozen-lockfile 安装和 quant-engine 3.12 虚拟环境的元数据生成。清点 656 个 Node 包名、39 个 Python distribution，版本与许可证元数据见 [完整机器清单](THIRD_PARTY_INVENTORY.json)。该清单没有个人目录、凭据或账户信息。

Node 元数据分组：MIT 554；Apache-2.0 37；Apache-2.0 AND LGPL-3.0-or-later 1；BSD-3-Clause 11；ISC 27；Python-2.0 1；MPL-2.0 3；CC-BY-4.0 1；BSD-2-Clause 12；Unlicense 2；BlueOak-1.0.0 5；CC0-1.0 1；0BSD 1。一个包名可包含多个安装版本，数量不是许可证法律批准数量。

需单独核对：`@img/sharp-win32-x64` 的组合许可；`axe-core`、`lightningcss`、`lightningcss-win32-x64-msvc` 的 MPL；`caniuse-lite` 的 CC-BY。参考 [Mozilla MPL 正文](https://www.mozilla.org/en-US/MPL/2.0/)；其他要求应按清单对应包的实际 LICENSE/NOTICE 和官方分发说明审查。

Python 的 License-Expression/License/classifiers 可能缺失、过时或是多行说明。`UNKNOWN` / `SEE_INSTALLED_LICENSE_FILES` 是需阅读原文件的提示，不能改成“允许自由分发”。标准库、pip vendor 和镜像系统组件不由这份 distribution 清单完整覆盖。

这份文档不是完整法律 NOTICE 包，不重新许可依赖，也不替代发布包保留依赖原版权文本的义务。目标 Linux 容器内实际依赖、native binary、系统包、镜像许可证和源代码提供要求尚 NOT_RUN；发布前须补审查。生成方式：先将 `pnpm licenses list --json` 输出到私有文件，再在实际 Python 虚拟环境运行 `scripts/license-inventory.py --node <private-file> --output docs/THIRD_PARTY_INVENTORY.json`。

本轮已读实际安装包中的 LICENSE/NOTICE：@stoqey/ib@1.6.9、@img/sharp-win32-x64@0.34.5、axe-core@4.12.1、lightningcss@1.32.0、lightningcss-win32-x64-msvc@1.32.0、caniuse-lite@1.0.30001805；审查原文及 SHA-256 保存在本地私有证据中。没有把其第三方作者联系方式或完整依赖树复制到源码分发中。组件原许可与可能适用的源代码/归属要求在二进制/镜像发布时仍须满足，参见 [原创许可建议与待确认权属](OPEN_SOURCE_LICENSE_REVIEW.md)。
