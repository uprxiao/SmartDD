# M16-BE01／BE02：主宿主身份与冷隐藏合成页补充探针

2026-11-25。在已归档的 [BE00](../BE00_20261125/README.md) 基础上，补查从未显示的主窗口和 Electron 窗口身份 API。关联 [F36 R07–R10、R13–R14](../../../需求.md)、[实验计划](../../浏览器单窗口承载实验计划.md)及[技术方案](../../技术方案.md)。**本记录只覆盖 BE01/BE02 的 E 层局部探针，不代表两组实验、G1 或产品验收全部通过。**

## 1. 基线与方法

- `feature/0.1.7`，提交 `a0acddb3a2325c6bf732adaa7e954ce4d767a2c3`。生产路径与 BE00 的开发分支源码基线无差异。本机 macOS arm64、Electron 42.11.14、Chromium 148.0.7778.280；系统版本、依赖锁哈希和测试目录见 [metadata.json](metadata.json)。
- 两次独立启动 Electron，均仅创建一个 `show:false` 的 BaseWindow 和独立的合成 AppShell、网页 WebContentsView。网页位于壳后方，测试窗口自创建至销毁从未显示、未激活；只使用临时 HOME、userData、sessionData 和本地合成 HTML，不读取日常 App 或业务网页数据。
- 每次执行两个独立场景：先加载壳后创建页面；冷隐藏状态下暂停页面 view 的可见绘制再恢复。对固定合成按钮使用页级 CDP 输入（启用页面焦点模拟，不模拟原生系统焦点），以真实计数增加、页面尺寸、动态红色标记的截图像素和宿主身份判定。第二次仅增加窗口身份诊断，验证首次观察到的 API 现象，不替换第一次记录。

## 2. 实际结果

| 独立运行 | 场景 | 实际点击增量 | 当前截图像素 | 输入／截图耗时 ms |
| --- | --- | ---: | --- | --- |
| 1 | 冷隐藏，壳加载后新页 | +1 | 正确 | 8／36 |
| 1 | 冷隐藏、闲置后恢复绘制 | +1 | 正确 | 1／42 |
| 2 | 冷隐藏，壳加载后新页 | +1 | 正确 | 1／55 |
| 2 | 冷隐藏、闲置后恢复绘制 | +1 | 正确 | 1／43 |

四个合成场景均保持一个 BaseWindow、零 BrowserWindow（按对应 Electron 枚举 API）、壳与页的独立 WebContents、`[page,shell]` 层级、440×300 CSS 页面尺寸（截图 880×600 像素）。在两个闲置恢复场景中，隐藏 view 时计时器仍至少递增一次。运行内明确销毁页、壳和窗，最终窗口计数为 0；两次进程退出码均为 0。退出后按两个隔离试验路径筛选未发现残留 Electron 进程。本机单次时间样本不构成 SLA 或长期资源结论。

### 主宿主 API 的实测发现

| 查询 | 结果（第二次，两场景一致） | 设计影响 |
| --- | --- | --- |
| `BrowserWindow.fromWebContents(shellWC)` 和 `BrowserWindow.fromWebContents(pageWC)` | 均返回同一实际 BaseWindow 实例；`instanceof BrowserWindow` 为 false；没有 `webContents` 属性 | 窗口所有权与可信壳身份是两个不同判断，不能把所属窗口一致当作 UI IPC 授权；不能依赖静态 BrowserWindow 返回类型取其 `.webContents` |
| `BaseWindow.fromId(win.id)` | 返回实际宿主对象 | 窗口查询使用适用 BaseWindow 的 API，并明确持有壳内容引用 |
| `BrowserWindow.fromId(win.id)` | null | 不能沿用 BrowserWindow 枚举／查找作为主宿主的唯一来源 |
| 壳 `did-finish-load`、壳与内容区尺寸、交通灯位置 getter | 合成壳完成加载；内容区与壳尺寸均为 800×600；位置返回 (14,14) | 支持显式壳生命周期与几何适配的方向，后续仍需验证真实 renderer、preload、标题栏和原生交互 |

本机 Electron 类型声明还表明 `dialog.showOpenDialog`、`showSaveDialog`、`showMessageBox` 的窗口参数接受 BaseWindow；`ready-to-show` 是 BrowserWindow 的事件。以上为 API 签名核对，未打开实际系统对话框或验证产品 IPC。

## 3. 尚不能得出的结论

- BE01 仍需真实原 renderer/preload、可信来源校验、窗口菜单/快捷键、原生对话框、HTML/MCP 预览、关闭隐藏与恢复等最小候选验证。
- BE02 仍需复用真实页级执行通路，在同一候选做多任务、并发绘制持有与释放、后台运行、计时器/表单、隐藏/最小化和原 M12 时延门槛的完整验证；本记录的合成计时器只证明短时局部行为。
- 尚未做 Mission Control/Space/跨显示器实际观察、关闭重开事件红测、真实产品退化检查、持久 profile 兼容和 30 分钟资源试验。不能以 Electron 窗口计数代替系统层或用户所见结果。

## 4. 原始证据与复核

- [run1](run1)：第一次实际脚本、原始 JSONL 及两张截图；[run2](run2)：增加身份诊断后的实际独立复验脚本、JSONL 及两张截图。
- [verify.py](verify.py) 独立读取四张 PNG 和原始回执，核对散列、动态色块、真实点击、宿主及清场等局部判据；[summary.json](summary.json) 为实际输出。[MANIFEST.sha256](MANIFEST.sha256) 记录归档证据散列。

复核归档（从本目录执行，使用已安装 Pillow）：

```sh
shasum -a 256 -c MANIFEST.sha256
python3 verify.py
```

每次重新运行时使用新的 `/private/tmp/willyou-f36-review-*` 目录，把相应 `cold-host.cjs` 复制进去并预检 `node --check`；以该目录作为 `WY_F36_PROBE_ROOT`，使用新建隔离 HOME/userData 启动项目锁定版本 Electron。正常、失败与复验保留各自原始输出；禁止连接日常 App。生产候选的完整验证继续使用 M16 实验计划和验收账。
