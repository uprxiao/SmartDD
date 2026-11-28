# A51 下一次合法独立系统通知试验（只读结论，未执行）

**当前缺项是独立 QA 的真实系统通知可授权性／专属点击路由，不是重新跑完所有已有业务。** C27 当前仍只有正式 ID 的标准包证据。C22 独立 QA 的实际 ID 为 com.smartdd.desktop.qa.m16-notifications；四个 Helper ID 同一前缀、主名与真实 Helper 文件一致，正常 LaunchServices 精确启动已成功。真实后台发送后 5ms 系统 failed；随后本人确认准备好，实际 UN 授权请求返回 UNErrorDomain 1、granted=false、前后均 notDetermined。系统设置没出现独立项是观察事实，不等同于已知注册政策或本人主动拒绝。C21 原同 ID 点击误唤起／双实例红、真实等待/成功等已绿子项照旧保留。

**本轮新增判别依据：** 两包真实 Electron 42.11.14、实际 ScheduleNativeNotifications 编译类同字节；C22 QA 与 C27 标准包均深度验签成功但为 ad-hoc、TeamIdentifier 未设置。Electron 从 [v42](https://releases.electronjs.org/release/v42.0.0) 使用 UN 通知并要求代码签名，[签名文档](https://www.electronjs.org/docs/latest/tutorial/code-signing) 说明 ad-hoc 可能造成系统框架行为不一致；[Apple 的错误定义](https://developer.apple.com/documentation/usernotifications/unerror/notificationsnotallowed) 只证未获准，未公开具体拒绝策略。**因此正规有效签名是最值得单变量补验的前置，不是已经证明的拒绝根因。** 不能据此断言必须 notarize 才有本地通知，也无证据要求 APNs 能力。

## 最短下一试验（此处不运行）

1. **必要外部前置：** 由有授权的签名发布流程／证书所有者提供一个稳定 QA bundle ID 的合法 C27 QA 包（同 C27 asar/native，独立 QA 显示名与 Helper ID 一致，Apple 正常签名身份及 Team、严格验签；非商店分发按 [Apple 正常签名与 notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution/) 流程）。不索取或读取私钥/凭据，不以关闭安全功能加载外置 probe。已有独立 QA Mac/账号优先；否则只在已有合法隔离条件的当前用户下走 exact QA 路径、原私有 HOME/userData 和已证独立应用存储前置；若正式通知条目/存储身份不能区分，停止。**不存在这样的签名产物或测试环境就暂留缺项。**
2. 本人确认新系统时段后，用正常 LaunchServices 精确启动该 QA（不是安装或启动正式版），核实际 PID/绝对路径/bundle/唯一实例。只在该签名 QA 自身进程使用 [公开 UN 授权 API](https://developer.apple.com/documentation/usernotifications/unusernotificationcenter/requestauthorization%28options%3Acompletionhandler%3A%29?changes=lat_2__8_1__5&language=objc)；如需探针，须提前作为该 QA 合法签名的测试组成，不改变生产授权。读 fresh settings，若 notDetermined，一次明确实际授权请求并让本人选择；必须系统真实返回 granted 且新鲜 [authorized/alert setting](https://developer.apple.com/documentation/usernotifications/unnotificationsettings/authorizationstatus) 和可辨识 QA 条目。若仍错误1、不弹窗或拒绝，记录 OS 回执正常退出；不重置、轮换 ID、用临时授权或私有 API 绕过。
3. 只有授权绿才先走原 **派发前失败／无 turn** 一个真实后台通知（C21 原精确业务夹具）；保存真实 native show／送达与本人实际通知点击，验证只激活该 QA 同身份，进入原 run 详情。后续集中补原仍缺的 accepted-failed 路由、无 run 修复入口、归档／不可用目标，以及只对可明确识别的 QA 条目实际 off→应用内回退→恢复。系统许可操作按 [Apple 标准设置](https://support.apple.com/guide/mac-help/mchl205da693/mac) 仅该 QA；无人参与/OS未许可不算通过。

证据清单见 evidence-list.json（原合同、历史真实红绿、实际包公共签名/身份、官方资料）。本轮只读，未打开应用、查询/变更日常系统记录、注册、权限或签名材料；A51 保持未完整验收。

