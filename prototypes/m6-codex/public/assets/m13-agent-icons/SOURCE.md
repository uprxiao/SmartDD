# M13 智能体与供应商图标来源（原型 P0.12）

获取时间：2026-11-11T04:47Z。原型与生产引用同一资源来源；商标归各自权利人所有，仅用于标识对应 Code Agent／供应商，不暗示背书。

| 文件 | 用途 | 来源 | 处理 | SHA256（本目录文件） |
| --- | --- | --- | --- | --- |
| `claude.png` | Claude Code 工具、订阅/API 智能体 | 本机 `/Applications/Claude.app/Contents/Resources/electron.icns`（Claude 3.6556.2，Anthropic 官方 App，icns SHA256 `7d0ffbc2…cc27`） | `sips` 转 PNG（1024²，SHA256 `8d8d51ac…3d49`）后缩到 256² | `c29fb64e11a824ad180813b392de4da890b704ae545a11fb7eece7b6e62850fc` |
| `anthropic.png` | Anthropic 官方供应商 | <https://www.anthropic.com/images/icons/apple-touch-icon.png>（官网 `<link rel="apple-touch-icon">`） | 未修改，180² | `40e3900fcb3ad237af6869dbd40e77efc8eb23549c478125b40e563ac74423cb` |
| `openai.svg` | OpenAI 官方供应商 | <https://developers.openai.com/codex> 页头 OpenAI 标志的内联 SVG（原始抽取 SHA256 `468ebe03…ae90`） | 去掉 class，宽高改为 411，`currentColor` 改为 `#000` | `0f0b712ba0e80ac8023c40c2a0ef8807c1ff8bc069d7d170e193df3382f92989` |
| `openai-white.svg` | 历史临时 Codex 回退（当前不再使用） | 同上 | 同上，填充改为 `#fff` | `6a831a6dabed97cf585dec92d708cec15134cb8146a653367876e3e86133d8cc` |
| `codex.svg` | Codex 工具及其智能体 | [官方 Codex 页面](https://chatgpt.com/codex/) 直接引用的 [官方 sprite](https://chatgpt.com/cdn/assets/sprites-shell-41232287.svg) 中 `codex` symbol；2026-11-13复核 | 仅将symbol容器改为独立SVG，20×20路径／填充规则未改；白底容器留空隙；官方单色界面符号，不冒充彩色macOS App图标 | `e20cb416aca6ba02f03a50e0af49951a09456ec266d77e1ea289cfc6583f754d` |
| `deepseek.png` | DeepSeek | <https://www.deepseek.com/favicon.ico>（官网 `<link rel="icon">`，SHA256 `30a4420e…1321`） | `sips` 转 PNG，225² | `d1e6058d19b04817a623dc6e3a99405c70defaf412e9296edf7dbe2032ff7cbe` |
| `zhipu.png` | GLM（智谱） | <https://open.bigmodel.cn/static/images/favicon.png>（智谱开放平台 `<link rel="icon">`） | 未修改，90² | `94ff9c00af67774e5178428942a6e0a9952c7e2f3aba4c25f3b05c782841ee4c` |
| `magpie.png` | Magpie | 本机 `/Applications/magpie.app/Contents/Resources/magpie.icns`（Magpie 0.1.2823，icns SHA256 `d4cc207f…2545`） | `sips` 转 PNG（1024²，SHA256 `48066664…4c2b`）后缩到 256² | `fc5399bed33358752680c261db7fa99aa248029afca2947c27d595c3b72cad50` |
| `opencode.png` | OpenCode（Code Agent，暂不支持） | <https://opencode.ai/apple-touch-icon-v3.png>（官网 `<link rel="apple-touch-icon">`；本机 `opencode-ai` 1.18.15），2026-11-11T06:12Z | 未修改，180² | `2f2d5687a641f7fc1c3931072249a5984660375c091064fe8b374e4e43a8656c` |
| `pi.svg` | Pi（Code Agent，暂不支持） | <https://pi.dev/logo-auto.svg>（本机 `@earendil-works/pi-coding-agent` 0.85.1 的 README 引用的官方 Logo），2026-11-11T06:12Z | 未修改 | `abd66e7868b2d24f0f0895f9237ee8a6dcb22337583b0dc54aeb595acecb4d6b` |
| `zcode.png` | Z Code（Code Agent，暂不支持） | 本机 `/Applications/Z Code.app/Contents/Resources/icon.icns`（Z Code 0.11.1，`ai.z.zcode`，icns SHA256 `d3f0455f…3418`） | `sips` 转 PNG（1024²，SHA256 `34059bfb…8aa`）后缩到 256² | `57912b0a4820adf38c80ab7bb244c10d3034a18f087f11c5394823968b9e1353` |
| `dsh.png` | DSH（DeepSeek Harness，Code Agent，暂不支持） | 本机 `/Applications/DeepSeek Harness.app/Contents/Resources/icon.icns`（0.2.2-rc.1，`com.deepseek.dsh`，icns SHA256 `8d84ca64…82f2`） | `sips` 转 PNG（1024²，SHA256 `b8170a7b…ce9`）后缩到 256² | `750a8d563b2ce3e318007630dcfa47dd6da88e531c3fb4824f68117d9fc71f4a` |

## 差异与待办

- **Codex 专用图标已替换（2026-11-13）**：使用上表官方公开专用符号，与OpenAI供应商标志区分。保留原临时回退文件及历史来源，不再以“本机没有Codex.app”为当前事实。遵守[OpenAI品牌指南](https://openai.com/brand/)；网页图标没有单独的宽松许可声明，不将官方仓库Apache-2源码许可套用于商标。
- **SMG**：用户 2026-11-11 提供了网关地址，没有官方图标，仍用首字母方块。**UltraCloud**：地址、协议和图标都待用户提供，仍是占位。
- 自定义供应商使用名称首字母方块。
