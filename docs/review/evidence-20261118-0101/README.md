# M14 W01 修复复核证据

报告：[review-20261118-0101.md](../review-20261118-0101.md)。基线 `90156b90fd2e04796e2d015a1dda11d4d9385163`／`feature/0.1.6`，比较 `eb1748fb1..HEAD`。只新增本轮报告与证据，不改生产、权威账或历史结果。

## 入口与结果

- [baseline.json](baseline.json)：205 个相关文件、HEAD、分支和状态；生产 diff 为空。
- [final-integrity.json](final-integrity.json)：最终哈希／链接核对；[test-summary.json](test-summary.json)：本轮执行命令和边界。
- [original-judge-check.log](original-judge-check.log)：原 13 组检查通过。
- [cdp-preflight.log](cdp-preflight.log)：15 个字面量 CDP 表达式静态预检通过，不执行表达式、不覆盖动态模板。
- [driver-boundaries.check.mjs](driver-boundaries.check.mjs)：直接导入真实判定器、提取真实驱动代码，未改原代码或旧断言。[结果](driver-boundary-observations.json) 7 组中 3 组符合预期，4 组暴露 X01／X02；命令退出 1 是边界反例未通过，不是驱动启动失败。
- [reply-wait.fragment.txt](reply-wait.fragment.txt)、[reply-status.fragment.txt](reply-status.fragment.txt)：原驱动等待／终态片段，完整驱动 SHA 保存在观察值中。
- [fixture-audit.json](fixture-audit.json)：Pillow 独立解码红图，并只读核对原图及 WillYou 私有目录副本。
- [positive-run-db-audit.json](positive-run-db-audit.json)：只读核对已退出的隔离实例数据库，两个回合均 completed，前后数据库 SHA 相同。使用 SQLite URI 的只读 immutable 模式，没有访问日常数据。

边界检查 C01 验证真实保存的正例；C02／C03 是包含 red 的错误答案；C04 是无回答超时；C05／C06 分别模拟第二条回答晚于／早于基线读取；C07 是首轮完成、第二轮失败。C05–C07 在 jsdom 中运行原始片段：轮询替身只对稳定 DOM 做有界判断，未等 180 秒，不计真实 App 或模型结果。C07 为静态可见文字夹具补了 jsdom 缺少的 innerText getter，没有修改产品 DOM／状态。

## 复跑

仓库根执行：

```sh
node --check docs/review/evidence-20261118-0049-fix/driver/attach-judge.mjs
node --check docs/review/evidence-20261118-0049-fix/driver/m14p2-driver-attach-v2.mjs
node scripts/lib/check-cdp-expressions.mjs docs/review/evidence-20261118-0049-fix/driver/m14p2-driver-attach-v2.mjs
node docs/review/evidence-20261118-0049-fix/driver/attach-judge.check.mjs
node docs/review/evidence-20261118-0101/driver-boundaries.check.mjs
```

后续复验请先复制检查脚本到新目录，并更新输出路径／导入基线，避免覆盖本轮历史证据。原 13 组检查脚本只输出 stdout，重定向到新日志即可；`.log` 按仓库忽略规则保留本地，结构化结果和源码可归档。

本轮没有重跑生产测试、启动 App、调用模型或打包；没有改变正式用例通过状态。
