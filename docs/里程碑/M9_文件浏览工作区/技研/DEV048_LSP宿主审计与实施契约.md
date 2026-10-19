# DEV048：LSP 宿主审计与实施契约

2026-10-18，依据 R3.4 R05.9/R05.13/R08.2、Q01–Q04、Y29 与[开发前07](开发前_07_文件终端与扩展接入.md)。原 I07 已授权范围内缺项；主代理已授权实施，不扩展为补全、重构、格式化、执行命令或任意 workspace edit。

## 开发条件审计

- 生产代码没有语言服务配置、LSP RPC/宿主、hover/语义结果或导航历史。原型 P17 只有定义/引用示例与模拟符号结果，明确写“示例，不执行语言服务器”；不能把它算生产功能。
- 当前 `../yoda` 不存在，未以其他未知目录替代；无法声称这次重新核验或复用了 Yoda 源码。
- 本机 `/usr/bin/clangd --version` 为 Apple clangd 21.0.0。以隔离临时项目、独立 HOME 和关闭后台索引/配置的启动参数完成 initialize、含 emoji/CRLF 的 C++ didOpen、UTF-16 列定义与 hover、shutdown/exit；原字节不变，退出码0。仅供给/协议探针，不是生产或 App 验收。
- PATH、历史 `/tmp/m9-lsp`、`/opt/anaconda3/bin/pylsp` 及 Homebrew 常见命令路径未找到 TS/Python LSP。VSCode 自带 `tsserver.js` 是 TypeScript 服务，不等于 LSP 供应；不把它直接冒充 typescript-language-server。未遍历个人全部文件，不宣称整机绝无其他安装。
- 现有 lock/安装树含 Microsoft `vscode-jsonrpc 8.2.0`、`vscode-languageserver-protocol 3.17.5`，来源 Mermaid→Langium 的开发依赖。正式使用改为明确直接依赖并更新来源声明；不依赖偶然传递路径。JSON-RPC reader 本身不替产品提供本次帧上限，需在接收边界加上限。
- 旧 TS/Python/clangd17 实验只作历史复用依据。旧客户端的 header/body 累积、JSON异常和退出清理需要生产处理，不能直接拷入冒称可用。当前原生 FileService/root lease、EditorView UTF-16 状态、能力配置持久化方式与进程组清理策略可复用。

[本机实际供给与 clangd 探针、脚本及哈希](实验/lsp-local-audit-20261018/hashes.json)。协议采用已有3.17基线；官方规范要求 Content-Length 字节帧及初始化能力协商，[官方3.17源文档](https://raw.githubusercontent.com/microsoft/language-server-protocol/gh-pages/_specifications/lsp/3.17/specification.md)。本批不自动安装语言服务器。

## 最短实施顺序与边界

1. **受限配置/宿主**：独立 shared schema 与 main `lsp/` 模块；显式语言/项目配置已有可执行文件，默认未配置。调用者仍经既有可信 owner/FileRef/root lease。只公开状态、open/change、hover、definition/typeDefinition/implementation/references、cancel/close；拒绝服务端 applyEdit/executeCommand 等写路径。
2. **传输/生命周期**：1MiB frame、初始化10s/请求5s/关闭3s；限制header、积压和诊断；按会话/文档版本取消和丢弃旧回包。服务自成进程组，正常 shutdown/exit，超时/崩溃释放请求与自有进程。能力和失败必须可见，无配置继续源码浏览/基础高亮/外开。
3. **位置与安全供应**：UTF-16与实际 EditorView一致；只接受握手能力，验证 Location/LocationLink，归一化 canonical URI 别名，目标通过根内文件服务核身份。根外/任意scheme不能变成可编辑授权文件。不因收到语言服务结果自动改原文。
4. **原型/实际入口**：在既有内容菜单/代码编辑器接入，保留终端交接菜单；0/1/101条结果、按kind/100项分页；hover首300ms、移开100ms、null最多两次500ms重试；内容/文件/根/焦点变更取消。后退/前进只影响正确文件surface，不抢终端。
5. **验证**：真实 clangd＋自有确定性协议服务覆盖所有故障/边界，源文件无写；Q01–Q04按R+I验收，Y29保留真实各语言和App所需层级。TS/Python供给缺失时该两条真实分支不计过，不以clangd代替完整Y29。

预计剩余工作是上述五块完整实现与回归，主要风险在文档代际、根外URI、输入候选/异步hover以及子进程清理，不是已有测试等待执行。依赖、settings/service/index/panel所有权已与 MCP agent 协调；其 viewer 区域保留。开发中发现产品规则不清时按已批准需求最小实现并记录，不自行删掉 Q/Y29 的既定场景。

## 2026-10-18 第一实现检查点（未完成整个 DEV048）

宿主、持久化配置与只读可执行文件发现、真实 EditorView 入口、四类位置查询、分页、hover 时序和文件内导航历史已接入。Microsoft 两个库升级为明确生产依赖并保留 MIT 声明；345 项语言映射原样移到纯 shared 模块，旧 renderer 路径 re-export。LSP 的 TSX/JSX/C++ ID 转换单独完成，不改参考高亮 ID。

45/45 定向验证通过，其中真实 clangd/native/协议及生命周期 14 项、原文本编辑器 3 项、LSP renderer 8 项、既有面板 7 项、高亮模型 6 项、帧边界 6 项、全 345 映射一致性 1 项。原型编译和最终全量类型检查通过；完整原型真实浏览器与新包 GUI 尚未执行。具体日志、失败、39 文件快照和哈希见[检查点证据](../验收/证据/m9-dev048-language-service-20261018.json)。这一结果不自动把 Q01–Q04/Y29 标为正式通过。

实施中独立复核发现跨 owner 同 UUID 并发初始化可能覆盖会话，及同文档旧初始化可能关闭新会话。已加入初始化前全局 ID 占用和 owner/ref 意图代次；新增真实客户端延迟回执测试通过。关闭使用客户端预先分配的 consumer ID，可在初始化回执到达前取消。

明确边界：用户显式登记的本机可执行文件属于受信任本机代码；`shell:false`、最小环境和只读 LSP 宿主能力不是 OS 沙箱，不能宣称进程自身无磁盘写权限。配置界面已说明这一点。根外位置目前只读显示规范路径和行列，不因服务返回 URI 自动授予根外读权限；根外完整文件预览仍是未闭合项。TS/Python 当前供给不足、新包 App、原型表单/hover/历史完全同步及逐原用例审计仍待完成，保留原范围。
