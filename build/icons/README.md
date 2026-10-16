# WillYou 应用图标

当前采用用户于 2026-10-16 定稿的 **青玉绿底、白色举重蚂蚁、没有眼睛**。应用显示名称统一为 WillYou；现有数据目录与技术标识保持兼容。

## 统一源与各端资源

- 当前选择：`selection.json` 中的 `artwork: jade-teal`。
- 唯一导出源：`variants/WillYou-jade-teal.png`（1024 × 1024，透明外缘）。
- 原始生成稿及编辑提示词：`../../docs/design/app-icon/willyu-color-studies/02-jade-teal.png`；配色提示词见该目录 `README.md`。
- 应用内、窗口、开发模式 Dock、页面 favicon：`../../src/assets/branding/app-icon.png`。
- 浏览器原型、关于页及 favicon：`../../prototypes/m6-codex/public/assets/app-icon.png`。
- macOS：`icon.icns`，16–1024 像素，包含 Retina 规格；arm64 / x64 共用。
- Windows：`icon.ico`，16、24、32、48、64、128、256 像素；NSIS EXE / MSI 共用。
- Linux：`png/`，16、32、48、64、128、256、512 像素；AppImage / DEB / RPM 共用。
- 通用 PNG：`icon.png`，与唯一导出源逐字节相同。

当前仓库没有独立的手机端或服务端 UI 工程，后续客户端应从此统一源导出，不复制历史探索稿。打包配置继续引用上述稳定路径，CI 无需在线生成图片或执行 macOS 导出命令。

## 重新导出

在项目根目录、macOS 上执行：

```sh
# 沿用当前 selection.json，并同步应用、原型和三平台打包资源
node scripts/generate-app-icons.mjs

# 显式选择当前定稿
node scripts/generate-app-icons.mjs --artwork jade-teal
```

脚本只做缩放与原生格式封装，不重新生成或绘制图案。生成资源须一并纳入仓库。

## 保留的历史备选

原 06 线描图案的 70%、75%、80% PNG / ICNS 仍放在 `variants/SmartDD-06-*`，没有覆盖；其他探索稿保存在 `../../docs/design/app-icon/`。

仅在明确需要切回旧版时执行 `node scripts/generate-app-icons.mjs --proportion 70`（或 75 / 80），此命令会修改当前选择和全部活动资源。无参数导出不会自动回到旧图。

更换源码图标后需重新构建、打包并安装，已安装的旧应用不会自动更新。本轮不触发正式发版。

带眼睛的探索稿仍保留；它不是当前 Logo。历史 70% / 75% / 80% 是旧线描版的比例选择，不套用于当前青玉绿版。
