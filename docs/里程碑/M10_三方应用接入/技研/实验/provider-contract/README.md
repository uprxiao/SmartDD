# Provider 契约纯合成实验

2026-10-17。依据：[需求 R1.3](../../../需求.md) M10-R09；对应[多应用与 Jenkins V2](../../多应用适配与Jenkins扩展方案V2.md)。全部定义、操作名、身份、URL、状态和数据均为设计用合成样例，没有加载生产适配器、读取凭据、安装依赖或请求外部服务。

执行：

```sh
python3 docs/里程碑/M10_三方应用接入/技研/实验/provider-contract/provider_contract_probe.py
```

实际：Python标准库，14项通过、0失败、0网络调用。结果见[report.json](report.json)；机器可读设计样例见[registry-candidate.json](registry-candidate.json)；执行输入为[provider_contract_probe.py](provider_contract_probe.py)。结果文件记录脚本SHA-256，可用脚本重建；未运行SmartDD应用测试或真实服务验收。

| 检查 | 实际覆盖 |
| --- | --- |
| PC-01–02 | 三种provider共用注册外壳，重复ID／未知contract版本被拒绝 |
| PC-03–04 | 三种读取走相同权限及schema入口；额外字段、错误类型、未声明动作被拒绝 |
| PC-05–07 | 调用者只读提示不能把外部写改成读；当前撤销生效；只配本地读取不获得发送后端 |
| PC-08–09 | 原始folder分段编码、边界范围；同源context下的精确队列Location；越界／歧义输入被拒绝 |
| PC-10–12 | queue接收、build关联、终态、未知和取消请求区分；三类写操作无通用自动重试 |
| PC-13–14 | 合成配置复制迁移／未来版本拒绝／opaque secretRef；资源任务绑定、撤销和字节预算 |

边界：schema只实现object／string／required／additionalProperties／enum子集，不能用于生产JSON Schema校验；没有真实HTTP、数据库事务、日志字节游标或完整迁移实现。folder实验故意拒绝带斜杠／百分号等复杂item名，不代表已兼容Multibranch分支编码；队列／取消为合成状态，不证明服务端行为。禅道动作和认证名称是契约占位样例，不能替代biz13.0接口确认。邮件发送样例没有选择或证明任何发件通道。

没有重触发实现；本地intent不能提供远端exactly-once。后续真实应用验收需分别覆盖目标版本、插件、权限、资源和异常恢复。
