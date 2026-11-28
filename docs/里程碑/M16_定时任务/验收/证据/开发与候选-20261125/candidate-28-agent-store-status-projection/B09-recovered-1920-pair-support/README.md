# M16 B09.2 真实 1920 外屏旧版/C28 对照（恢复执行）

复用已归档 C19 的两包真实浏览器 UI 夹具、页面、输入、找词及任务/浏览器面板操作。只覆盖七个已存在的 M12-T145 原状态。所有具体原键与 S1 原 456 键逐项核对；`preflight.json` 固定28个计划点（七态 × 浅/深 × 480/900）与56条两包取证行。

## 协调者执行命令

先在同一工作目录释放其他共享桌面的实际测试窗口、原本机夹具服务端口，再执行。旧参考为精确私有复制包，C28 为精确新构建。

```sh
node release/m16-qa-support/b09-recovery/preflight.mjs
node release/m16-qa-support/b09-recovery/driver.mjs --coordinator-authorized-b09-native-fullscreen-pair \
  /Users/liubu/hx/4.uprxiao/SmartDD/release/m16-qa-support/old-reference/WillYou.app \
  697bb2d273a743c22a2d2c2ebc3c509b0fcee3f9c4bbeeb34146c590b2d9afe2 \
  3ea4c07164ebd92391822629e00f4efa4a07a97f33088ef53b3c9b6b532c6040 \
  /Users/liubu/hx/4.uprxiao/SmartDD/release/m16-qa-support/c28/build/mac-arm64/WillYou.app \
  5d715b34f16a31a1edf95692501b58e19e70048bc0f131f4bb33ac1bbcb3ba9e \
  5958e696d973ee8e304333442dc4c55d58402f22a8714af164c6b182fb3d3080 \
  e07fbff84183650e8b3482d8c2499038787c9fd7aea691180cbf86e84fb3aea5
```

首条 stdout JSON 给出 `root`。该目录中 `progress.json` 是当前交接，`B09-matrix-1920-result.json` 持续记录真实动作、捕获原图及组合。旧和新包各一个 fresh HOME、CLI HOME、userData，正常退出旧包后才自动启动新包。仅本机合成 HTML 和 keyless provider 探针，不访问真实邮件、网站、账号、系统安全许可、证书或浏览器资料。未更改 production。

## 本人操作两次

每轮 synthetic fixture 和正常网页准备好后，等待 `await-user-real-fullscreen` 交接。先辨认 PID/程序/测试窗标题。

1. 旧版 `WillYou · M16 B09 1920 旧版 <本轮尾号>`，将这个窗口拖到 1920×1080 外屏，点绿色系统全屏按钮；全屏完成后保留前台约 1 秒，直到 `user-real-fullscreen-observed`。之后无需逐态操作，维持该窗口真实全屏即可。
2. 新版 `WillYou · M16 B09 1920 C28 <本轮尾号>`，同样操作，优先同一外屏。前台确认后保留全屏，后续真实 CDP 页面交互由驱动完成。

`progress.json` 给出本轮准确外屏位置/显示器和窗口标题。全屏前置等待360秒。系统全屏没有成立时退出本轮旧包、停止下一包，不会以普通1920×1050工作区或软件设尺寸冒充全屏。各次截图前后核实际原 root/WC、系统 `isFullScreen()`、显示器1920×1080 DPR1、内容区1920×1080、真实渲染尺寸、zoom1及实际PNG头1920×1080。没有 `setFullScreen`、`setBounds`、`Page.bringToFront`、Emulation 或系统自动输入。

## 七个原状态与独立审阅

| 原键 | 原真实捕获 |
|---|---|
| B01-tabs-entry、B02-toolbar-ready | 两真实 tab、选中长页、实际浏览器工具栏、真实 native 页面及布局 |
| B01-long-title-url | 短页选中，超长标题完整并真实 ellipsis 的非选中 tab |
| B03-address-edit | 超长实际URL真实输入编辑焦点、Home/End caret 和最后可见地址，附 native 实图 |
| B08-find-matches | 真实本机页 `synthetic` 一处查询，真实1/1显示与页面高亮 |
| B08-find-zero | 真实本机页 `M16_NOT_PRESENT_947`，真实无结果 |
| R01-11-launcher-recent | 独立真实Agent任务里的空URL launcher，存在曾访问的短页推荐 |

默认优先核心七态。需要额外原 tab-hover 观察时可在命令末尾加 `--hover`，按现有真实持续 hover 取证，旧版已知 tooltip 缺失区别保留，额外记录不自动增加核心28点。所有其它 1920 原键与 B09.1/.5 系统专项继续保留缺项。

完成 App 批次后，以 stdout 的私有 root 执行 `python3 release/m16-qa-support/b09-recovery/review.py <root>`。它校验原图 SHA、配对原键、几何差异、native RGB差异、裁图并生成四个浅深宽窄 review board。若真实 native 画布与其观测 rect 严格对应，派生审阅图可将实际 native PNG贴入真实 shell PNG的位置，且标明派生；保留两张原图，不作为 OS compositor截图。图片原始文件与实际证据在私有 root，待协调者逐态肉眼对照及正式归账。预检不计通过。
