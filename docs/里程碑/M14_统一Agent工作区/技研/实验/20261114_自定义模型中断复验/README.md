# Claude 自定义模型与中断终态复验（2026-11-14）

本次修正的是旧实验结论，不是生产代码。使用固定 Claude Agent SDK 0.3.321 与其 darwin-arm64 Claude Code 2.1.321，独立 HOME、合成 token、仅本机模拟 Anthropic 端点；没有调用真实 DeepSeek／Anthropic 服务或使用用户凭据。

## 结果

`custom-model-a1` 使用 `mock-model`，`custom-model-control-a1` 使用 `claude-sonnet-4-6`。同一驱动、相同判定，各 X01／02／04／05／06 共 5 项通过：原文及 UUID、恢复、MCP 环境过滤、原生工具拒绝、长输入队列中断。每组 7 个请求均保留指定 model；各 5 个子进程全部退出，详见 audit.json。没有用已知模型替换自定义组的请求。

自定义组仍输出 `[claude-code:unrecognized_model]`，但正常轮次完成、实际 MCP 调用成功；中断轮次出现与本次输入 UUID 相同的 cancelled lifecycle，随后 error_during_execution、退出码 1 和 SDK 迭代器异常。已知模型对照具有同样中断终态（无该警告）。因此这条警告不能直接当作启动失败，退出码 1 也不能脱离已确认取消事件判定失败。

## 对旧结论的更正

旧 `claude-extra-a3–a6` 原始记录已包含 requesting、模拟端点请求和 cancelled lifecycle；旧驱动将迭代器异常直接判失败。a8 改进了取消判读但只对已知模型复验，不能由此推导自定义模型仍有启动缺陷。本次按同一关联判据完成两组对照。

旧日志与 result.json 原样保留在[此前全局实验](../20261114_全局兼容验证/README.md)，不改成通过；旧 README 中“自定义模型失败”是当时分类，本次证据与[现行验证账](../../全局设计验证账.md)纠正其原因。audit.json 保存旧原始 wire 的 hash、生命周期及结果摘要。

## 可复现与限制

当前驱动固定 root 为本次独立目录。复跑应在新临时目录安装相同锁定依赖（依赖锁见此前全局实验），复制驱动和 mcp.mjs，修改 root 为新目录，不覆盖原结果：

```sh
node custom-model-probe.mjs custom-model-a1 X01,X02,X04,X05,X06 mock-model
node custom-model-probe.mjs custom-model-control-a1 X01,X02,X04,X05,X06 claude-sonnet-4-6
```

原始 wire、请求、stderr 和进程记录 gzip 无损归档，SHA256SUMS 覆盖归档文件。没有保存完整临时 HOME、原生程序或 node_modules。

模拟端点只实现这些检查需要的响应，不严格校验真实供应商的全部请求格式。自定义与已知模型路径还观察到不同的 messages role 结构（见 audit.json）；本次不能证明真实 DeepSeek 接受这些请求、所有模型／子 Agent 路由正确、真实鉴权／限流／代理可用。供应商协议及真实模型验证继续保留，不因本次纠正就宣称 Q03 全部通过。WillYou 生产适配器仍须验证取消事件、输入身份、generation、终态和进程结束的组合，不能吞掉无取消证据的异常。
