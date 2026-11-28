# 2026-11-27 凌晨续验：已有真实证据的调用链与环境复核

本记录是对既有真实数据和生产源码的只读复核，不是新增真实主用例通过。C22 旧候选的结论原样保留；C23 的生产改动另见本目录源码回归记录。

## B03.5：普通后台点击的实际时延分解

对五组已正常收尾的独立合成页面测试，按本轮实际请求 ID 与所属运行唯一配对 CLI 回执、应用调用、外层浏览器执行审计和实际操作回执。以下均为各组真实 10 次后台点击的阶段中位数（ms）；中位数分别计算，不能逐列机械相加。

| 场景 | 用户端原测耗时 | dispatch→invocation | invocation→外层审计开始 | 外层审计总耗时 | 审计完成→invocation完成 | invocation完成→typed |
|---|---:|---:|---:|---:|---:|---:|
| C10 历史配对 | 781.25 | 388 | 348 | 61.5 | 113 | 21 |
| C22 真实系统切换（高负载） | 1892.9 | 834 | 811.5 | 150.5 | 245.5 | 34 |
| C22 静态窗口（高负载） | 1828 | 795.5 | 776 | 141 | 249 | 34.5 |
| C10 同机对照（高负载） | 1944.5 | 882 | 813.5 | 139.5 | 251 | 38 |
| C22 静态窗口（相对低负载） | 915.85 | 439 | 401.5 | 70 | 130 | 24.5 |

统一使用外层审计；实际页面点击内部回执的各组中位数分别为 47.5、114、107.5、106、55 ms。低负载组的 55 ms 不是整段 browser 审计，外层为 70 ms。约 79–80% 的配对耗时发生在执行审计前。高负载旧包也变慢，不能认定当前 F36 新宿主是特有回退；也不能以低负载静态窗覆盖真实系统切换的红项。未查实哪个授权/资源协调步骤存在可安全消除的主要耗时，不依据静态猜测删减身份、即时授权或锁保护。下一次实际低负载系统切换仍使用原同一轮 3/10/3 和严格中位数 <1s 判据。

原始证据：[C10 历史](../candidate-10-native-b03-paired/result.json)、[C22 实际系统切换](../candidate-22-notification-ownership-and-cold-paint/B03-system-transition-performance-red/evidence-index.json)、[C22 暖对照](../candidate-22-notification-ownership-and-cold-paint/B03-warm-control-current-candidate/evidence-index.json)、[C10 同机对照](../candidate-22-notification-ownership-and-cold-paint/B03-contemporaneous-C10-old-candidate-control/evidence-index.json)、[C22 低负载真例](../candidate-22-notification-ownership-and-cold-paint/B03-low-load-real-warm-pass/evidence-index.json)。

## A51：真实通知独立身份

原实际独立 QA 包的 macOS 公共通知 API 返回 `UNErrorDomain` / `NotificationsNotAllowed`（code 1），独立身份请求前后均 `notDetermined`、`grantedByOS=false`。没有证据仅凭权限状态确定更深系统策略，不能将实际拒绝当作产品路由问题或成功授权。本机当前不存在不改变系统权限且能完成正向真实授权的已获授权路径；需要合法独立测试身份/正确签名和正常系统授权环境。现有真实等待、成功通知、偏好和关闭系统回退证据保留。原证据：[独立权限请求](../candidate-22-notification-ownership-and-cold-paint/A51-QA-real-OS-authorization-refused/index.json)。

## B09.2：仍可自主执行的真实范围

普通真实 1440×900 界面状态可用精确隔离候选的后台 UI 驱动复验；已记录的实际配对及适用源范围保留，未覆盖原 key 不由代表图推断。1920×1080 的外屏实际可用普通窗口高度曾仅为 1050px，完整真实窗口尺寸必须有足够工作区或实际原生全屏。后者需要安排系统前台，不使用缩放、模拟尺寸或重采样替代。真实系统授权和操作仍按原合同，未计划绕过任何权限。完整 57×8 矩阵尚未完成。
