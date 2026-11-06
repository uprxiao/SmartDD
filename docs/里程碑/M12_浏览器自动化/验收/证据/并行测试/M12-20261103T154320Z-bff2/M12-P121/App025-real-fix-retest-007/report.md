# T125 修复与浏览器复验报告

结论：验证通过。继续处理 Bug #1200「M12_SOP_2d9f7b840ac361e5 T120 总价异常」。同一页面、同一 profile、账号 qa，以单价 10.00、数量 2 点击「计算总价」，总价由修复前 20.01 变为修复后 20.00，与期望一致。

## 修复内容与检查

业务源码 pricing.mjs 第 4 行在换算为分后无条件加 1，形成每次总价 +0.01 的错误。移除该偏移后使用 Math.round(unitPrice * quantity * 100) / 100，保留原有输入校验和两位小数舍入。业务文件仅修改 pricing.mjs；server.mjs、runtime.json、会话设置和界面逻辑均未修改。

通过 node:assert/strict 实际执行 6 个金额用例和 4 个非法输入用例：10×2、零数量、零价格、小数累加、多数量、舍入，以及 NaN、Infinity、负数量和非整数数量。结果全部通过，见 sanitized/regression-results.json；差异见 pricing.patch。

## 本机服务归属及实际重启

旧服务 PID 86282。实际 ps 核对 UID 501、启动时间 2026-11-06 16:32:11 +0800、命令绝对路径；lsof 核对实际工作目录、本项目 node 可执行文件及 127.0.0.1:43547 监听。只读 /__m12/identity 与原 service.pid.json 的 PID、bootId、startedAt、源码信息逐项一致。未停止未知进程。

确认后向旧服务发送一次 SIGTERM，随后核对端口无监听。由本任务工具在原项目工作目录执行 node server.mjs，实际启动新 PID 87548，后台 exec session 28479 保持运行。新服务工作目录和监听端口再次由 lsof 核对，实际页面显示的 pricing 源码校验值与本机修复文件及新服务身份一致。详见 sanitized/service-stop.json、sanitized/service-start.json。

默认 workspace-write 沙箱下 ps、本机身份核验和监听端口分别遇到限制；均按真实工具审批提示处理后成功。没有更改审批或沙箱策略，没有由宿主代重启。首次启动明确以 listen EPERM 退出后才重新启动，没有重发结果未知的写操作。

## 环境、版本与账号

- 测试 URL：http://127.0.0.1:43547/site，浏览器导航与最终页面均已核对。
- 实际宿主：macOS 26.6.1，Build 25G76，arm64；具体硬件型号未核实。
- 实际浏览器：WillYou 内置浏览器，页面 UA 为 Chrome/148.0.7778.280。UA 的 MacIntel / Mac OS X 10_15_7 标记不作为宿主 OS 和架构依据。
- 视口 1000×700 CSS 像素，devicePixelRatio=2，截图 2000×1400。
- 工单记录版本 fixture-v1，修复前/后页面版本均为 fixture-v1；源码校验值已变化并核实，非仅依赖版本标签判断部署。
- 禅道本人列表账号 tester；站点所需及实际页头账号 qa。续轮开始页面为未登录状态，使用原工单演示凭据经 --stdin value 在原 profile 重新登录；重启后该登录态继续有效。
- 原 pageId：50893193-0384-4688-aa85-eba863c51e63；原 profileId：de33ca6b-a892-4f1e-b521-2fe3ead8ca45（M12-T120-reproduction）。tab list 与上一轮 handoff 逐项一致，未新建或切换 profile。

## 浏览器复验步骤与对比

1. 重启前在原页面/profile 确认页头账号 qa。
2. 重启完成后 capture start，刷新同一 URL，wait「当前账号」并 snapshot，确认 qa、单价 10.00、数量 2 和新源码，总价初始为「未计算」。
3. 按本轮 snapshot 的不透明引用点击「计算总价」一次，回执 completed；wait 20.00 后重新 snapshot。
4. 实际总价 20.00，期望 20.00；console 仅有「M12 synthetic calculated 20.00」，无 price mismatch 错误；单独 network 调用确认浏览器 GET /site/api/total 状态 200。
5. 本轮独立执行 screenshot、console、network、capture start/stop 并核验成功回执及实际截图/HAR 文件。未直接请求计算或登录 HTTP 接口替代浏览器操作；直接 HTTP 仅用于停止前只读服务身份核验。

| 项目 | 修复前 T120 | 修复后 T125 |
| --- | --- | --- |
| 输入 | 单价 10.00、数量 2 | 单价 10.00、数量 2 |
| 页面账号 | qa | qa |
| 版本标签 | fixture-v1 | fixture-v1 |
| 实际总价 | 20.01 | 20.00 |
| 期望 | 20.00 | 20.00 |
| Console | price mismatch | calculated 20.00，无错误 |
| 截图 | ../T120-20261106/reproduced.png | verified.png |

## 本轮证据与真实回执

| 能力 | requestId | effectState |
| --- | --- | --- |
| screenshot-verified | f8417506-7a32-49bf-a540-45d835cf8d50 | read-only |
| console-verified | 3ad99349-fba6-46c0-b132-af9e2bba7298 | read-only |
| network-verified | 6101bb14-3b7b-47c4-b23e-9627b0c79f1c | read-only |
| capture-start | 11a944d4-826d-4433-83f2-6a9e86eb0a47 | completed |
| capture-stop | 0ac5a31c-51b7-4542-acdc-b5419bda14f2 | completed |

交付路径均相对本报告目录：

- 计算后截图：verified.png；原始截图与 HAR 路径、字节数和文件校验见 sanitized/evidence-manifest.json。截图已查看，页头 qa、输入及 20.00 清晰可见。
- 脱敏 console：sanitized/console-verified.json。
- 脱敏独立 network：sanitized/network-verified.json；宿主网络记录含重启前的登录请求，认证头、Cookie、登录正文均已省略。
- 脱敏 HAR：sanitized/capture.redacted.har（本轮 capture start/stop 对应文件）。原始 HAR 保留在任务私有 artifacts 路径，没有覆盖；原始文件校验值不冒称脱敏副本校验值。
- 页面前后核对：sanitized/snapshot-before-restart.json、sanitized/snapshot-ready.json、sanitized/snapshot-verified.json。
- 环境：sanitized/environment-browser.json、sanitized/environment-host.json。
- 服务、回归、脱敏检查：sanitized/service-stop.json、sanitized/service-start.json、sanitized/regression-results.json、sanitized/redaction-check.json。

本轮源文件整段读取曾将演示凭据行带入工具输出，已在会话中说明；交付报告和诊断副本均已检查不含演示密码、Cookie 值或令牌。未读取 WillYou 运行凭据或本项目外的认证数据。

当前原页面保留在 qa / 20.00，原 profile 与新服务均保留。禅道仍只读，未修改 Bug 状态。
