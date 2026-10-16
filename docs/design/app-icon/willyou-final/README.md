# WillYou 品牌定稿与接入记录

2026-10-16 用户最终确认：appName 为 **WillYou**（W / Y 大写），Logo 为**没有眼睛的青玉绿举重蚂蚁**。

## 资源与名称

- 原稿：`../willyu-color-studies/02-jade-teal.png`。目录中的 Willyu 为探索阶段名称。
- 统一导出源：`../../../../build/icons/variants/WillYou-jade-teal.png`，1024 × 1024；当前选择为 `jade-teal`。
- 执行 `node scripts/generate-app-icons.mjs` 同步 UI、原型、favicon、Mac ICNS、Windows 七档 ICO、Linux 七档 PNG。旧 06 比例及带眼睛稿保留备选。
- 首页 64px（低窗口 48px）、左下角 32px，contain 显示避免圆形裁切。
- 名称同步：原生应用、窗口、菜单、通知、中英文 UI、原型、Skill 说明、打包产品名、可执行文件、七种安装包名称、Actions 资产匹配、发布标题与验收路径。
- `com.smartdd.desktop`、原 `SmartDD` 数据目录、`smartdd.db`、配置／环境变量、Skill/MCP 标识和受管文件 owner 保留兼容。启动显式沿用原数据根目录，QA 覆盖仍生效。仓库地址与历史发布记录不重写。
- 当前仓库没有独立 mobile/server UI 工程，后续客户端复用统一源。

## 验证结果

- `pnpm typecheck` 通过。
- `pnpm test`：358 通过、2 跳过（37 文件通过、1 文件跳过），包含数据目录兼容检查。
- `pnpm test:release`：14/14，包含四个平台架构组合的打包路径、七种安装包及 Actions 上传／下载匹配。
- 原型 `npm run build`、`npm run test:sites`（4/4）通过。
- `node scripts/release/build.mjs --dir --output-dir /Users/liubu/.codex/tmp/willyou-brand-verification`：Mac arm64 编译、打包、SQLite / PTY / 语音桥检查通过；产物为 `mac-arm64/WillYou.app`。
- Mac Info.plist 的 Name / DisplayName / Executable 均为 WillYou；bundle ID 仍为 com.smartdd.desktop；包内 ICNS 与仓库资源逐字节相同。
- 源 PNG、UI、原型、编译后 main / renderer 图片哈希一致；Windows ICO 七档及 Linux 七档尺寸、对应 PNG 数据一致，见 [资源核对](evidence/asset-verification.json)。
- 浏览器目视检查：[浅色首页](evidence/prototype-home-light.png)、[深色首页](evidence/prototype-home-dark.png)、[浅色关于页](evidence/prototype-about-light.png)；Logo 加载正常、名称正确。

本次留在开发分支，未发版、未覆盖正在运行的安装应用。Windows / Linux 已同步资源与构建路径，未在本机生成或安装验收相应系统安装包。页面目视检查为浏览器原型，不代替已安装应用真实页面验收。

## 提交前复核（2026-10-16）

- 修复改名的存储兼容问题：Electron 内部应用名仍为 `SmartDD`，显示名称与原生菜单使用 `WillYou`。仅固定数据目录不足以保持 safeStorage 身份；Electron 在 macOS 使用内部应用名派生钥匙串服务名，Linux 同样以该名称配置安全存储，参见 [Electron 上游说明](https://github.com/electron/electron/issues/40430)。启动统一通过 `configureAppIdentity` 保持原身份及 QA 数据目录覆盖，增加两项回归测试。
- 本轮 `pnpm typecheck` 通过；`pnpm test` 为 360 通过、2 个默认不启动的 CLI 探针跳过，随后 `pnpm probe:m4:cli` 单独执行这两项并通过。CLI 探针使用临时 HOME 和本地模拟端点，不代表真实模型或语音端到端验收。`pnpm test:release` 为 14/14；原型构建通过。
- 修复后重新执行 `node scripts/release/build.mjs --dir --output-dir /private/tmp/willyou-precommit-review`：Mac arm64 编译、打包、SQLite / PTY / 语音桥和严格签名校验通过。产物为 `/private/tmp/willyou-precommit-review/mac-arm64/WillYou.app`，`app.asar` SHA256 为 `262ca1f59c4836d117668b531b470b866dd267f317fc96ac216730aec8a31965`。
- 包的名称、显示名、可执行文件均为 WillYou，bundle ID 仍为 `com.smartdd.desktop`；ICNS 与仓库资源相同。源图、应用 UI、原型及通用 PNG 哈希一致，Windows ICO 七档与 Linux PNG 七档尺寸核对通过。
- 未读取或迁移用户已有密钥，没有覆盖 `/Applications` 中的应用；真实安装升级后的凭据读取与系统授权仍须单独验收。M7 跨应用和各 CLI 的完整语音验收继续以 [M7 实施记录](../../../M7_实施与验收记录.md) 为准，本次提交不表示这些剩余用例已通过。
