# A003 外层审计与单句 inline AST 扩展

只读已结束 A003 的原 154722 字节 Native 前缀（SHA `d811a28e1a629b9b4868feb5bedd4a03eba88d514600bc9564224ec8ea31d9bd`）。原 parser、raw、十条业务 judge 和两个 unsupported 红保留；无 App/Native/CLI/HTTP/模型/认证操作，不增加正式通过数。

三对完整调用为 `16→18→19`（本轮生成的 browser Skill 只读）、`21→23→24`（tab list）、`26→28→29`（tab create）。请求、输出、typed 行与 call/turn/thread/cwd 均精确配对；完整转发输出逐字节等于 typed 原输出。CLI 两条通过已保存 typed-primary 证明及独立只读 Host 行核 operation/request/run/task/project/package/plan。未重复运行原 typed 七个控制。真实 context 为 OpenAI/gpt-6.1-sol/workspace-write/on-request；全部实际 outer 参数只有 literal cmd/max_output_tokens，三条准确命令没有认证文件读取、配置写入或审批覆盖。结论范围是完整保存的 outer 行为，不外推 CLI 内部没有使用已授权身份。

`exec-carrier-inline-extension.mjs` 导出与旧模块相同的 `parseCustomExecInput`、`decodeToolRequest`、`decodeToolPair`。原来支持的载体直接委托原 parser；唯一新增形式为：

```js
text((await tools.exec_command(LITERAL_OBJECT)).output);
```

有限 AST 限定单条语句、准确方法/属性、一个 literal object，再由原 parser 验证所有 literal 并配对完整输出块。只是语法归一化，不 eval/运行模型代码。扩展来源明确标为 `single-inline-output-ast-extension-v1`；转发的 `.output` 缺数值退出码，始终保留 null，须另用 typed 数值证据。未知形式继续抛出并保留原始记录，不能删除或当作业务成功。A004 离线复核可在其私有 native-journal 副本仅重绑 exec-carrier import 到本模块；本交付没有修改任何原文件或替代最终安全/业务判断。

`A003-outer-audit.safe.json` 保存完整三调用的安全投影。生成 Skill 的原文件 SHA 与 plan.renderedHash 分别记录，没有将两种口径声明为同一字节哈希；其实际读取输出与文件字节完全相等。未复制 Skill 内容、完整 Native、outer 完整输出、配额或认证。

纯文件执行命令已通过：

```sh
NODE_COMPILE_CACHE=/private/tmp/willyou-m12-t105-A003-outer-audit-001/cache/node /Users/liubu/.hermes/node/bin/node /private/tmp/willyou-m12-t105-A003-outer-audit-001/audit-controls.mjs
```

审计四项通过；AST 三正控（原 Skill 兼容、两条真实 inline）与六负控（动态参数、额外语句、错误属性、错误工具、错误 call ID、未知输出 metadata）共 9/9。负控只作用于内存副本。
