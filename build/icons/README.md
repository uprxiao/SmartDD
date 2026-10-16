# SmartDD 应用图标

当前采用用户于 2026-10-16 选定的 **06 圆润极简、70% 占比**：白底深灰圆角线描，小蚂蚁举起大杠铃。

- 当前选项：`build/icons/selection.json`，目前为 `70`。
- 选定源图：`build/icons/variants/SmartDD-06-70.png`。
- 应用内及开发模式图标：`src/assets/branding/app-icon.png`（1024 × 1024，与选定源图一致）。
- macOS 安装应用：`build/icons/icon.icns`，包含 16–1024 像素及 Retina 规格。
- Windows 应用和安装程序：`build/icons/icon.ico`，包含 16、24、32、48、64、128、256 像素。
- Linux 桌面与安装包：`build/icons/png/`，包含 16–512 像素。
- 通用 PNG：`build/icons/icon.png`。

## 三个比例放在同一目录

| 比例 | PNG 源图 | 可直接替换的 Mac 图标 |
| --- | --- | --- |
| 70%（当前） | `build/icons/variants/SmartDD-06-70.png` | `build/icons/variants/SmartDD-06-70.icns` |
| 75%（备选） | `build/icons/variants/SmartDD-06-75.png` | `build/icons/variants/SmartDD-06-75.icns` |
| 80%（备选） | `build/icons/variants/SmartDD-06-80.png` | `build/icons/variants/SmartDD-06-80.icns` |

占比是图形横向宽度与画布宽度的比例；三个版本的造型和内部比例一致，仅整体大小与外部留白不同。旧的彩色方案及其他探索稿保存在 `docs/design/app-icon/`。

## 重新导出或切换

在项目根目录、macOS 上执行：

```sh
# 使用 selection.json 中保存的当前比例
node scripts/generate-app-icons.mjs

# 切换为 75%（也可指定 70 或 80）
node scripts/generate-app-icons.mjs --proportion 75
```

脚本会同步应用内 PNG、Mac ICNS、Windows ICO、Linux PNG 和 `selection.json`；不改动三个备选源文件。它仅做格式导出和缩放，不重新绘制图案，不依赖在线图片服务；导出结果纳入仓库，其他平台可直接构建。

更换后重新打包安装，系统应用图标才会生效。已启动的构建或已安装的旧包不会自动更新。本轮为开发分支内的图标替换，不触发发版。
