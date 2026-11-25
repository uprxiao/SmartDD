# M16-BE00 单窗口视图组合合成页技术探针

- 执行日期：2026-11-25，约 10:42–10:45（Asia/Singapore）。
- 关联：[M16 F36 R07–R09](../../../需求.md)、[实验计划](../../浏览器单窗口承载实验计划.md)、[技术方案](../../技术方案.md)。
- 来源基线：实验时所在 feature/0.1.7-bugfix 50b8ea211e20e7e184a1cb942cc124dbd13495b3，与 feature/0.1.7 2e45d9eae725bd70aac60eef089f1a077f07b18a 的已提交 Git Tree 皆为 f68808df2c803640e312675791d6d53fdfaa67e0；未修改生产代码。
- 环境：macOS（darwin arm64）、Electron 42.11.14、Chromium 148.0.7778.280；探针枚举到 3 个显示器。运行在独立 HOME／userData／sessionData，只加载本地合成 HTML，未读写日常 WillYou 数据，也未访问真实业务站点。完成时进程退出码 0。
- 目的：比较显式单 BaseWindow 多原生 WebContentsView 与 WebView 透明/遮挡近似策略，确认在本机版本的输入和截图可行性。每个场景为一次基本探针，不是统计性能基准，也不是对实际 Orca／T3 Code 应用的测试。

## 实际结果

第二轮使用独立 AppShell 和页 view，并核验根层级。每个场景以合成按钮实际点击计数 +1 与截图中随点击变化的色块作判据，截图保留原始 PNG；比较像素分类而不是受色彩转换影响的绝对 RGB。

| 类别 | 场景 | 点击 | 截图 | 实际截图耗时（ms） |
| --- | --- | --- | --- | ---: |
| 单 BaseWindow 原生 view | 正常展示 | 生效 | 像素正确 | 24 |
| 同上 | 原生页面被壳覆盖，层级 page-A/shell | 生效 | 像素正确 | 16 |
| 同上 | 隐藏 view 后重新取得绘制 | 生效 | 像素正确 | 5 |
| 同上 | 第二独立页可见 | 生效 | 像素正确 | 7 |
| 同上 | A 页被另一个活动页遮挡 | 生效 | 像素正确 | 8 |
| 同上 | 整窗隐藏，A 页仍在层级后方 | 生效 | 像素正确 | 10 |
| 同上 | 重新显示整窗并将 A 页置前 | 生效 | 像素正确 | 9 |
| 同上 | 整窗最小化（A 页先被置前） | 生效 | 像素正确 | 19 |
| WebView 近似模型 | 可见 | 生效 | 像素正确 | 11 |
| 同上 | Orca 式 opacity:0 绘制持有 | 生效 | 3 秒有界等待超时，未取得截图 | — |
| 同上 | T3 式置于不透明壳后方 | 生效 | 3 秒有界等待超时，未取得截图 | — |
| 同上 | 先 display:none 再恢复透明绘制 | 生效 | 3 秒有界等待超时，未取得截图 | — |
| 同上 | 整窗隐藏（guest 原先可见） | 生效 | 像素正确 | 10 |

汇总：单窗口原生组合 8/8 点击与 8/8 截图正确；WebView 近似模型 5/5 点击生效、2/5 获得并核验正确截图。WebView 三项超时保留为技术失败，不写成“Orca／T3 产品必然失败”。截图耗时仅包含当次测量，输入时间包含脚本同步等待，不能外推生产延迟。

**初次探索及更正：** 首次 BrowserWindow 原生实验的 contentView.children 初始数量为 0，不能证明置于原有主 renderer 后方；原像素阈值以 CSS 灰色 168 直接比较，实际截图颜色存在转换，导致误报。因此首次输出保留但不用于最终通过计数。第二轮显式 BaseWindow 两层/三层，核对层级并用动态色块与原始 PNG 校验，解决该夹具判据缺口。初次沙箱启动无输出退出，使用获准的独立进程后完成试验；该现象不是产品失败。

**证据边界：** 不含完整 WillYou 界面、真实 agent-browser 生产命令链、冷启动整窗始终未显示、Mission Control/Space 系统验证、长跑资源、跨平台或真实业务登录。后续按 BE01–BE10 补齐；本探针不计入正式验收。

## 文件与复现方式

- [compare.cjs](compare.cjs)：第二轮独立探针归档副本，测试页由脚本生成。
- [comparison.jsonl](comparison.jsonl)：第二轮原始逐场景回执、层级、命中计数及截图 SHA256。
- [comparison-summary.json](comparison-summary.json)：执行后独立核验的实际汇总。
- [verify.py](verify.py)：依据实际核验方法整理的复现校验器；输出逐场景与汇总。
- comparison-*.png：第二轮十张本地合成页截图。无用户网页或凭据。
- [initial-trial.cjs](initial-trial.cjs)、[initial-results.jsonl](initial-results.jsonl)：首次探索，按上文局限处理，不计通过数。
- [MANIFEST.sha256](MANIFEST.sha256)：归档脚本、结果和截图校验。

归档格式说明：两个 CJS 脚本各仅移除原文件末尾一个空行，便于 Git 空白检查，代码正文无变化；补回一个 LF 即可恢复原始字节。原 compare.cjs SHA256：8fe4a9c516eaa13122a82012bdeae7ac8269b2e007e8e4b0cb833ac4c842c052；原 initial-trial.cjs SHA256：71f1965db8fa1d8855c4a31c4a2248184dc46871a992350452b264052fd66357。JSONL、汇总、截图均原字节保留。

运行前按实际依赖锁安装项目环境；从仓库根运行，使用本次新建独立目录，不连接日常应用。以下为 macOS 的复现路径；若系统沙箱要求批准，使用项目既有独立 App 测试授权流程，不绕过限制。

```sh
evidence_dir='docs/里程碑/M16_定时任务/技研/实验/BE00_20261125'
probe_dir="$(mktemp -d /private/tmp/willyou-render-architecture.XXXXXX)"
mkdir -p "$probe_dir/home"
cp "$evidence_dir/compare.cjs" "$probe_dir/compare.cjs"
node --check "$probe_dir/compare.cjs"
env WY_ARCH_PROBE_DIR="$probe_dir" HOME="$probe_dir/home" \
  node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
  "$probe_dir/compare.cjs" --user-data-dir="$probe_dir/data2"
python3 "$evidence_dir/verify.py" "$probe_dir"
```

归档完整性和原始结果复核（Python 使用 Pillow 读取已有 PNG）：

```sh
(cd 'docs/里程碑/M16_定时任务/技研/实验/BE00_20261125' && shasum -a 256 -c MANIFEST.sha256)
python3 'docs/里程碑/M16_定时任务/技研/实验/BE00_20261125/verify.py'
```

复验结果另存新目录，不覆盖原始证据。后续正式验证应记录当时项目分支、源码快照、实际 Electron 版本、系统及测试窗口、样包和端口身份。
