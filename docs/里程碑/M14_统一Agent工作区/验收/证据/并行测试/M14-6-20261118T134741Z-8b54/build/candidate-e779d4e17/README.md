# D06-46 隔离候选与回归

冻结源 `e779d4e1703b2de07789175422ddb3b3ceafe189`，macOS arm64。ASAR、入口和随包原生组件摘要均复核一致。打包附带六项原生自检通过。[打包日志](package-e779d4e17.log) · [校验清单](package-e779d4e17-sha256.txt)

Agent 和文件渲染端批次 1,312 项通过、675 项条件跳过。共享执行环境中的文件保存 I 测试四例未生成私有保存记录并报 ENOENT，其他测试文件通过。[保留首轮日志](renderer-with-files-sandbox-red.log)

同一冻结源码下，用产品原有 macOS 保存隔离配置在允许启动嵌套原生沙箱的环境中复跑同一测试文件，生产文件未改。四例均通过，独立写者、受保护替换及回执均保留。合并此定向复验的唯一数为 1,316 通过、675 跳过、无剩余失败。[定向复验日志](a39-native-four-case-host.log) · [实际文件与回执](a39-native-four-case-host.json)
