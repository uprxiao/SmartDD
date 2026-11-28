# 最后集中补验：A08 真时区 / A27 真睡醒与绝对时间

## 当前结论和复用

- 原 A08 已有 C10 真实保存、自然领取和不同历史预览；C21 实际同根 P1 自然完成、P2无记录，原用户明确延期实际改时区，因此 S 未执行。原提前2.395秒结束的200s私有夹具红保留。新脚本自然等待按实际 due 还剩多少时间、再加真实结算窗口，不假造经过时刻。
- 原 A27 C14 真实业务服务/SQLite注入钟、宽限内外及去重仅 I；实际 OS suspend/resume、真实绝对时钟前跳/回拨及自然再次经过仍缺。
- C21 原完整实际 driver 初轮及续轮、24个档案 SHA 均核；原 A08 的临时 remainder-model-fixture 未直接归档。新入口复用同 C21 已执行伴随 fixture 的 Codex 响应 SSE 和 provider probe，限制为时间用例原 marker，无一般工具调用和外部地址。不声称原 A08 fixture 字节级恢复。保持实际0.169.0原生版本和 shipped adapter 正常检查，全新隔离App。
- 当前仅静态准备。preflight.json SHA256 83dac7cdd00e72bc06afc22299e662cd0a1c875e0b3e9adf4e3d464ed915ec6c。30项实际原档核对/静态路径、时间与假数据正负检查；11个源 pin；C28精确资源、已核验 native CLI、adapter 和 source-and-package pin。没有启动App、目标CLI、模型、监听或修改系统设置。

## 协调者入口

仅在用户明确同意对应真实系统操作，桌面/其他测试均释放后，从仓库根，三个命令**分别用 PTY 并且串行**。每组新独立根，完全结束、实际原设置恢复、正常退出和独立清场后才启动下一组，不需要重复构建。

    node release/m16-qa-support/b11-recovery/a08-a27-system/driver.mjs --run-approved --group A08-zone --authorized-person-zone-change

    node release/m16-qa-support/b11-recovery/a08-a27-system/driver.mjs --run-approved --group A27-sleep --authorized-person-sleep-wake

    node release/m16-qa-support/b11-recovery/a08-a27-system/driver.mjs --run-approved --group A27-clock --authorized-person-absolute-clock-change

静态复核：

    node release/m16-qa-support/b11-recovery/a08-a27-system/preflight.mjs

    node release/m16-qa-support/b11-recovery/a08-a27-system/driver.mjs --preflight-only

静态不会启动实际产品/CLI。程序打印 system-private-root、private-real-app-ready 及下面本人操作的准确 handoff JSON。协调者按实机状态转告用户；仅用户实际确认后向本轮专属 PTY 发送相应 token 加换行。不得自动发 readiness/restore-confirmed，不以该 token 代替实际系统事件。本人无须在五分钟内持续盯住 App，纯 Electron UI 由原绑定 CDP完成。

## 给本人的一次集中说明及操作顺序

请先准备另一台真实且时间准确的设备作参照。记录当前 Mac“日期与时间”的两个原自动开关（自动设日期/时间、按位置自动设时区）和实际时区、正确时间。原 C21 当时为 Asia/Singapore +08:00、自动日期时间开、自动时区关；**本轮以你现在的实际原状态为准**。如果现在原始时区不是 Asia/Singapore，先只读停下，不直接改成该区凑用例。若系统需要管理员密码、触控ID、系统权限，本人直接在系统界面完成，不在聊天发送。

预计顺利时总共6个物理动作（每组2项），不会由 Agent 改系统。

### 一、A08 时区改动和恢复（约8–9分钟自然时间）

| 实际程序信号 | 用户或协调者动作 |
|---|---|
| A08-person-ready-zone | 用户确认已记录原设置、准备好。仍先不要改时区。协调者输入 ready。 |
| 原 P1 自然领取，约3–4分钟 | 无需操作。实际原绝对时间领取一次，另一计划没有历史。 |
| A08-person-ready-switch | 用户确认可立即切换但先等创建计划。协调者输入 switch-ready。 |
| A08-person-change-zone-now | **本人动作1**：只改变系统时区到 Asia/Bangkok（UTC+7，曼谷）。不改绝对日期/时间、不睡眠。保持到恢复提示。Windows/Linux设置不在本次；Mac使用系统设置实际允许的正常界面。 |
| 精确系统时区观测、原同墙钟历史过滤和绝对 UTC 一次性自然到期 | Agent自动读取实际App并验证，不需点界面；原执行时刻为 handoff 中 onceUtc。 |
| A08-person-restore-original-zone | **本人动作2**：恢复原 Asia/Singapore（UTC+8）及上述两个自动设置的原状态。 |
| A08-person-confirm-original-setting-restored | 驱动已观察真实原时区恢复、绝对时钟未变化；本人确认原自动设置也恢复。协调者输入 restore-confirmed。 |

原五计划全部真实核对，固定 UTC/interval/once 的绝对时点不受改区；已领取同墙钟键不重复、未领取和新建实际预览各合规。真实 once 发生且同绝对 due。本人确认只用于自动系统设置还原；实际时区/时间由产品只读观测验证。

### 二、A27 真睡眠和真唤醒（约4–5分钟）

| 实际程序信号 | 用户或协调者动作 |
|---|---|
| A27-person-ready-sleep | 确认可让整个Mac真正睡眠、用另一台设备看时间且自己唤醒。协调者输入 ready。 |
| A27-person-sleep-now | **本人动作3**：立即使用系统“睡眠”（不是锁屏或仅关显示器）。Driver 给出 dueLocal、dueUtc、wakeUtc；目标是实际 due 后20–40秒。 |
| 对照外部准确时钟到目标时刻 | **本人动作4**：本人正常唤醒Mac。不要让Agent、定时唤醒或自动脚本唤醒。 |
| 原产品实际记录 | 无需再点。Agent观察同App实际 powerMonitor suspend/resume、宽限10一次真实成功、宽限0一次实际skip且无任务/回合/模型，实际 claim/start 不发生于睡眠时段；真实 UI 历史保存。 |

### 三、A27 真绝对时钟前跳、回拨恢复及自然再次经过（约3–4分钟）

仅在用户确认可以暂时调整系统时间、其他时敏工作已准备、仍能在原真实 due 之前恢复时开始。

| 实际程序信号 | 用户或协调者动作 |
|---|---|
| A27-person-ready-absolute-clock | 确认原自动同步、原时区和外部准确时钟已记录；准备修改和马上恢复，仍先不改。协调者输入 ready。 |
| A27-person-clock-forward-now | **本人动作5**：只在系统设置里将实际绝对时钟前移约5分钟，使它超过 handoff 的原 UTC due至少5秒；时区不变、不睡眠。手工关自动同步若系统要求，记住恢复。 |
| 原一次性真实完成 | Agent观察真实墙钟与单调时间差超过1min、原一次真实任务领取及回执。 |
| A27-person-restore-clock-now | **本人动作6**：立即用外部准确时钟恢复正确绝对时间、原自动同步及原时区，**必须在原自然 due 之前恢复**。否则不能证自然再次经过不重复，脚本不延长或重做。 |
| 原 due 自然再次经过+10秒 | Agent实际观察自然再次经过；同原 occurrence/turn 唯一、无另一模型调用。 |
| A27-person-confirm-original-setting-restored | 用户确认两个自动设置和原时区均恢复，协调者输入 restore-confirmed。 |

三个用例中的 UI 保存、编辑、查看和暂停均由原测试驱动完成；只交给本人不可代办的系统动作。预计总16–20分钟，人与冷启动、自然分钟边界、实际结算时间造成少量差异。没有压缩睡眠或设伪系统时钟。

## 中止与证据

- 尚未改任何系统设置时，用户可以取消 readiness（向本轮PTY发送 cancel）。如果已实际改过时区/时间，必须本人恢复；脚本在操作前持久化 person-restoration-required.json，并在实际观察恢复及本人确认自动设置后才清除。即使App崩溃、用户取消、系统观察失败，也留下原状态及恢复待办；不会自动执行系统写入。实际未恢复/无法验证时最终 restorePending:true、退出非零，禁止开始下一组。
- 每组失败的正常退出、原失败点、实际 UI/系统时间/电源回执独立保存，不能用换时间或重放人为通过。
- 每个实际根 a08-a27-c28-system-XXXXXX /private/tmp 私有 HOME、data、project，原真实产品设置不改、无真实凭据。留存 metadata、driver.snapshot、actions、initial/final-real-system-observation、各 A08/A27 原实际步骤 JSON/截图、observer-removed、fixture-result、私有 closed DB/known runtime birth/loopback 清场、normal-exit 及 result.json。只有 actualGroupPass:true、restorePending:false 且 independent-cleanup.json clean:true 时才交协调者按原合同归账。实际无新测试通过时不能改主账。
