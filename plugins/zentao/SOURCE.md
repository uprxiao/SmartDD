# 禅道外部插件来源

首批插件代码由本仓库已评审的 M10 客户端、本人范围与来源修订契约迁出。原 `src/main/core/applications/providers/zentao.ts` 保留重导出，仅供升级失败时的旧内置兼容；没有复制禅道 PHP 实现。通用 HTTP／摘要及共享类型在构建时打入独立运行文件，运行时不导入 WillYou 源码。

声明式页面起点为 M13 A5 禅道声明，生产包在 `package/` 单独维护；历史实验原件不修改。生产 Schema 明确完整对象引用、资源修订和可续读的分块结果，不能把 A5 的宽松示例当成生产接口。

`package/assets/zentao.png` 为用户已确认的禅道公开 Logo，来自[官方分享页](https://www.chandao.net/book/saas/logo-24.mhtml)，SHA256 `a10848a05f0f6b25a5c3bac9ded03a773256e7420e9b9b1637d1accc12178192`，原图未修改。商标归原权利人；取得记录见共享原型的 `public/assets/m13-plugin-icons/SOURCE.md`。

运行包包括 Zod，其完整许可随 `runtime/main.mjs` 构建横幅保留。此目录是源码与静态资产，`scripts/plugins/build-zentao.mjs` 生成可安装的完整 payload；不包含原生模块。安装时仍受通用包校验、沙箱、生命周期及项目授权约束，不能因随源码提供就绕过运行隔离。

2026-11-12 旧契约兼容：`package/schemas/legacy-v2/` 六份 Schema 按已保留的 0.1.3 App 内禅道 1.1.0 原字节迁入，来源包哈希 `4f98bcc31608ee22231cfcbe3fd23b95ffa99890423ccffb6018cff16d6f8f9a`。分别绑定实际旧 `work_list_v2`、`object_get_v2`、`resource_v2`，保留旧输入与完整 `willyou-app-result-v2` 输出校验；资源分块按原字段投影。宿主签发来源／操作身份，插件不提供这些权威字段。现代插件原始数据接口及 v1 别名保留。来源哈希和修复验证见 M13 验收 `P1-legacy-v2-compat-20261112-a1`；这不表示历史 App 恢复整条已通过。
