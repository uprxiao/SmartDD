# A37 的新包回执与停止复验

- 原生 Codex 在隔离包 e17b6c79e 真实执行 CLI。观察授权后先读取本机目标页并使用真实控件引用。普通网页写调用返回 code 0 和带能力标识、requestId、operationId 的等待用户回执，初始回执明确为首次申请。批准前没有业务执行或浏览器 click 审计。用户通过真实面板批准后，原请求同一 operationId 的独立通知报告 SCOPE_DENIED、not-started，且无目标 pageId。宿主没有开始点击。[等待用户](02-ask-pending-before-human-approval.png) · [批准后的业务拒绝](03-ask-later-host-denial.png)。
- 105 的 Ask 驱动在最终断言漏列初始回执的 state 和 duplicate 字段而标失败，原始输出保留。只读复核脚本严格核对完整 JSON、原始 SQLite 回执、业务身份和执行前后界线。D06-40 的产品反例已复验。[原始结果](result.json) · [只读核对](verify-phases.py) · [核对结果](verified-summary.json)。
- Stop 场景已通过真实控件：控制申请提供相应选项，停止作废挂起请求和既有观察权，故意注入的旧修订批准被拒；页面所有者仍能用原合成登录态浏览。[停止前](02-control-options-before-stop.png) · [停止后](03-browser-usable-after-stop.png)。
- 完全访问前置未完成，驱动没有发出浏览器写调用，待补。父子申请、SVN 等待绑定跨重启和 M15 无人值守判据仍待验。隔离 App 正常退出，回环监听关闭。[退出记录](cleanup.json)。
