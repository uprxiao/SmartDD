# 真实 App 自动验收流程

2026-10-18 用户要求将 M9 已使用的 CDP 方法接入既有开发流程，供当前及后续全部 M 阶段复用。统一规则见[AGENTS.md](../AGENTS.md)的“真实 App 自动验收与提效”，[CLAUDE.md](../CLAUDE.md)引用同一来源。本文说明执行方法，不更改阶段范围、评审授权、验收标准或发布条件。

## 方法与适用边界

CDP 是 Chromium 的调试协议。用脚本启动本次打包后的 Electron App，在本机临时调试端口连接它的真实窗口，通过输入事件点击、键入、滚动和拖动，读取界面与业务结果。真实主进程、IPC、存储和原生服务仍参与执行。它减少人工找坐标和无效等待，并使同一流程可以复跑。

验收层级由**实际运行内容和操作链路**决定，不能由“使用 CDP”决定：

| 实际执行 | 记录层级与边界 |
| --- | --- |
| 打包 App 的原始界面，实际输入事件，原业务／IPC／存储链路 | A：真实打包 App 自动验收；记录具体覆盖及平台 |
| 同一个 Electron 窗口导航到原型／开发服务器 | P 或开发运行检查；不是打包 App A |
| 直接调用 RPC、store 或原生服务 | 接口／I／探针；可准备非验收数据或辅助核对，不代替要求的 UI 操作 |
| React/jsdom＋真实 native、文件服务或数据库 | I；标注 IPC、几何及事件替身，不称真实窗口 |
| 暂停监听、延迟响应、私有原生 wrapper、崩溃或其他故障门闩 | 对应层的故障场景；记录注入点、原样转发／替代范围、恢复和正常环境回归 |
| 系统工具或用户实际操作系统输入法、原生弹窗等 | 系统层／人工 A；注明自动证据和用户确认的区别 |

通过 `Input.insertText` 输入中文不能证明系统输入法候选状态。直接设置 `textarea.value`、改 store、调用保存 RPC，不能证明键入／保存按钮行为。通过 `app.input` 直接写 PTY 也不是键盘或拖放到终端的界面验收。视觉一致另需逐项对照相应主题、尺寸、字体、图标及交互状态。

## 接入每个里程碑

| 既有步骤 | 自动验收的接入工作 |
| --- | --- |
| 需求／技研 | 确认真实业务链路、测试数据来源、系统权限和外部依赖；先找现成驱动 |
| 原型与用例 | 每条标明 P/U/I/A 及系统／人工前置、明确断言；按共用前置编排业务批次 |
| 用户评审 | 沿用确认范围和授权；自动化不替代设计评审 |
| 正式开发 | 先用必要 U/I 定位缺陷，再修复；维护可定位的语义属性和阶段业务驱动 |
| 打包端到端 | 每个生产基线打包一次，批量运行真实 UI；独立执行故障及系统／人工矩阵 |
| 交付归档 | 更新权威用例账、阶段入口、缺陷和证据；最终交付内容须与验收基线一致 |

只更新本流程文档时核对格式、引用与示例即可，不因此重跑全应用或发布。未经授权不把新阶段规划变成生产开发，也不自动发布。

## 复用入口

| 入口 | 用途 |
| --- | --- |
| [`scripts/lib/electron-harness.mjs`](../scripts/lib/electron-harness.mjs) | 公共启动／CDP 底座：独立 userData、本机临时端口、状态等待、输入协议、截图、日志、精确关闭 |
| [`scripts/files/file-acceptance-ui.mjs`](../scripts/files/file-acceptance-ui.mjs) | M9 业务适配例：接口准备隔离项目，实际导航／文件菜单／树与标签；其它阶段复用底座并增加自己的业务适配 |
| [`scripts/files/external-sync-ui.mjs`](../scripts/files/external-sync-ui.mjs) | 独立外部写入、真实监听／菜单刷新／恢复、界面与磁盘身份断言 |
| [`scripts/files/read-delete-ui.mjs`](../scripts/files/read-delete-ui.mjs) | 私有副本故障门闩与正常包哈希核对；按自身用例条件选用，不作为所有场景的默认环境 |
| [`scripts/files/tree-selection-ui.mjs`](../scripts/files/tree-selection-ui.mjs) | 真正的修饰键、选择／焦点分离、单文件打开和无终端误输入；结合原生投递门闩区分驱动等待与持续竞态 |
| [`scripts/files/cross-owner-ui.mjs`](../scripts/files/cross-owner-ui.mjs) | 跨窗口能力攻击示例：两个正常隔离实例互传真实句柄，按原IPC验证拒绝，并用实际键鼠验证各自保存与原生监听仍可用；同一main服务的sender隔离另由对应I验证 |

`openElectron({executable, userData, env?, cwd?, inspectMain?})` 的 `executable` 是应用可执行文件，macOS 为 `WillYou.app/Contents/MacOS/WillYou`。正式 A 必须提供已打包可执行文件；省略时底座启动开发 Electron，只能按开发检查记账。底座当前含 WillYou 导航就绪判断和 PTY 观察初始化，是本项目内的公共底座，不是任意 Electron 产品通用库。

安全用例本身要求提交伪造IPC、拷贝句柄等原始输入时，程序式请求就是待验收动作，应注明经过的真实preload／IPC／鉴权路径；正常导航、输入和保存仍按原用例经过UI。不同进程的窗口与同一main中的两个sender分别留证，不能为制造第二个认证窗口而修改真实App的trusted判定，也不将独立进程结果写成共享服务owner验证。未知清理ID的幂等无效果与读取／写入的明确拒绝分别核对，并检查原持有者资源继续可用。

常用返回值：`cdp`、`evaluate`、`waitFor`、`invoke`、`screenshot`、`rendererErrors`、`logs`、`close`。`invoke` 只用于允许的准备／辅助断言；`evaluate` 主要读状态和计算几何。`inspectMain` 默认关闭，只在隔离实例明确需要的审计／故障实验中开启并留证，不能修改鉴权绕过业务流程。连接和权限沿用已授权范围，不借 CDP 操作被工具拒绝的其它应用。

保存时序验收可复用[原生时序故障底座](../scripts/lib/native-save-faults.mjs)、[独立外写进程](../scripts/files/save-race-writers.mjs)及[中断重启示例](../scripts/files/save-crash-recovery-ui.mjs)。它们保持原ASAR、鉴权、请求和回包，只在私有副本启用既有native暂停点，或让独立进程真实持有旧fd并按路径写入；用共同门闩对齐时序，记录实际PID、dev/ino和hash。当前原生门闩针对本项目Mac文件通道，其他阶段只在适用的链路复用，不能据此推定其他系统通过。

## 一轮高效执行

1. **检查真实状态。** 读当前分支、工作区、阶段入口和用例账，确认范围及上轮结果；已有进程则检查同一 handle／PID 和输出，不根据旧聊天重启。保护其它终端、用户未发送输入及其它 Agent 改动。
2. **选择可复用批次。** 按业务模块与前置分组，例如同一个树批次覆盖排序、读取、外改及恢复。场景之间使用独立根、文件身份、任务和持久化命名空间；同绝对路径可能在不同任务间共享文档或已保存内容，单换任务 ID 未必隔离。
3. **确认构建。** 记录提交及工作区快照、锁文件／配置／原生输入、应用版本、系统／架构、ASAR 与涉及的 native 哈希。生产输入有变则重建并做包内检查；仅驱动、文档或隔离原型变更，可比较输入／产物哈希后复用包，并单独记录本次驱动／原型版本。不能只凭“同一路径”或版本号判断是同包。
4. **隔离启动。** 每轮 `mkdtemp` 建独立 userData 和项目，端口只绑定本机并只连接本次 PID。底座会删除部分常见模型环境变量，但这不代表所有环境或本机凭据都已隔离；测试数据／配置仍须明确选择，不默认复制日常账号。只为测试实例临时开启调试，不修改发布包的默认启动参数。
5. **准备数据。** 创建合成文件、隔离项目等允许通过文件/API 完成；记录准备动作。用例本身要求“通过 UI 建项目”时，该步骤也必须实际经过 UI，不能把准备接口算作覆盖。
6. **连续执行。** 由当前可见控件计算坐标，确认无遮挡／未禁用，再投递实际输入事件；等待具体状态后执行下一步。一个成功输入或无异常返回不等于业务效果已完成。
7. **核对结果。** 结合界面和独立真值：编辑器真实文档、dirty／错误／焦点、磁盘字节／hash／inode、数据库记录或订阅资源数。虚拟化编辑器与列表只挂载部分 DOM，不能用 `innerText` 拼接证明全文一致。保存必须核对最终回执和磁盘；恢复／重启必须确实退出并从同一测试 userData 新启动。
8. **留证与继续。** 失败保存当前阶段、断言、必要 DOM／截图／日志，区分产品、驱动、夹具和环境原因；保留红测及最终绿测。仅停止自己的 App／PTY／订阅。清理用的 `close()` 含终止进程回退，不能据此声称正常退出保存已通过。需要正常退出的用例应操作退出并检查 `waitForExit()`。
9. **更新权威账。** 每条所有约定层级完成才计通过；多主题、重复执行、多个场景与回归不重复加数。失败／阻塞／待执行／跳过保持原状态；用户暂不在场时登记待协作项，继续独立用例。

### 等待与输入的具体约定

- 跨记录或文件切换时，不能只等旧面板仍有节点或加载标志为空闲；同时核对当前目标已选中、目标版本/hash已呈现。各场景使用不同内容，避免相同文本掩盖串场；不要用固定延迟替代这项判断。
- 中断后要验收正常退出/重启时，先按实际关闭保护结束编辑，并证明未决材料仍在，再确认退出成功后用同一测试userData重启。被保护拦住或由清理强行关闭的实例不计正常退出。
- 等“目标可见且可命中”，不要仅等 DOM 存在；隐藏的旧视图可能一直挂载。
- reload／切来源时核对新导航或 `performance.timeOrigin`，避免读取旧文档；进入控件前等当前数据／权限就绪。
- 等列表 loading 结束并确认目标成员，不在刷新暂空时把缺失当作最终结果。菜单动作后等菜单关闭，避免下一次点击落到旧菜单。
- 键盘用例同时核对内容、选择、真实 DOM 焦点和滚动位置；正文出现不等于焦点已恢复。等待目标状态仍不恢复时保留失败，用事件轨迹和真实 IO 投递门闩定位竞态，不靠增大 sleep 或只断言内容放行。后台目录刷新造成的浏览器滚动钳制也要与用户主动滚动分开验证。
- 短有界轮询适合状态；自动保存、防抖、超时等用例应等待被验证的时间边界。不要用大 sleep 抵消不清楚的状态。
- 普通文本输入用真实键盘／`Input.insertText`，并验证结果；macOS 全选需要对应 Meta 修饰及编辑命令时，参照现有业务驱动。按键必须包含相应 keyDown/keyUp；拖动须实际命中起点、过程和落点，不把 JS 调用业务回调算鼠标拖动。
- 修饰键按目标平台选择。macOS 的多选点击使用 Meta；Ctrl+点击可触发上下文菜单，不能把这个系统行为当成普通多选点击失败。组件层的通用 Ctrl 分支通过不能证明 Windows、Linux 或全局系统快捷键通过。
- 操作前置失败先检查目标、遮挡、虚拟窗口、焦点、数据、租约和旧请求，而不是连续重复整轮。测试夹具不成立时不得归为产品通过或擅自改产品以适配夹具。
- 同机多个测试窗口共享系统焦点时，UI 输入串行；单元／原生集成等独立工作可并行。输入前核对本次目标，必要时对本次 CDP page 执行 `Page.bringToFront` 并记录真实事件／业务效果。M9 曾在并发窗口回归中未达到滚动预期，串行并前置本次窗口后通过；这不证明首轮原因已完全确证，失败仍保留。
- 原型 P 和打包 App A 在测试窗口标题或独立夹具标识中明确区分。只挂载文件区等局部组件时注明未参与的区域；测试徽标属于夹具，不写入正式产品页面。不要把隐藏原 App 后的白区或示例数据，展示为完整产品的验收结果。

## 最小可运行示例

这是**隔离启动 → 真实点击设置 → 确认隔离数据目录 → 截图 → 结束**的链路冒烟，非任何阶段的完整验收。先创建 `scripts/acceptance/` 并保存为 `milestone-ui.mjs`，之后可按阶段重命名、改成自己的业务断言；正式脚本还需记录完整构建基线及用例映射。不要在日常 App 上运行。

```javascript
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openElectron } from '../lib/electron-harness.mjs';

const executable = process.env.WILLYOU_ACCEPTANCE_APP;
assert(executable, 'Set WILLYOU_ACCEPTANCE_APP to the packaged executable');
const scratch = await mkdtemp(join(tmpdir(), 'willyou-cdp-example-'));
const userData = join(scratch, 'userdata');
const result = { startedAt: new Date().toISOString(), executable, scratch,
  layer: 'A: packaged UI smoke only', checks: [], status: 'running' };
let app;
try {
  app = await openElectron({ executable, userData });
  const selector = '[data-testid="nav-settings"]';
  await app.waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  const point = await app.evaluate(`(async () => {
    const e = document.querySelector(${JSON.stringify(selector)});
    e.scrollIntoView({ block: 'nearest' });
    await new Promise(requestAnimationFrame);
    const r = e.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    if (!r.width || !r.height || e.matches(':disabled') ||
        !e.contains(document.elementFromPoint(x, y))) throw new Error('Target is not interactable');
    return { x, y };
  })()`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await app.cdp('Input.dispatchMouseEvent', { type, ...point,
      ...(type === 'mouseMoved' ? {} : { button: 'left', clickCount: 1 }) });
  }
  await app.waitFor(`document.querySelector('.settings-shell')?.getBoundingClientRect().width > 0 &&
    document.querySelector('.settings-shell .setting-path')?.textContent === ${JSON.stringify(userData)}`);
  result.checks.push({ name: 'Actual settings click shows this isolated userData', passed: true });
  assert.deepEqual(app.rendererErrors, []);
  await app.screenshot(join(scratch, 'settings.png'));
  result.status = 'passed';
} catch (error) {
  result.status = 'failed';
  result.error = String(error);
  process.exitCode = 1;
  if (app) await app.screenshot(join(scratch, 'failure.png')).catch(() => {});
} finally {
  if (app) {
    await writeFile(join(scratch, 'electron.log'), app.logs());
    await app.close();
  }
  result.finishedAt = new Date().toISOString();
  await writeFile(join(scratch, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ status: result.status, scratch }));
}
```

macOS 本地命令示例（替换成实际已验收构建的路径）：

```bash
WILLYOU_ACCEPTANCE_APP='/实际构建目录/mac-arm64/WillYou.app/Contents/MacOS/WillYou' \
  node scripts/acceptance/milestone-ui.mjs
```

原生集成测试仍使用本项目的 `pnpm test <具体测试文件>`，按该文件前置设置 App／broker 路径；不能不传环境导致 opt-in 全跳过却报告通过。系统和架构须匹配，macOS 的结果不证明其它平台通过。

## 证据与统计格式

阶段 `验收/执行与缺陷记录.md` 关联机器结果与必要截图；`验收/证据/` 不归档日常凭据、完整 userData、测试 App 副本或大型安装包。包与原始数据按既有路径／忽略规则保留，入库资料保存路径、哈希和可恢复来源。失败、修复、复验都能追溯到当时的构建／驱动，不覆盖旧快照。

每批机器结果至少包含以下字段，可按阶段扩充：

```json
{
  "revision": "M<n>已确认需求修订",
  "branch": "feature/版本号",
  "head": "实际提交SHA",
  "sourceBaseline": { "snapshotPath": "可恢复工作区快照", "sha256": "实际哈希" },
  "environment": { "os": "实际系统版本", "arch": "实际架构", "startedAt": "UTC时间" },
  "build": { "app": "已打包路径", "asarSha256": "实际哈希", "nativeHashes": {} },
  "driver": { "path": "阶段驱动", "sha256": "实际哈希" },
  "checks": [{ "caseId": "用例编号", "layer": "A", "status": "passed",
    "steps": [], "expected": "可判定结果", "actual": "实际结果", "evidence": [] }],
  "injections": [],
  "limitations": [],
  "finishedAt": "UTC时间"
}
```

计数以本阶段权威用例账的**唯一用例**为准，分母保持已确认范围；另报场景／执行数。生产 U/I、原型模型、P、真实 App、系统人工分别汇报；历史测试并集不可写成“本批全量重跑”。引用旧结果时核对实际依赖和源码哈希；有变化则补受影响测试。例如 M9 的旧 r12 native 结果不能仅因场景相同直接充当 r31 结果。

## 当前已验证的采用记录

M9 的[阶段入口](里程碑/M9_文件浏览工作区/README.md)维护实时状态。方法实证可读[DEV079](里程碑/M9_文件浏览工作区/技研/DEV079_文件树排序权限与动作边界.md)和[DEV080](里程碑/M9_文件浏览工作区/技研/DEV080_读取前删除与外部目录同步.md)：普通打包 UI、门闩／暂停监听、真实 native、原型浅深状态和驱动失败分别留证；复用同 r31 包前检查生产输入和包哈希。这里引用方法边界，不把其结果推广为后续里程碑已通过。

可复跑的目录缓存与任务状态驱动是 [tree-cache-ui.mjs](../scripts/files/tree-cache-ui.mjs)：设置 `WILLYOU_FILES_APP` 指向待验打包应用的可执行文件，再运行 `node scripts/files/tree-cache-ui.mjs`。它自己创建临时目录、独立 userData 和输入接收器，覆盖真实五秒等待、无终端／运行／停止后刷新；精确查询数另由 [tree-cache-acceptance.test.tsx](../src/renderer/features/files/tree-cache-acceptance.test.tsx) 的真实 native 集成断言。暂停本次 watch 构造陈旧快照、输入接收器不等于模型忙碌等边界见 [DEV083](里程碑/M9_文件浏览工作区/技研/DEV083_目录缓存与终端独立刷新.md)。按状态判断应核对当前视图真实转移：停止后保留退出内容时，不能等待另一种已卸载视图的恢复面板。

本文最小示例已在 macOS arm64 的 r31 打包 App 独立运行通过：真实点击设置后，页面显示本次临时 userData，截图／日志／结果与执行脚本见[方法验证证据](里程碑/M9_文件浏览工作区/验收/证据/cdp-method-validation-20261018.json)。从临时目录执行时仅将底座的相对 import 展开为绝对路径。此项为公共方法冒烟，不增加 M9 正式用例通过数。


### 终端与原生可见性验收补充（DEV086）

- 原生窗口隐藏与document.visibilityState分别观察。关闭backgroundThrottling的Electron窗口可能hide后仍报告visible；按用例需要核对BrowserWindow.isVisible/isMinimized、真实host几何、焦点及kernel尺寸，不强制改DOM状态。
- 持续输出用独立输入只读接收器编号，另被动收原始PTY事件；保持同DOM/PTY/PID，实际wheel按状态走到首项并核对全部历史，不能只读最后一屏或假定一次超大wheel到了顶部。夹具控制文件也原子更新。
- CDP按键区分key与code：空格用key=" "、code="Space"；确认按钮的默认动作必须实际发生。重载后的原始任务要通过真实启动/恢复入口附接，建立基线后再测，不能只按setup返回的PTY推定界面已就绪。
- 故意编辑的样本按现有自动保存规则核对完整预期文本，未编辑sentinel继续核对hash/inode/mtime；不得把“全源件不变”的自加断言当产品要求。菜单/表单需等实际字段值、描述和有限动画就绪后再操作，前置错误单独保留。


### 查询与Unicode验收补充（DEV087）

切查询后应检查首个可观测render，不能只等debounce后最终正确；候选/结果须绑定根与查询，真实native成功回包可在独立I层延迟投递，保持原内容。候选提供与basename排名分开，路径命中但basename零分仍可保留，预期列表要依据已确认规则而非主观省略。Unicode高亮除检查结果文字，还要检查每个实际文本节点/fragment代理对完整并确实有高亮；仅textContent拼接完整会漏掉多个span把emoji拆开的缺陷。


### 迟到成功与资源释放补充（DEV088）

测试取消不合作场景时，在原认证处理器完成真实读取后延迟投递原结果，保存原始SHA并校验前后不变；明确此层为延迟故障注入。清理时核对原处理器函数身份恢复，不只写了恢复代码就推定成功。精确时钟边界可在独立I验证，真实App记录实际输入间隔，不能把工具/native开销隐藏成精确计时。监听数须说明观察位置：main owner监听、renderer IPC监听、native活动任务/进程分别举证，不互相冒充。


### 拖放、可见性和虚拟焦点补充（DEV091）

- 复用`dragElectronElement`：实际pointer触发dragstart，经`onCDP`捕获Chromium原DragData，再投递dragEnter/dragOver/drop。核对原payload、trusted事件及最终顺序/业务结果，不制造tab UUID或直接调用handler；声明这是浏览器DND，不能证明物理OS拖放。[协议字段依据](https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Input.pdl)。
- 可见性恢复用`openFileAcceptanceApp({showFiles:false})`导航到既有项目，让保存的可见性自行生效；不要自动点“文件”后再声称隐藏状态已恢复。正常重启使用原退出协调器并核对0/null，再从相同测试userData新启动。
- 虚拟列表刷新可能替换焦点节点。同步记录旧节点是否断开、新焦点的role/完整路径和活动文档，区分语义焦点保持与实际失焦；编辑器另核对同一控件/文档。迟到恢复应等真实后台read/drafts结束和渲染帧再断言，不仅等回复放行或加固定sleep。原处理器旁观/延迟后都按函数身份核对恢复。


### beforeunload 与进程故障（DEV092）

CDP事件回调中启动的异步处理必须立即接住resolve/reject，不能隔很久才await，避免未处理拒绝让驱动跳过finally。记录对话框opening/closed、实际导航timeOrigin及结果；“No dialog is showing”只表示观察/处理时它已消失，不能视为用户确认或导航成功。正常beforeunload取消应保留保护，不能为了测试改生产门禁。确需渲染器断连用例时，向独立合成测试窗口显式注入renderer崩溃，记录原生render-process-gone，再核对main/PTY、旧frame与新ref/draft；不得冒充同Store对象替换，后者由独立I/U故障缝验证。驱动异常退出后先准确审计自己的child/receiver，再决定是否重启，清理动作与正常退出证据分开。


### 查找计数、选区与渲染资源（DEV094）

编辑器验收同时核对计数、实际模型selection、source range高亮及焦点；“1/3”不证明首项已选中，999+也不证明第1000项不可导航。DOM虚拟化时按原source offset去重标记，不用可见span数量代表全文总数。富文档另外观察不相关图片/Blob节点身份，避免局部高亮重建整块资源。真实输入后Undo按实际历史分组核对每步正文和结果；I/U需要分开的概念操作时可显式isolateHistory，不能把它冒充真实键盘分组。


### 编辑器取消与视图重建（DEV095）

预览验收应同时保留完整selection、横纵scroll，分别验Esc、关闭、Enter，以及切走/切回原文件。只核取消瞬间或新文件正文，会遗漏原文件恢复后的漂移。JSDOM没有真实字体/行高测量；用真实浏览器组件实验定位后，仍须在新打包App复验。CodeMirror跨view恢复采用同document的scrollSnapshot锚点，并在旧view销毁前取消预览；直接恢复未测量view的像素可能被后续布局重新解释。组件实验的直接状态设置明确为I/browser，不混成A用户输入。


### 测试结果与进程退出（DEV096）

归档必须同时检查测试断言、未处理异步错误和命令退出码。Vitest JSON的success=true/失败0并不保证进程成功；若退出非0，补默认报告定位Unhandled Errors，保留失败，不将该轮写成通过。本批曾由JSDOM缺scrollIntoView引起，明确几何适配后重新验证；实际App仍用真实浏览器几何。使用-t选定原生测试时，将未选的其他测试单列，不当作新通过，也不混同产品阻塞。


### 流式进度与最终结果（DEV096）

流式事件和最终RPC可能经不同通道到达。除查询/根/session身份外，最终成功或异常后必须关闭progress，已排队的状态更新也应守卫；失败时保留此前真正收到的partial。集成层可回放实际观察到的同ID原生行验证完成后不重复，必须注明运输故障层；真实App仍需独立按实际列表数量复验，不能只看原生result。上限用99/100/101真实数据，额外第101是哨兵，不能由前端slice证明后端上限准确。

文件变化故障记录准确时间窗口：延迟原生成功交付后改文件证明打开时重验证，不能声称变化发生在原生扫描中；扫描中竞态可另在实际枚举与读取之间修改自己的源文件。原成功hash、原处理器身份及未故障源指纹分别核对，明确允许改删的测试文件。


### 键盘历史与结果就绪（DEV097）

键盘验收须核实际输入值、选中项/滚动、未提交草稿、活动文件及关闭后的原控件焦点。只核keydown被stopPropagation或datalist存在，会漏掉历史未真正选值；方向键两个方向、Enter聚焦而不打开都应在打包App操作。普通历史键与结果导航在首条边界分别检查，兼容快捷键通过不能代替已确认的普通键。

状态key切换的首帧可能是空idle；busy=false本身不证明查询完成。恢复同名草稿后，结合当前query/root/request及实际结果数量/身份再按Enter。准确499/500ms用I受控时钟，A记录真实DOM时间与原生进度/最终成功交付，不伪造match/done/error。测试文件通配符可能静默不匹配，归档核实际测试名/数量，不能只看命令退出0。


### 监听启动与多个测试窗口（DEV098）

分别验原OS subscribe迟到与RPC watch ID迟到：前者须关闭后取消真实订阅，后者须renderer拿到迟到ID后补stop。故障缝只延迟原调用/原成功，不造订阅或事件；记录原函数恢复、packet hash及实际unsubscribe次数。初始快照竞态要明确OS注册尚未执行、list/stat已建立基线，再变更文件并验证ready resync的最终树/正文，不能拿一次手动刷新代替。

两个独立profile/App进程可验证实际窗口之间的文件更新与关闭隔离，须写明它不证明同main订阅池；池共享另用同FileService两个真实owner的native I验证。文件ref关闭与目录root订阅独立：树仍可见时root保持合理，最后scope离开才应释放。所有窗口输入串行，read-only观察可交错；原生订阅清理在harness强制结束前完成。


### 根失效、窗口导航与竞争保存（DEV099）

复用[原watch/OS观察器](../scripts/lib/file-watch-observer.mjs)及[原文件RPC观察器](../scripts/lib/file-rpc-observer.mjs)，分别留存真实subscribe/unsubscribe、原通知/参数/结果hash与处理器身份；只有明确需要故障时才延迟原调用或原成功交付。完成后核对全部原函数恢复，不改私有Store、鉴权或结果。实际示例为[根失效](../scripts/files/root-loss-ui.mjs)和[窗口边界](../scripts/files/window-boundary-ui.mjs)。

区分三个时点：原native调用前、原native已返回但RPC未交付、原保存handler尚未调用。后两者不能冒称OS任务仍活跃或同时写入；同main取消/队列使用同原service多个认证sender的真实native I独立验证。独立profile/App进程的双窗口A只证明实际窗口效果，不冒称一个main的共享池。

根物理失效/导航会隐式清资源，观察器只按显式stop RPC维护的ID集合可能保留旧ID；以实际native stopped/unsubscribe、旧能力拒绝和原service资源计数为依据。普通叶缺失不等于根丢失；同名路径也不等于原物理目录。重试须等待本轮明确“另一目录/物理身份不同”消息，泛配“原目录”等旧提示会让脚本提前变更夹具。重新关联后记录精确本地编辑、原生saved回执和UI已保存状态，截图不能停在saving就声称完成。

多个窗口输入按顺序执行，单元/native与只读资源比对可同时推进；按模块批量回归，每个脚本记录退出码，单个失败不掩盖后续独立结果。先按最新源码文件的最终完成结果去重，再报代码数量；测试标题勘误复跑不算新测试。脚本失败、原包真实红、修复后绿分别留证，不用驱动调整掩盖产品失败。


### 真实事件洪峰与 provider 故障（DEV100）

用例的预期之外，还要回看映射需求里的关键降级/恢复条件。M9曾只验证resync与最终快照的候选绿；核对R08.10后补上poll要求，原包真实复现失败，修复后才记完成。部分绿与真正完整结果分别保存，不能只按一个方便的断言收口。

[provider观察/故障助手](../scripts/lib/file-provider-observer.mjs)接在原watch观察器之后，只将本次文件broker的原spawn委派给字节相同的私有副本；实际移除副本执行位产生OS EACCES，恢复后校验副本与原包SHA、原函数身份。验收包不直接改权限，不以手造错误或成功代替实际故障。所有其他子进程沿用原spawn，严格限定本次隔离实例。

[真实洪峰/恢复脚本](../scripts/files/watch-pressure-ui.mjs)执行3500创建、3500改写、3000删除，先等实际OS事件批累积>2000再原样交付；校验hash、poll/resync、最后快照/实际虚拟列表滚动与正文。生产者动作数不是OS完整历史。大目录归档压缩精确树和逐文件hash，保持证据可恢复，不堆数千散落文件。

原生connect/fallback需要独立连接代：旧callback、迟到subscribe成功和拒绝都须守卫，旧真实订阅仍应注销。实际App的自动恢复等待真实退避时间；fake clock只留在独立U，不拿时钟加速当实机时间证据。操作虚拟树先使目标进入视口，必要时实际滚动或收起目录，不能用DOM不存在推定文件丢失。资源清理等待全部原生订阅停止和helper请求结算，再恢复观察器并关闭harness。

### 快照成本、冷/热定义与停止后的释放（DEV129）

[成本观察器](../scripts/lib/file-watch-cost-observer.mjs)配合[原监听观察器](../scripts/lib/file-watch-observer.mjs)，在本次 App 中将原定时器回调的异步上下文传到原 broker 子进程，只读记录每次 scan 的路径、耗时、原始请求/结果哈希和状态；不同 scan 不合并为同一性能样本。定时器原实现仍执行，最终按相反顺序恢复并核对函数身份。观测额外开销包含在测量内，不据此宣称进程 CPU 占用率。

自然性能分布执行前冻结样本数、目标成员、软/硬门槛、降频和恢复规则。明确冷样本是全新 App 进程的首个完整目标快照，还是同进程的新服务上下文；二者分别统计，均不冒称已清空 OS 磁盘缓存。只接受完整目标目录和打开文件的快照，并记录未展开后代没有被递归扫描。原请求延迟等故障数据单列，不混入自然 p50/p95。

实际停止后分别核对原订阅 unsubscribe、归属本轮 watcher 的定时器、公开平台资源及后续回调；不能用 App 进程退出隐藏同实例泄漏，也不能只信自报计数。[恢复/预算驱动](../scripts/files/watch-recovery-budget-ui.mjs)示范同实例多次隐藏/重开真实文件区、停止后实际写入再观察，以及原始请求字节不变的交付延迟。预算提示应核对浅/深色和恢复清除；故障解除后继续正常链路。

先等新监听的第一个完整成员快照，再制造外部修改；native ready 只说明订阅建立，尚不证明初始指纹完成。目录展开按实际 ARIA 状态决定动作；原生重扫完成后，还须等首行/可滚动区域已渲染，再投递滚轮。保留时序等待失败及修改点，不通过删除业务断言掩盖问题。

### 打包引擎的加载与许可证据（DEV130）

先检查实际 ASAR 的入口和静态模块图，再用真实文件打开验证按需执行；初始脚本、Worker 构造 URL、原始可信回复及实际内容分别记录。`file://` 页面可能返回空 Resource Timing，此时用只读 CDP `Debugger.scriptParsed` 核对实际脚本，独立引擎还需记录原窗口模块入口、真实函数可用及渲染结果，不能把空 timing 当未加载。结束关闭 Debugger 事件观察，不设置断点或更改模块。

Worker 的 `parse` 消息不一定属于 Markdown；代码、Markdown 和其他引擎可共用该类型，应按实际协议字段（如 filename）、URL和输出区分。只观察 `onmessage` 会漏掉使用 `addEventListener` 的消费端，通用流量可加只读原生 message 监听；不能将观察器未记录回复判作产品没有输出。许可证按包内实际字节与原声明/哈希核对，分开通用、代码语法/主题和MCP等专用清单；安装体积说明是解包逻辑文件、磁盘占用还是下载包，平台仍按真实已验范围记录。

`postMessage` 的 transfer list 会合法转移并 detach `ArrayBuffer`，不能套用发送前后 JSON 必须相同的纯 DTO 观察器。按协议核对转移前的字节和所有权，或先结束该观察器，再用原生 Worker 和实际画布/文本结果验收。M9 PDF 的真实加载按后一方式执行，代码/Markdown 观察器在打开 PDF 前已恢复；不通过禁用转移、改写消息或替换结果修正观察工具。

### 大文档解析的低开销观测与真实终止（DEV131）

[解析观察器](../scripts/lib/markdown-parse-observer.mjs)在测量的界面线程只记长度、id/revision、范围、时刻和计数，不克隆/JSON化/哈希整份源码。全文一致性在解析/首次绘制计时区间之后核对。观察器对Worker使用WeakRef：强持有Worker会经其原onmessage闭包保留已关闭编辑器和全文，产生测试自身的“内存泄漏”。保持被动监听可观察真实迟到事件，不以停止监听假装取消后没有回调。

[原生Target观察器](../scripts/lib/worker-target-observer.mjs)不暂停启动，记录真实targetDestroyed和Worker堆。取消探针可在原始parse投递时仅报告当前关闭按钮几何，随后由驱动发真实指针输入；不能用直接dispose、构造cancelled结果或仅terminate返回时间代替用户取消和底层销毁。[正常测量](../scripts/files/markdown-worker-ui.mjs)与[故障恢复](../scripts/files/markdown-worker-faults-ui.mjs)分别执行；故障等待原15秒看门狗，不改真实App时钟。

冻结全部已确认样本的并集及UTF-8字节/UTF-16码元/hash，再冻结预算。区别探索值与冻结后判定、主线程long task与Node计时器间隔、活动堆与全部标签关闭后的post-GC增量、堆观测与进程峰值驻留集；Electron MemoryInfo统计按官方定义及对应版本源码换算单位。极端字符串的UTF-16LE码元往返不能冒称有效UTF-8；解析器U/I接受的JS字符串与实际文件入口的NUL/UTF-16安全拒绝分别记录，禁止绕过原编码策略伪造App解析通过。


### 排序 Worker：固定规格、候选与界面分开核对（DEV101）

[观察器](../scripts/lib/fuzzy-worker-observer.mjs)用构造器子类只读记录，再委派原postMessage/terminate，结束移除监听并恢复原构造器/方法。重载后先确认当前realm已安装；注册NewDocument脚本不等于当前全局已具备。引用会影响GC，此观察不能同时证明整体内存预算。

[固定规格](../src/renderer/features/files/fuzzy-ranking-fixtures.mjs)不导入生产matcher生成期望。[真实脚本](../scripts/files/fuzzy-ranking-ui.mjs)先独立核对score/资格/fragment，再核对DOM行序/mark与原Worker连通，后者不能单独当算法oracle。Node线程可加最小self桥执行原编译字节，标I并由实际浏览器Worker A独立验证；候选生成与client重排分开，native未知不能由client测试补造。

大小写不敏感FS的不同case文件放不同目录，先验源指纹；同分用UTF16/原候选index固定例子。长输入检查编译后星号/NUL阈值，元字符/Unicode用明确资格和范围，不用任意子序列近似。先确认独立编译产物存在，再启动依赖测试；缺产物记夹具失败。新P测试按现有file-*发现规则命名，等内容测试改名不重打运行包，但记录新源快照并复跑模型。

### 大文本边界与输入批次（DEV102）

[固定夹具](../scripts/files/text-size-fixtures.mjs)独立于生产限额；UTF8 bytes、BOM和UTF16 units分别校验，[原生I](../src/renderer/features/files/text-size-native-acceptance.test.ts)准备实际userdata目录、检查完整源指纹。大Buffer比较用bytes.equals或独立hash，避免测试框架逐元素展开耗时。

[实际App驱动](../scripts/files/text-size-ui.mjs)通过普通树／恢复／保存按钮操作，读CodeMirror真实文档SHA。预置真实checkpoint是夹具准备，不计UI创建；metadata-read竞态只延迟原调用，实际外部writer改源，原参数／结果保持。异常时先尝试恢复main handler，再移除renderer观察监听；renderer挂起也要记录未恢复部分与自有进程是否结束。

单次巨量Input.insertText与实际输入批次分开记录；分段事件维持trusted、UTF16边界不拆代理对，每批等待真实模型长度后继续。DEV102分段21场景通过，单次巨量超时仍待定位，不能以重试成功撤销失败。清理优先应用明确放弃入口；未经核对的快捷键不能用于推定历史分组或测试通过。所有阶段输出进度，业务验证与测试清理失败分别保留，不将失败轮改成绿。

### 追查原子输入停顿（DEV103）

[单次输入脚本](../scripts/files/large-input-ui.mjs)用真实Input.insertText，先加只读beforeinput/input元数据与CPU profile；超时后保留事件阶段和观察失败，不能由无profile推断具体调用栈。r54只有beforeinput返回，r55修复后完整20MiB+1在273ms返回；测量范围是命令返回，不等于全部UI/内存预算或原生paste。

修复普通文本DOM入口须保留source/history/多选区，守可写facet和compositionStarted；后者与首个文档变化后的composing不同。小输入、真实paste、composition与已处理事件分别保留旧路径，做必要单元和真实包保存/拒绝回归。外部驱动增加边界参数可沿用同包，必须证明生产输入未变并补最终源快照。

签名验证在沙箱失败时，先只读核对供应方固定资源inventory和常规权限codesign；本次两原资源正常通过才按既有授权重试构建，不删除验证或重签供应方组件。保留原失败与复核证据，避免把环境限制误修为业务代码。

### 大列表末尾的真实可见性与重复查询（DEV104）

[名称大结果驱动](../scripts/files/name-limit-ui.mjs)先核对原Worker的完整候选、total/truncated/limit与稳定排序，再实际wheel到显示末项，验证提示的屏内geometry/elementFromPoint。DOM里有文字不等于滚到末尾仍能看见；DEV104保留r56不足的绿及新gate红，r57将状态放滚动区外才完成。缩小词必须重检完整候选，证明原尾部可以被命中和真实打开，不能仅用前N候选重排。

重复同query按输入前记录的新Worker index或请求ID等待，不能找到任意旧同query结果就继续。按键先明确实际focus，尤其Esc在输入／树／编辑器的规则不同；双击固定读真实tab状态或固定footer，不以打开内容当固定。P与A分别保存浅深截图及合成／原生边界。物理5001文件集中压缩并保留全量指纹，不归档数千散文件；原型服务按已确认本轮port/PID/cwd清理。


### 原生流取消与终端无关的读取矩阵（DEV105）

[任务夹具](../scripts/lib/task-file-fixture.mjs)建立两条输入只记录不执行的真实PTY，单独记录idle计数不变、持续输出计数增长、停止后主进程ptyId=null与真实退出显示。项目文件视图用于无当前终端场景；不将这些隔离前台活动写成真实模型忙碌，不发真实提示。终端停止后可保留退出画面，不能假定一定出现resume按钮。

[内容流观察器](../scripts/lib/content-search-observer.mjs)只延迟原startSearchSession成功与原files:search，首条原匹配进入实际UI后，再关闭/导航，运行原cancel，最后交付未修改的原尾批和成功。主界面模态会阻止侧栏/根点击，按真实入口先关闭；直接root/task生命周期和AbortSignal另由I覆盖。记录新请求ID、原payload hash、订阅和owner listener回收，不把已完成但尚未交付的原生请求说成仍在运行。

[文件读取矩阵](../scripts/files/terminal-disk-read-ui.mjs)按终端状态×读入口×writer分组，比较完整CodeMirror只读模型和独立源字节，重复刷新应clean且不重建冲突。要证明不依赖watch，可门控原通知交付并在读取后原样释放；不要停掉renderer仍持有的watch ID，再把随后UNTRUSTED当成业务失败。旧读取成功/错误用真实physical inode替换、原read成功或实际权限错误，不构造A结果；[RPC观察器](../scripts/lib/file-rpc-observer.mjs)扩展open/readError门禁保持既有默认参数，补做实际窗口回归。

虚拟目录未渲染的行，仅waitFor不会使它出现。先实际wheel进入视口，再点击并核对实际tab身份；分步骤保留stage及完整模型/标签状态，避免把树等待误判为固定失败。调试子区间须显式标注，正式矩阵要求startIndex=0、完整场景集合，不把部分绿合成一次全部通过。修驱动不需要重打包，但保存最终driver/test源码、原包运行哈希、失败及缺失的历史快照边界。


### 输入长度与CDP组合事件来源（DEV106）

[真实输入矩阵](../scripts/files/search-input-limit-ui.mjs)对query/mask分别测试255/256/257 UTF16 units、表情跨边界、普通输入与Chromium组合，再核对新请求ID的原RPC和原native回执。HTML maxlength、业务校验、持久历史都要一致；UTF8 bytes、UTF16 units和代码点数量不能混用。组合草稿先保留完整候选，确认后才规范化和提交；截断不留残缺代理对，旧过长glob不截成另一模式自动执行。

不要预设所有CDP事件都isTrusted=true。Input.imeSetComposition/commit的真实观测为start/update/input/key可信，而compositionend可为false；记录逐类事件和实际来源，保留失败的all-trusted假设，不用JS合成事件冒充实际输入，也不把该结束事件说成物理系统候选确认。浏览器功能路径可用于对应输入规则验收；需要真实系统候选的独立用例继续人工。P的[对应矩阵](../scripts/files/search-input-prototype.mjs)只用合成provider，不能替代原生IO或像素参考。

构建后只修外部驱动的观测断言，可在证明生产/原型输入未变、运行包hash一致的前提下复用包；保留构建与最终两份源码快照，原部分失败批次和最终补验分开，去重计场景。不要以一次批次整体失败掩盖其中独立已通过的回归，也不能把部分通过当全部绿。


### 别名恢复与失效源的能力观察（DEV107）

[别名草稿驱动](../scripts/files/alias-draft-restore-ui.mjs)将旧duplicate routes和原生独立checkpoint限定为自有夹具，再正常退出整个App并重启。按用例原判据验证canonical标签归一、同/不同原文和人工恢复入口；直接draft能力可继续按签发路径隔离，不以inline按钮数发明更窄要求。实际查看两份材料，明确保存一份，再核对另一份仍保留。切恢复记录时等待所选id及对应完整内容，避免读上次预览作断言。

并行别名的first metadata ref可能已经被合并释放，真实UNTRUSTED是正常能力边界。取证从实际完成read的document.ref读取，比较id/lease/generation等能力字段；跨RPC元数据对象不要求JS Object.is相同。保留失效ref失败，不重新伪发能力或改main授权去迎合脚本。

[活动根重试驱动](../scripts/files/active-root-retry-ui.mjs)分别测试移除原登记和物理目录不可用。配置恢复只作独立夹具前置，精确记录原source id/path/project；真实重试必须通过main按该source重新签发，再保留原成功交付门禁以制造晚A，实际选择/编辑B验证其dirty及目标不变。复用单source协调，保持健康B能力；route仍校验原路径和host，不用当前树授权替代。面板重启可能已恢复可见，单根可能隐藏选择器，先观测当前状态，再决定是否点击。

扩大回归遇到旧预期时，先看完整diff与上一份源码证据。DEV107的L13已批准treeVisible与显式空expanded项早已存在，补齐精确预期并保留其它所有字段/禁止项断言；不把未知差异笼统略过。单个PDF夹具opt-in与历史CLI未选项分别统计，不能混为通过或重复计新测试。


### 原始终端回执门禁与独立接收器（DEV108）

复用[投递边界驱动](../scripts/files/terminal-context-boundary-ui.mjs)及[原RPC门禁](../scripts/lib/terminal-rpc-observer.mjs)，保持原认证handler、参数和结果。可在原prepare返回后取消，或原insert已经完成后延迟交付，让实际1.5秒未知先出现。明确失败用自有源文件的真实inode替换触发原服务拒绝；需要先验证原failed已经返回，再延迟它，不构造failed/inserted对象。参数/回执哈希、门禁释放与handler身份恢复都作断言。

同实例迟到成功/失败及切任务、根、关闭入口分别测试。独立raw PTY只记输入，记录完整累积字节、无未包裹回车、执行数零和另一任务零输入；不能把收到字节称为CLI执行或完成。精确1499/1500ms由U控制时钟取证，App负责真实时间下可见未知与不重发。4000/4001、200/201、跨边界代理对和总长7999/8000/8001用独立期望格式核对，不把调用同一formatter作为唯一oracle。

共享夹具[task-file-fixture](../scripts/lib/task-file-fixture.mjs)的receiverScript选项仅换自有接收器，默认仍为原持续输出接收器；修改后补默认调用方回归。虚拟树节点先实际滚动再点击，静态测试文件优先开包前准备。关闭非活动标签用例先实际打开并确认所有前置标签已固定，避免未满足前置就解释关闭行为；保留旧失败，不能用新的成功推定旧快速点击已经修复。


### 确认实际目标消费输入，而非只核对写入调用（DEV109）

[引用/模式驱动](../scripts/files/terminal-tray-framing-ui.mjs)在自有App中观察**包内实际node-pty模块**的原spawn/write，保留原方法、入参和回执；不能require仓库里的另一个模块副本后宣称已观察生产实例。连接任务时按当前PTY身份等待对应xterm，不能把隐藏旧终端或main仍存活当当前页面已连接。追加引用必须等待新引用身份出现，已有托盘存在不足以证明异步capture完成。

实际模式由目标输出CSI2004h/l驱动。自有zsh通过隔离HOME/ZDOTDIR中明确按键触发的ZLE widget把quoted BUFFER写入自有文件，不accept/eval；对比实际缓冲全文。sh read循环先等待3秒无行，明确Enter后核对完整提交文件；cat核对实际接收文件。原受控输入、手动Enter与额外只读快照控制键分别计数。大载荷用非canonical/no-echo的sh/cat夹具保留ICRNL，避免内核canonical行长截断；这是测试前置，不改App或冒称默认系统配置。

不调用生产formatter/sanitizer生成唯一预期。独立拼接规范头/分隔符和清理规则，与实际PTY/目标文件比对；包含控制字符、孤立代理对、emoji及UTF16/UTF8分别计数。C0样本按产品规则可能归为二进制，带真实UTF8 BOM的文本可覆盖危险文本路径，不能为测试放宽分类器。原型回执明确标合成，模型/原型/App各自保留结果。

复用历史同包证据时逐条说明哪个边界来自哪个报告，证明生产输入/包未变，不能把历史场景数加进本次执行数。停任务后文件打开/刷新等尚需当前包补验时，优先调用已有[读取矩阵驱动](../scripts/files/terminal-disk-read-ui.mjs)，证据作为追加报告保留，原报告和失败均不覆盖。


### Markdown 的 source 位置和旧 Worker 回执（DEV110）

[源码边界驱动](../scripts/files/markdown-source-boundary-ui.mjs)从实际渲染的带source属性文字节点取得原生caret几何，独立将其与作者原文唯一位置、UTF16编辑位置和UTF8字节位置比较，再用真实鼠标/键盘编辑；节点属性不能作为其自身唯一oracle。保存、源码切换及关闭重开后核对完整bytes，保留未编辑Markdown符号和CRLF/CR/LF，不用DOM textContent反序列化回写。

[Markdown Worker门禁](../scripts/lib/markdown-worker-observer.mjs)保留原Worker类底层post/terminate及原MessageEvent，仅延迟原window交付；记录native isTrusted与前后参数/结果。前插改revision、外写重载和换文件分别验证，另用原files.open捕获成功门禁检查旧选区是否拒绝。关闭入口后确认所有Markdown Worker已terminate并恢复原构造器/handler，不能伪造一个旧revision对象证明隔离。

前端I复用真实编辑器/编译后生产Worker、FileBuffer、FileService及包内broker，Node transport/jsdom属于明确I层；native模块相同不表示可把旧App当新生产包。生产解析修改后重新打包、六smoke/运行文件一致及实际App复验。parser-null等只在原用例允许的U层控制，App用实际坏YAML和修复流程取证；空结果必须保留源码，不能补造metadata。


### 有界扫描与视口资源生命周期（DEV111）

边界数据应由独立fixture构造，分清UTF-16单位与UTF-8字节、LF/CR/CRLF及frontmatter的原始偏移。先验证fixture确实满足语法前置（如Markdown引用定义前空行），保留无效fixture失败并注明原因；不要把无效语法当产品红测。解析扫描上限只约束指定子功能，完整source/index、尾部、源码模式及原磁盘字节都要另验。

CodeMirror可对同一WidgetType多次调用toDOM/destroy。资源controller与异步闭包应绑定每次DOM生命周期；组件层直接演练文档化API，A用真实末尾选择/滚回首部及native图片解码验证。不要让组件测试移除CM正在观察的DOM后异步等待自身重绘，再误判业务signal。图片存在必须同时核对naturalWidth、真实本机path和blob来源，URL计数不能代替。

URL原始观察会含App品牌等资源；保留完整日志，按实际文档图像的已知字节/类型限定释放断言。先确认图像解码，再核对关闭文档后其URL全部释放、Worker终止及观察器恢复。不要为了验证生命周期假定视口外DOM必删除或已在EOF的selection命令必重新滚动。额外巨长block触底实验未达到几何预期时保留为待定位观察；原定用例和额外实验分别记结果，后续滚动专项继续核对，不把额外失败改写为通过。

包构建后只改外部驱动可沿用同包，但须保存前后源码冻结并证明生产输入不变；业务源码改变则重建新包。对同一阶段的13组数据只增加1条唯一正式用例，模型/I/A或多次执行不重复计数。[DEV111原始红测与实际App](里程碑/M9_文件浏览工作区/验收/证据/m9-acceptance-markdown-reference-dev111-r62-20261019.json)可复用。


### 渲染能力门控与选区源码态（DEV112）

把语法、宿主能力和实际引擎分层验证：真实parser检查完整fence与严格首词；真实extension I覆盖可选callback的有/无及空代码；App使用实际隔离引擎核对多种原图语法、原SVG回执、实际图像解码和完整source。宿主I中只记录callback不能当Mermaid成功；App固定提供callback时，不能伪造一个设置再声称已跑缺能力App场景。

光标落入未闭合fence时，CodeMirror会显露该块的原始源码。负例检查应核对无diagram widget/RPC、可读原fence或代码显示、完整原文与磁盘；不能把“必须存在pre/code替换DOM”当业务预期。保存驱动失败，再针对实际状态修正，原语法/source/无错误调用断言保留。空完整fence不应因truthy判断跳过能力调用，其真实错误也要有可读回退和可达源码。[DEV112分层证据](里程碑/M9_文件浏览工作区/验收/证据/m9-acceptance-mermaid-gate-dev112-r63-20261019.json)保留全部红测和修正。


### 图表复用与原生尺寸证据（DEV113）

验证复用要同时检查实际DOM对象身份、稳定id、blob URL和原renderer调用次数；图外改字后的HTML相同并不足够。真实CM/Worker I用toBe保留身份断言，不能为转绿改成深比较。代码/边界变化、selection显露源码、块移除及视图卸载分别核对旧signal、返回cleanup、observer断开和记录清除。

jsdom受控RO可证明callback到measure的连接，不能证明真实布局。App用实际分隔条拖动，原生ResizeObserver的原entries不变传给原callback，原requestMeasure只做转发计数；记录同一图表多个真实宽度及对应measure、id/blob/renderer次数。单元里的受控SVG/RPC不作引擎证据；实际App另核对真实renderer和解码。原成功SVG门闩必须等待原引擎/鉴权成功后再延迟，随后改代码、关闭或切文件，释放相同结果并核对无旧blob分配或新selection污染。

只按已知fixture文件清单归档；实际原子保存可能产生受保护staging目录，不能把项目glob当regular文件列表或擅自清理恢复数据。归档中断且报告尚未发布时，可核对每个已有副本与源哈希完全一致后接续，不覆盖已发布证据。[DEV113原始证据](里程碑/M9_文件浏览工作区/验收/证据/m9-acceptance-diagram-lifecycle-dev113-r64-20261019.json)包含DOM红测及真实尺寸/迟到场景。


### 惰性Worker的真实初始化与失败（DEV114，可复用）

先用实际构建依赖图证明普通路径不含引擎，不能仅删除显式import：上游CJS模块可能仍静态require。P与A分别跑真实引擎，安全参数/预算在真实U验证，真实I使用当前编译原Worker与native文件服务；P合成数据不当业务App通过。预算回退要先等真实引擎overflow，页面初始raw不证明已经完成异步判断。源Worker和引擎Worker分开记录，旧native二进制复用须核对字节，不能把旧ASAR当当前渲染包。

故障机制须先证明生效。本次protocol.handle和Fetch对本包本机本地Worker均0观测，保留失败，不能用“已安装拦截”当已加载失败。不要替换defaultSession已有webRequest安全监听来增加门闩。最终用Chromium Target原生debugger-start暂停实际模块初始化，保留waitingForDebugger=true和target终止事实。关闭后旧target被结束即为取消成功，不杜撰取消模块之后有成功回包；另用真实成功结果门闩验证迟到consumer。缺失模块URL故障显式记录原URL/故障URL，真实Worker发出可信错误，绝不构造ErrorEvent或假结果。

错误consumer的门闩可能引入原本不会发生的默认未处理报告：仅在门闩时同步preventDefault，并单独记录此前/之后状态；core字段不改，不宣称整个event所有状态不变。增加非门闩真实错误对照，证明生产catch/default逻辑，然后分别验关闭/切换后原错误迟到及正常恢复/requestMeasure。原观察器/Target自动附加均恢复。独立原型导航在退出前返回正式App页面，使真实文件关闭ACK存在；不以强杀代替“正常退出0”。测试包装器可返回新对象，观察器状态应使用稳定引用作为身份，避免门闩状态丢失。详见[DEV114及原始日志](里程碑/M9_文件浏览工作区/技研/DEV114_数学惰性渲染.md)。


### 鼠标未释放时切界面，以及原生监听注销（DEV115）

验收“拖选未mouseup就关闭/切文件”时，不用直接写组件状态/DOM focus。保持真实CDP mousePressed＋mouseMoved/buttons状态，用真实Tab循环到可见关闭或其他标签按钮，再Enter；确认新视图就绪后释放原mouseReleased。先核对原监听当前确实注册，再确认切换后、释放前已经移除，并比较新source/anchor/head，防止无活动owner的空验证。光标移动不能按UTF16数量假定每次Arrow只走一单位：emoji/grapheme/atomic decoration会跨多单位；使用实际字符几何点、Home/End与源选区状态等待，保留明确的目标文字断言。

JS add/remove拦截不会看到浏览器的once或AbortSignal自动注销。记录注册不等于仍注册；不能据一个remove计数0报告产品泄漏或弱化清理标准。使用[CDP原生监听注册表](https://chromedevtools.github.io/devtools-protocol/tot/DOMDebugger/#method-getEventListeners)，纯读取实际函数identity与原观察函数对照，并释放检查用remote object group。DEV115实际发现Base UI菜单once/signal登记记录留在测试数组，但真实document mouseup已为0；保留误判与原生核查两种原始证据。观察器转发原函数及原capture/options，不为计数改回调身份或生成事件。

链接的选区guard应在mousedown保留，因为默认聚焦/blur可能在click前折叠原选区；分别验source选区与rendered native选区。外链如果只允许验证入口，原sender/URL校验仍应执行，OS启动边界明确受控拒绝并记录，不冒充成功打开浏览器。相对文件必须另经原可信根/真实服务打开，确认外链入口没有文件RPC或capability。测试注入代码优先使用函数.toString序列化，避免多层模板转义造成假失败。详见[DEV115原始证据](里程碑/M9_文件浏览工作区/验收/证据/m9-acceptance-markdown-events-dev115-r66-20261019.json)。

### DEV132–DEV133：增量归档与图表观察边界

复用已验收构建时，先核对全部基准源文件哈希，再归档本批新增／变更文件及完整增量清单，引用可恢复的原基准tar；无需每条用例重复复制全套源码和App。阶段结果、证据、最终交付基线仍须对应，生产输入变化时按受影响范围重新构建／复验。

等待条件返回布尔值，不把DOM节点交给CDP按值序列化。App的CSP可能禁止驱动fetch某些blob URL；可被动观察原createObjectURL收到的原Blob，用Blob.text读取小型SVG，不修改策略或原输入／回包。SVG分配／撤销按MIME类型和实例归属计数，文件图标的image/png分配不能当图表迟到结果；释放前确认原回包属于本次源码且当前图像仍待完成。真实引擎成功后的回包门闩，只证明原请求仍待交付；引擎实际运行中取消需单独验证。

Mermaid strict仍可能生成href，内联原型也须执行生产版的SVG安全过滤，不能仅检查配置。脚本／外链输入可被明确、安全拒绝；不能把该拒绝冒称成功渲染或可点击功能。普通流程／序列／类图另核对实际标签、主题和解码像素；保留错误、未分型观察及复验记录。

### DEV134：先开发 App 收敛缺陷，再集中打包验收

当已有包复现了缺陷，先补能复现的组件／原生集成测试。在独立SMARTDD_USER_DATA下，用当前out和项目Electron运行真实未打包App，复验实际IPC、原生文件与界面；标为D开发诊断，记录实际executable、appPath、isPackaged及数据目录，不能计作打包A或改写正式完成率。多个同区域缺陷在D收敛后，再统一生成正常包并执行原约定A用例和受影响回归。`scripts/files/keyboard-focus-ui.mjs`支持Y20/Y22分组和`WILLYOU_KEYBOARD_DEV=1`，一个组的驱动等待调整不必重跑已无受影响变化的另一组。

纯renderer修复若复用原生构建，必须先确认Electron版本、系统/架构、原生源码/依赖和当前native模块未变，仍运行electron-vite完整编译、同一electron-builder配置/afterPack及原`native-smoke.cjs`六项检查，核对包内运行文件与out一致；仅可省略已经满足的重复native rebuild，不能省略新包、必需smoke或最终A。条件不明或native输入变化则使用完整`pnpm package`。中间包和失败结果按实际阶段保留，不用D或旧包替代最终包证据。

键盘驱动每步等待实际焦点，不按发出CDP事件即视为已完成；对Base UI焦点守卫等待最终目标，临时守卫节点不等于焦点逃逸。加载行消失不代表目录已折叠，要同时检查aria-expanded和有效目录行。原生刷新确实移除拥有焦点的行时，应先在产品修复焦点所有权；不能只在驱动反复click/focus补救。结果定位后的焦点交接要等同一buffer视图实际就绪，用户改选焦点、来源变化或卸载应取消；只等一帧可能早于实际加载完成。

使用 Electron／打包可执行文件做 Node 模式只读校验时，由父驱动显式设置 `ELECTRON_RUN_AS_NODE=1` 后再启动；优先复用统一驱动，避免手写遗漏。DEV134 曾因漏传该参数额外启动 r76 并使用默认 userData，事后按准确可执行路径与 PID 关闭；未捕获默认数据事前基线，不能宣称其完全未变。该失误独立留证，不计验收通过，也不能因正常测试隔离就省略最终进程核查。

### DEV135：密码重试与异步菜单的完成条件

一次密码提交后，等待旧提示消失或被新的提示实例替换，再判断本次结果；旧“密码错误”文字仍在不代表新请求已经完成。密码只用于受控合成样本，报告保留状态和次数，扫描自有存储／日志并明确范围；原型公开展示的示例密码源码与真实输入持久化要分开。原型和生产分别验证真实引擎加载：动态导入资源URL的模块命名空间不一定能当字符串使用；可静态导入小型Worker URL而保持解析引擎按需加载。

打开方式菜单可能先出现加载项，再返回真实应用列表。等待实际应用名称控件就绪，按可用能力断言，不硬编码系统默认应用品牌；仅验入口时不启动外部应用。Node版PDF.js的真实解析仍可能走fake-worker路径，只记I，浏览器原生Worker及用户输入另由P/A验证。

### DEV136：先检查整条层级，再做坐标操作

开批先读用例的全部环境及层级规则；V要求与R的尺寸、DPR、缩放、语言、字体条件相同，并有截图和差异标注。只有P/I/A或看过自己的截图时仍不得填整条通过。缺参考时保存已完成的功能证据，将V缺项单列，转到能独立闭环的用例，不绕过历史工具拒绝或重复等待用户。

悬停会展开缩略图栏、改变按钮位置。先真实悬停并等待宽度稳定，或通过已有按钮固定栏位，再计算按下坐标；平滑滚动也须等实际滚动位置连续多帧稳定后选字。发出mouseMoved后沿用旧几何可能误点其它页；记录实际页、矩形、滚动和选中文字再归因，不为驱动失败随意改产品导航。DEV136的临时导航改动未解决问题，已恢复；固定栏位后原导航通过。原型透明文本层的总缩放变量缺失则有原字体/选区几何和修复后精确中文选择证据，与坐标问题分开。

为覆盖PDF Worker内部请求，可在自有Target初始化暂停时启用被动Network观察后立即恢复，记录这一启动屏障；它不替换网络策略、原Worker或结果，也不作自然冷启动性能证据。Node解析的fake-worker仍只记I，真实浏览器Worker另由P/A取证。异常注入、系统层和参考V结果分别记录。

### DEV137：真实 renderer 契约、清理握手与失败子项复跑

需要直接验证 renderer 模块与原生Worker契约时，可把实际生产模块仅做模块格式／导入URL适配，在独立sandbox/contextIsolation/no-node浏览器窗口中运行，使用正常包内原引擎与Worker；输入先经真实鉴权文件服务读取并核对字节。此层记I，正常打包App的原界面仍另做A，不用Node fake-worker代替原生Worker契约。

计时器按实际编译源码的函数范围和库模块归属记录，优先看直接调用帧，避免把PDF引发的普通工作区持久化误计成PDF泄漏。观察器转发原函数/参数，保存元数据而非正文、密码或事件对象强引用；常规快照用计数/尾部，最后再留完整trace，避免每次重复复制累积消息拖慢测试。

错误界面可以先于异步销毁握手显示。按已冻结时限等待真实Worker终止、旧画布清零、PDF计时器/监听清理，保留握手中的状态，不用立即快照误判泄漏，也不延长生产deadline来转绿。原生Debugger.pause在空闲Worker上可能要等下一条实际请求才进入paused，先发请求再等原生暂停事件。一个独立补充子项失败时，核对包/生产源/原断言未变后只复跑该项，保留前轮已逐项通过及整轮失败的事实，不能把26+1写成单轮27全过。


### DEV138：条件菜单与原型来源

菜单按可见语义判断，不固定只认“显示”：同一能力可能切成“隐藏行归属”或“关闭自动换行”。在真实无仓库来源检查禁用，在合成Git仓库核对原native状态、blame作者及generated属性/筛选，前后比较index与源字节；夹具初始化提交不等于产品提供Git写入口。复制项仅验适用性时可检查而不点击，不需要触碰系统剪贴板。

原型页面来源不能调用正式App的受限RPC。P操作后先回原file页面并等原入口就绪，再作任务/退出核查；来源拒绝应保留，不能为驱动放开sender校验。嵌套选择器使用序列化或简单类名，避免多层引号产生脚本语法错误；检查失败是驱动错误还是实际产品状态再复跑。


### DEV139：模式滚动、原生编辑命令与构建终态

虚拟CodeMirror的总高度随可见区测量变化，scrollTop相同不一定是同一内容，scrollTop改变也未必滚动丢失。用真实滚轮稳定后同时记录原文锚点、视口偏移、可见块范围/文字/矩形以及水平滚动；普通原型非虚拟容器仍核对精确像素。保留旧包同尺度失败与新实现结果，不修改原用例预期。编辑事务还须映射非当前模式的有效原文锚点；被删内容的锚点失效时只保留像素fallback。成功模式切换可重建DOM而保留buffer、history、selection和各模式scrollSnapshot；只有旧编辑器确实拥有焦点且当前没有新焦点选择时才交接。

先确认完整构建终态成功，再用out启动D。DEV139首编译在沙箱内的LibreOffice签名验证报错，随后D实际仍读旧renderer，这轮不能证明修复；正常权限下原签名有效，未替换/重签缓存，重新完整编译后D再验。D始终记录实际executable/appPath/isPackaged/userData，不计A；收敛后才统一新包和原生smoke。

原生textarea的CDP快捷键可能需要commands:['selectAll']，先读实际selectionStart/End和焦点确认全选再输入；CodeMirror键映射与原生控件分开。原生下拉工具输入未提交时保留控件值/焦点证据，不能写value或伪造change事件转绿。P可通过明确标注的可见合成场景按钮进入同一演示动作；真实native保存/权限失败/原回包仍由I/A证明，不能据P替代。
