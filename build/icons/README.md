# SmartDD 应用图标

采用用户选定的初版：暖橙底板、可爱红色蚂蚁举杠铃。

- 设计原图：`docs/design/app-icon/smartdd-ant-lift-v1.png`。
- 应用内及开发模式图标：`src/assets/branding/app-icon.png`（1024 × 1024，保留透明度）。
- macOS 安装应用：`build/icons/icon.icns`，包含 16–1024 像素及 Retina 规格。
- Windows 应用和安装程序：`build/icons/icon.ico`，包含 16、24、32、48、64、128、256 像素。
- Linux 桌面与安装包：`build/icons/png/`，包含 16–512 像素。
- 通用 PNG：`build/icons/icon.png`。

在 macOS 执行 `node scripts/generate-app-icons.mjs` 可从选定原图重新导出。该脚本仅做缩放和格式封装，不改变图案，不依赖在线图片服务；生成结果纳入仓库，其他平台直接使用。

最后的白底深灰极简方案保留为备选：`docs/design/app-icon/smartdd-ant-minimal-v1.png`，未用于当前应用。

已启动的构建或已安装的旧包不会自动更新图标；需要以这些配置重新打包并安装。按用户要求，本次图标改动纳入 `v0.0.3`，与 MSI/Linux 扩展一并构建、验证和发布。
