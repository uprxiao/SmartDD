# CodeAgent 与 Provider：现状与参考源码核对

日期：2026-11-10。用户已确认该需求作为 F29 纳入 M13；需求规则只在[阶段需求](../需求.md)维护。此处记录只读源码观察，不代替正式技研和实际兼容性验证。

## WillYou 当前事实

当前 `AiProfileInput` 把 runner、可执行路径、env、args、名称和默认项放在同一配置；`AiProfileService` 在运行前解析并解密环境值，首页按配置 ID 创建任务。目前本机工具检测已有 Claude Code／Codex 的基础，不需要为新界面重做全部检测。尚无与该结构分离的通用 Provider 管理和组合选择模型。

来源：[配置结构](../../../../src/shared/ai-profiles.ts)、[服务](../../../../src/main/core/ai/ai-profile-service.ts)、[设置页](../../../../src/renderer/views/settings/ai-profiles.tsx)、[首页](../../../../src/renderer/views/home-view.tsx)。

## Magpie 本地源码事实

本轮只读 `/Users/liubu/hx/3.GitHubProject/magpie`，HEAD `60f0433d1b1d500a9939eced3dfe6c54232051af`，七份核对文件在该 checkout 无未提交差异；哈希见[源码依据](Magpie本地源码核对_20261110.json)。未启动 Magpie、运行测试、读取用户实际供应商文件或凭据。

- `internal/agent/agent.go` 区分工具检测及其可配置字段；检测可能依据程序、配置目录或账号等线索，不能简单等同于命令已验证可执行。
- `internal/provider/provider.go` 的 Provider 保存身份、图标、账号／密钥、多个协议端点、模型等。配置页选择的供应商与实际 API 协议不是同一概念。
- `docs/subsystems/gateway-routing.md` 说明本地网关处理上游选择和协议转换；因此截图中的跨供应商能力并非只靠 UI 和环境变量完成。
- `docs/subsystems/agent-wiring.md`、`internal/agent/claude.go`、`internal/agent/codex.go` 显示它会按不同 Agent 的格式连接网关，记录已写入内容、检测外部漂移，并提供断开恢复。不能把此实现直接当作 WillYou 必须全局改写 CLI 配置的决定。

参考价值：分离工具、供应商与模型；简化常用表单；把不同 Agent 的接入差异放入适配层。尚未证明这些源码可直接迁入 Electron／TypeScript 项目，也没有验证截图所示任意账号或任意模型组合。

## 后续技研要解决

先确定首批 Agent／Provider 及其协议、原生登录／API 认证边界和实际工具调用能力。比较原生直连适配与受管本地网关两条方案，明确是否需要协议转换；不能用“OpenAI 兼容”一个标签替代 Chat Completions／Responses、流式、工具调用等实际契约。参考软件的多账号轮换、额度统计、复杂路由和全部供应商列表尚未纳入已确认范围。

用户截图 08–12 为实际界面／功能参考，来源见[清单](参考截图/来源与哈希.json)。其中 Magpie 截图不是 WillYou 已确认的设计原型。
