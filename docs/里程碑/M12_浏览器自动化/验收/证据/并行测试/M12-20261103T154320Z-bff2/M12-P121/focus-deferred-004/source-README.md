# T125004 只观察恢复就绪：可执行预检

当前只是工程诊断准备，未启动App/OS/PTY/CLI/HTTP/模型，不计真实R或正式通过。入口 `run.mjs` 硬编码只观察；Root必须给本根新的 `lease.receipt.json`，旧003租约或SOP授权不能作为本次资源租约。精确命令见 `READY.json`。

使用原App022、同一task/profile/native与原privateHOME/CODEX_HOME/auth，不复制/读取auth文件或日常配置。before004保存当前停止DB独立0600字节快照，当前SHA `ced66da236a27d638d3b6d124bdb5d4d6334a77962c1a0cfb183259ece3a6f56`；启动前再次核源与快照，绝不copyback。未来App自己的正常resume/stop会产生run/PTY/设置持久化，这不等于driver直接改DB或恢复快照。

七个原冻结入口及两个传递依赖用显式import/read-only符号链接并固定原SHA，原382输入只引用其Ready索引，不复制全树或before历史。当前save拒写deps与before004。原003、生产、公账均不改。

主入口没有Sender、SOP全文、Enter、canonicalACK/modelphase，也不导入可选probe。启动后检查原profile健康和配置，一次setupreload，原被动精确Native+DOM持续3秒后一次guard，原UI恢复同任务，新fresh真实runplan/Native/cwd/CLI边界确认后，只读15秒逐轮落盘bottom/实际viewport/cursor/Native新设置摘要/每个rejectReasons；timeout或成功前截当前真实终端图，然后原TaskService正常停止及App normalquit，独立准确清场。

运行中的CDP wrapper禁止所有键盘/文本/激活，只允许导航所需mouseMoved/Pressed/Released；RPC仅get/profilehealth/projectsettings/session/browser快照及清场kill白名单。不启动原site/禅道HTTP夹具，不发任何应用CLI业务。若无夹具使freshplan前置失败，保存具体失败和截图并正常清场，绝不偷偷补服务或放宽判据。恢复真实Codex CLI本身是未来PTY预检必需；没有单独CLI探针，也不请求新模型turn。

`composer-probe.mjs` 保留为独立可选函数，无默认调用/执行命令；主图并不加载它。只读结果先交Root判断，后续是否单字符x→真实composer→CtrlU另行分资源，不能据此自动回到SOP发送。

`static-check.json` 7项源代码/VM控制通过，含硬只读门、RPC白名单、sender物理移除、原15秒采样/截图、快照与链接SHA、原合成连接cipher前缀/还原、模拟实际viewport/cursor/多拒绝项；不冒充实际UI就绪。纯控制首次把前缀长度硬写27导致失败，改用expectedPrefix.length后通过，保留preparation-failures。
