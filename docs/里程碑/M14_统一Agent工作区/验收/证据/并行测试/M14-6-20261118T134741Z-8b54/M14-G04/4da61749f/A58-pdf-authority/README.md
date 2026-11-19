# A58 PDF 预览与 Agent 权限

2026-11-19，新加坡时间，macOS arm64。成功批次 134 使用冻结候选 `4da61749fc24f8d05481b6139e276cf6c4afd5b0`，ASAR `39351e634975433afb8034cda4e3a387fbd534b3f982ad56b3f88e062864dbc4`。隔离 HOME、私有合成 PDF、实际 Claude 请求批准档与独立本机模型/MCP。

- 131 在旧候选 `e779d4e17` 实际收到 Claude 的第一个真实只读工具回执。夹具从 RPC 外层读取任务身份失败，尚未点击 PDF。App 正常退出。[原始失败](attempt-131/result.json)
- 134 通过实际界面普通点击打开与首包 002 相同 SHA 的合成 PDF。原 PDF.js 展示第一页标记，可信 renderer 获同代文件的私有协议，在本机实际读回 56,519 字节。源文件不变。[预览、活动 Agent](attempt-134/01-pdfjs-render-and-active-run.png)
- 同一 Claude 请求批准档 run 在点击前、预览中、实际第二次只读 MCP 回执后，公开 Agent 与业务授权、数据库绑定、冻结计划、96 条 allowlist 和桥身份均一致。两次真实调用对应不同 call ID，44 个可用工具 schema 一致，没有给该 Agent 预览协议或引用。隔离 App 退出 0，原生进程、桥和私有端口已退出。[原始结果](attempt-134/result.json) · [逐项核查](verified-134-pdf-authority-green.json) · [退出](attempt-134/quit-phase.jsonl)

A58 的系统真实修饰键与外部编辑器接收仍待独立取证。
