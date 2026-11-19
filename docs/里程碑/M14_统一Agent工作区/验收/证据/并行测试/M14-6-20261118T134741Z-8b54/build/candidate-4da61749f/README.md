# D06-47 隔离候选与回归

macOS arm64，冻结源码 `4da61749fc24f8d05481b6139e276cf6c4afd5b0`。打包附带六项原生自检，按 ASAR 和六个入口／原生文件摘要核对。[打包日志](package-4da61749f.log) · [哈希](package-4da61749f-sha256.txt)

- 相关驱动与渲染端测试 136 项通过，随后新增实际请求面板取消的渲染测试，重跑该文件 60 项通过。类型检查通过。[定向驱动与渲染端](a09-native-request-regression.log) · [最终组件](a09-confirm-ui-final.log) · [类型检查](a09-elicitation-typecheck.log)
- 冻结源四模块广泛回归，默认执行环境 920 项通过、9 条条件跳过。另 5 条本机数据库和 SSH 资源集成因默认沙箱拒绝回环监听而失败。保留原错误，同源同测试文件在允许本机回环监听的 runner 上 8 项通过，其中 3 项为与前轮重复。合并后的唯一结果为 925 项通过、9 条条件跳过，无剩余失败。[首轮日志](a09-frozen-agent-capabilities-regression.log) · [单文件复验](a09-frozen-capability-loopback-retry.log)
- 新包两端真实请求复验。[D06-47](../../M14-G02/4da61749f/A09-elicitation/README.md)
