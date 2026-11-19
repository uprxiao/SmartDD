# A32 082 宿主业务在途时独立原生审批，普通目录完整交槽

冻结候选 b82556cbc74646ec7ab2dfe9defc70a4e305ebac，ASAR SHA-256 898f908c7b2340262358d2adab2f1ade01eb14da46c796352bc668d7a59792fd。macOS arm64，Codex 0.169.0、Claude 2.1.326。真实 Chrome 调试操作隔离的打包 Electron App，合成模型只监听本机回环。业务插件无连接或凭据，唯一写入是本轮私有凭证。

- 真实批准一次宿主业务，插件 PID 29831 与原 Claude PID 29698 的启动身份均独立核对。业务仍 executing，父派出两个真实写子，关闭待发第二子后首子保留。
- 在实际面板 2/2 打开对应原生 Bash 请求 aa9018ad…。当前命令匹配，批准 DOM disabled=false，真实点击批准及确认后原生 Bash 实际执行；该时刻原业务独立 fcd022c8… 仍 executing。该子判据关闭 [081 问题](../../e17b6c79e/A32-business-red/README.md)。
- 父接 queued 后写实际文件并自然结束前台。精确原 Claude 和插件仍活，首写子仍 queued、没有任何原生 run。插件收到隔离 operationId 门闩才正常回执。原业务 request.resolved 为持久事件 52（21:25:29.399 UTC），目标子 directory.acquired 为事件 59（21:25:29.504 UTC），原父 owner 已结束。业务操作仅一次且副本哈希保持。
- 首个写子在同 cwd 的唯一 active 槽，读父文件后写子文件。真实父后续输入仍排队直至子实际退役。父以同 binding、同 Claude nativeId、新代次实际读到原子文件内容 A32_CHILD_BYTES，结果也回原逻辑父任务。父、子和已取消的子状态均在真实界面取证。
- PID 29510 退出 0，renderer 无错误、没有清场动作，关闭后 3425 端口和候选包均无进程。

[完整结果与 DOM 守卫](attempt-082/result.json) · [业务和进程事件顺序](attempt-082/readonly-native-business-order.json) · [审批后真实命令在途](attempt-082/15-native-parent-tool-holds-child.png) · [业务未结束子仍排队](attempt-082/40-ongoing-business-holds-writing-child.png) · [原父回读](attempt-082/30-parent-reads-child-file-after-resume.png)

三类目录双向六组的其余证据见 [075–076](../../15be1a81e/A32-recheck/README.md) 和 [078–080](../../e17b6c79e/A32-matrix/README.md)。范围只计本机合成模型下的真实 App、操作与原生执行器。 [SHA-256](SHA256SUMS)
