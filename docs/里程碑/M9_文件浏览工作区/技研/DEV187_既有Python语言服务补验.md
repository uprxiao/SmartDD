# DEV187 既有Python语言服务补验

2026-10-20，R3.4/P1 D05，Y29部分验证，仍阻塞。正式299/419（71.36%），余120条不变。

本机发现既有pylsp1.10.0，不安装服务；真实隔离App中通过设置登记现有绝对路径，4项A核验定义/引用/hover、中文emoji后的UTF16及能力门控。原源CRLF字节/stat不变，六原RPC handler/spawn恢复，App正常0/null。

自有Python进程实际在关闭预算后SIGKILL；不冒称语言server优雅退出。首轮观察器仅记录clangd/peer而漏记Python导致等待失败，扩展显式绝对命令列表、默认行为不改后完整复跑。

当前已查PATH及限定npm/opencode/npx/nvim位置未找到TS命令，不宣称全机穷尽、也不自动安装。完整Y29仍需TS及原剩余矩阵；原C++/协议证据不重复计数。详见[批次证据](../验收/证据/m9-acceptance-python-language-dev187-r110-20261020.json)。继续其它独立用例，协作最后，未完成/未发布。
