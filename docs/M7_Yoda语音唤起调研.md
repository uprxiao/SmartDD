# M7：Yoda 语音唤起机制与 SmartDD 接入调研

更新日期：2026-10-16。调研对象为同级本地 `../yoda`，提交 `960fd3224508edc52fb7e99d9e8f8cf1723ad683`。SmartDD 基线为 `7f75b3b`，应用版本仍为 0.0.4。

本文用于 F17-A / M7 的外部 Typeless 接入。客户端内部识别研究仍在 [Typeless 技术调研](M7_Typeless技术调研.md)，自有方案仍在 [F17-B](F17B_自有语音输入与本机词库.md)。前期调研阶段未启动真实录音、未执行用于唤起 Typeless 的系统按键、未修改 Typeless 配置。随后用户授权生产实现；当前代码与真机验收进展见 [M7 实施与验收记录](M7_实施与验收记录.md)，以下源码调研仍作为依据。

## 1. 结论

Yoda 的入口是“后台启动外部软件 + 模拟快捷键”，没有在这条链路中自行录音、上传音频、调用 ASR 或取回文字。Typeless 接管录音、结束、整理和输入位置；Yoda 负责入口、焦点和触发反馈。SmartDD 可沿用这条路径，增加终端入口与后台全局唤起键。

不能直接逐行搬运的主要部分：快捷键对应的模式、系统按键的真实有效性、冷启动就绪、全局快捷键与真实修饰键释放、触发后的焦点保护。

## 2. 调用链与源码证据

以下路径以本地 Yoda 根目录为起点，行号按上述提交核对。

| 层 | 源码 | 已核实的行为 |
| --- | --- | --- |
| 页面 | `src/renderer/app/composer-prompt-input.tsx:821–903,1569–1586` | 输入框焦点和选区恢复；Mic 按钮；触发时禁用；成功 toast 与可复制错误 |
| RPC | `src/main/core/app/controller.ts:84–95` | 接收 provider / shortcut，返回 success / error |
| Service | `src/main/core/app/service.ts:506–508` | 转交 triggerVoiceInput |
| 唤起 | `src/main/core/app/voice-input.ts` | 限制 macOS / Typeless；查找安装、读快捷键、后台启动、执行按键脚本 |
| 解析 | `src/main/core/app/voice-input-shortcut.ts` | 多字段优先级、键名到 macOS 键码映射、AppleScript 文本生成 |
| 测试 | `src/main/core/app/voice-input-shortcut.test.ts` | 7 个解析／优先级／脚本文本断言，不执行真实键盘输入 |
| 工具 | `src/main/core/app/utils.ts:28,166–185` | execFile 超时；mdfind 按 bundle id 查找；应用名回退检查 |

页面调用 `rpc.app.triggerVoiceInput({ provider: 'typeless' })`。按钮点击前恢复文本框焦点与选区；`finally` 中还会再聚焦一次。SmartDD 应保留点击前恢复，但触发后仅在页面、输入目标及前台窗口仍匹配时恢复，避免用户已切换目标后被拉回。

后台启动优先 `open -gj -b now.typeless.desktop`，失败回退 `open -gj -a Typeless`；单次超时 3 秒，成功后固定等 200 ms。`-g/-j` 表达后台／隐藏启动意图，不证明应用已具备听写能力。

快捷键脚本按解析结果逐个 key down，等待 0.12 秒，再按相反顺序 key up。当前单测只验证生成文本，不验证 macOS 执行、Fn / 左右修饰键、权限归属或 Typeless 对事件的响应。

Yoda 提供显式 shortcut 参数时跳过安装检测，SmartDD 应统一检测，不继承该例外。Yoda 把系统按键失败统一包装为辅助功能权限提示；SmartDD 应区分权限、超时、脚本／键码错误和未知失败。

## 3. 当前本机配置暴露的模式问题

只读取快捷键白名单字段，未输出账号、token、历史或其他设置。实际命中 `~/Library/Application Support/Typeless/app-settings.json`；在当前大小写不敏感文件系统中，`typeless` 路径是同一候选，不能算第二份安装。

| 字段 | 当前值 | 判断 |
| --- | --- | --- |
| `featureShortcutBindings.dictationMode` | `RightOption` | 明确的听写候选；仍须真机验证一次按下是否满足点击开始／结束 |
| `featureShortcutBindings.askAnythingMode` | `Fn+Space` | 其他模式，不可未经确认标为普通听写 |
| `keyboardShortcut.handlesFreeMode` | `Fn+Space` | 与上项重叠，旧字段语义不能单独作为已验证依据 |
| `keyboardShortcut.pushToTalk` | `RightOption` | 同样的键被旧字段称作 push-to-talk，说明必须结合实际模式验证 |

Yoda 优先 feature handsFree / handlesFree / askAnything，然后 keyboard handsFree / handlesFree，再尝试 dictation / pushToTalk，最后回退 Fn+Space。本机配置会被它解析为 `Fn+Space`，而非 dictationMode 的 `RightOption`。

SmartDD 的规则：按明确的听写语义选择候选；遇到别名矛盾或只找到按住说话模式，显示“待确认听写键”，提供人工指定和试用。不给所有版本硬编码 Fn+Space，也不把 askAnythingMode 当普通听写。用户“不要求 Option 触发”指 SmartDD 自己的入口；后台转发本机 Typeless 已配置的 RightOption 不要求用户手动按它。

### 只读验证

直接导入本地 Yoda 的纯解析模块，执行 8 个 Node 断言：明确 hands-free、当前脱敏配置、push-to-talk 回退、空设置、默认回退、左右键码、不支持键、按键释放顺序。全部通过。验证只证明源码行为和上述模式选择问题；未运行原项目完整测试、未执行生成的 AppleScript、未验证录音时延。

## 4. SmartDD 页面设计

沿用已确认的 M6 高保真原型和 CSS tokens，页面中的图标仍用既有 Lucide；原型 Logo 同步已选定的 06 / 70% 版本。

| 位置 | M7 增量 | 保留内容 |
| --- | --- | --- |
| 首页输入区 | AI 配置与发送之间增加小麦克风；唤起中禁用；结果留为草稿 | 原欢迎区、项目／目录选择、配置、提交方式 |
| 任务顶栏 | 停止按钮旁增加语音输入；停止的任务不可输入 | 真终端结构、多标签、停止／恢复、信息面板 |
| 设置 → 语音输入 | Typeless 检测、总开关、听写键、使用准备、全局键、手工覆盖、试用 | 既有设置导航、卡片行、主题和搜索 |
| 设置 → 键盘快捷键 | 增加语音状态和跳转，使用同一份设置 | 原任务快捷键 |
| 原型顶部 | 简短 M7 标识，打开示例状态与跨应用演示 | 不在每个控件上堆功能编号 |

成功提示为“已发送 Typeless 唤起请求”，不表示“已录音”或“已转写”。实际录音状态由 Typeless 显示。原型中的“演示回填”明确用于验证落点，不进入正式产品。

## 5. 复用与补齐

| 工作 | 建议 |
| --- | --- |
| 外部启动 | 复用 bundle id、后台 open、应用名回退；改为受限绝对命令路径与参数数组 |
| 快捷键 | 复用键名归一化、键码表和纯函数分层；重做模式优先级和不确定状态 |
| 页面焦点 | 复用 textarea 选区保存；终端按当前可见 PTY 定位；避免异步完成后抢焦点 |
| 全局入口 | 已查的 `src` 语音链路没有 globalShortcut 注册；SmartDD 用现有 Electron 主进程补齐 |
| 设置 | 复用 SmartDD SettingsStore、Zod、typed RPC、既有 SQLite app_settings 表 |
| 权限 | 辅助功能状态及恢复提示；若使用 System Events，再处理自动化授权。麦克风仍由 Typeless 申请 |
| 生命周期 | ready 后注册；保存／禁用时替换或释放；will-quit 清理；隐藏窗口继续可用 |
| 来源 | 后续实际迁移 Yoda 生产代码时更新 NOTICE、文件头与测试来源；本轮原型未复制它的系统服务代码 |

Yoda 为 Apache-2.0，当前仓库已有 `licenses/Yoda-Apache-2.0.txt` 与 NOTICE。源码引用与调研不应写成已完成生产迁移。

## 6. 后续开发前必须做的三个小验证

1. **G1 模式与系统按键**：在当前 Typeless 上验证一次点击开始、结束和取消；验证 Yoda 脚本语法、真实执行、右 Option/Fn 与权限。若不成立，替换按键适配层，不能继续以 toast 当成功。
2. **G2 后台全局键**：验证按住全局键不连发、释放修饰键后再转发、与 Typeless 键不同、不会递归。Electron globalShortcut 不提供 key-up 回调；固定延时不能证明实体键已释放。必要时用打包的最小 macOS 按键桥读取物理键状态，按超时取消，禁止无条件模拟 release 用户仍按住的键。
3. **G3 冷启动与安装后 App 的系统授权**：Typeless 退出时后台唤起的就绪时间、首次登录窗口、App 实际权限归属、原输入位置。进程存在不等于可录音；未知状态需人工试用。

G1–G3 是后续实现中的可验证任务，不是本轮原型完成的证据。最终需求、接口与验收见 [M7 需求和方案](M7_Typeless语音输入接入.md)。

## 7. 生产适配决定（2026-10-16）

已复制键名／键码映射并补充 NOTICE；后台启动改用 NSWorkspace，页面保留选区与终端 focus。Yoda 的系统脚本只通过编译检查，未把该结果记成真实听写通过。为落实全局键物理释放和发送前 AX 焦点复核，选择 G2 的最小 macOS 原生桥，不引入音频引擎。主进程使用现有 Electron globalShortcut，设置通过既有 SettingsStore 落盘。

按键桥已在 macOS arm64 打包并通过包内启动／架构检查；真实权限、开始／结束与回填验收仍进行中。临时测试包出现应用注册／身份与授权条目不一致的问题，具体排查和未覆盖项只以 [实施记录](M7_实施与验收记录.md) 为准，不将请求发送提示当作 G1–G3 通过。
