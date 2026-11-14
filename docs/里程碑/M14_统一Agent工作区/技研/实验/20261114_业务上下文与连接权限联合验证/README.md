# 业务上下文与连接权限联合验证

日期：2026-11-14。对应 M14-R02／R08／R10，补 Q04／Q27／Q41 的业务身份与释放边界。**独立实验，产品代码及共享原型未改；无外部业务请求、发送或写入。**

## 证据范围

实际执行未修改的 ApplicationToolService、ApplicationExecutionContexts、ApplicationConnectionService、ApplicationSelectionService、SecretsStore、BuiltinPackageRegistry／PackageRegistry，以及 CapabilitySessionRegistry／CapabilityRunRegistry／ResourceStore。SQLite 使用全部 32 份现有迁移，不是手写最小表。只将 Vite 的 raw glob 加载替换为独立 Node 构建所需的原始内容；构建源哈希见 [build.json](build.json)。

受控夹具明确包括：现有 runFixture／FixtureProcessReader、完整但合成的受信包分发、只读业务 handler、连接身份 verifier、可逆测试 cipher 和可信 sender。ToolService 的宿主 resolve／authorizeReceipt 由夹具接到实际 contexts；没有运行完整 ApplicationAdapterRegistry／ApplicationService、原生 SDK、私有 broker、Electron UI 或真实供应商。配置转换使用实际内置禅道转换器，实际 SecretsStore 只读写合成密钥；不能据此宣称 Keychain、真实登录或邮件发送链通过。

测试 task／run 都由实际会话与运行注册器建立；子任务是真实不同 task，C10 是同一 task 的后继 run。没有用伪造 taskId 模拟同任务多 binding。旧注册器内部 ptyId 合同仍在，尚未证明正式去 PTY 与 binding／generation 合同已迁移。

## 十二项结果

| 检查 | 实际结果 |
| --- | --- |
| C01 | ToolService → withAgent → 固定包／项目政策 → 固定连接／配置视图 → 一次凭据消费 → 调用账完成。业务操作结束后原 context 失效，run signal 仍有效；返回值不含合成密钥 |
| C02 | 拷贝 context／caller 或制造 handle 均无权限；已由真实 withAgent 签发的子任务上下文不能消费父句柄；父正常消费后不能再次消费 |
| C03 | 假 task、错工具主版本、错包在进入业务前拒绝；有效父回执不能被另一个已注册子 run 读取 |
| C04 | 同身份只更新密钥后，身份／配置修订不变；旧操作在有效范围内消费句柄时读取最新密钥。测试包含连接重测时的合成解密，不声称只有一次解密 |
| C05 | 连接配置修订变化后旧 handle 被拒绝，失败消费也不允许复用；操作记 failed，没有把旧授权跟到新端点 |
| C06 | 当前选定连接停用后，迟到消费拒绝；即使另一连接健康也不自动改选，未发生新的业务凭据解密 |
| C07 | 在途业务期间撤销项目启用，迟到结果拒绝，未消费旧凭据 |
| C08 | 收到取消响应后，业务尚未结束，run 保持 stopping、租约 active；释放受控工作并等待实际 withActivity 结束后才 stopped／释放。调用完成与实际资源结束是两个事件 |
| C09 | 改动固定包文件后，重复请求的缓存回执与新调用都拒绝；固定包完整性没有被缓存绕过。测试随后恢复原字节，不修改源码 |
| C10 | 同 task 的后继 run 不继承前 run 的业务回执权限，旧 context 也不能复用；后继 run 自己的新读取正常 |
| C11 | 单个操作取消只终止该操作，run signal 仍有效，下一个读取正常；不是整个运行停止 |
| C12 | 指定未选用连接被拒绝；已成功请求在连接停用后重取缓存回执也被拒绝，不重新执行业务 |

[最终结果](result.json)为 attempt-OZDDJm，12／12。每例的 state.sqlite、state.json、fixture.json 和合成分发在 [原始归档](raw-evidence.tar.gz)；最终 15 个夹具 run 全部 stopped，没有 active lease，SQLite integrity／foreign_key 检查通过。它们是注册器记录，不是实际 OS 进程退出证据。

两次失败保留：首批子任务误用父 MCP 名，后批错误地在取消响应后立刻断言 stopped。分别修正夹具命名与观察边界，**没有放宽断言或修改产品实现**；详见 [前置与修正](preflight.json)。

## 设计结论与边界

SDK／app-server 的工具入口应继续让宿主按当前可信 run、固定能力包／工具合同、项目授权及连接来源签发业务 context。对象不能经 JSON、renderer 或模型参数还原为权力；子任务、Provider 切换后的新 run 都须重新签发，不能只检查同 taskId。历史内容可保留在统一任务 UI，但可见历史不等于当前业务操作的权限。

业务连接凭据维持主进程一次性句柄、使用时再次核对来源；配置视图不携带密钥。业务连接的同身份密钥更新语义不能直接套给模型账号／原生恢复身份，后者沿自身配置兼容合同处理。失败没有替代连接回退。

操作、Agent run 与资源持有的生存期分开。应保留 agentRunSignal 的受信获取路径；不能拿单次操作 signal 代替长期浏览器等 run 权限，也不能把长期 run signal 用来忽略本次调用取消。新 UI 收到取消响应后按真实 owner 状态展示收尾；SDK 停止、业务活动结束和租约释放分别取得证据后，才允许安全切换或目录交棒。

本轮补上上一批邮件实验未执行的真实 contexts／连接／存储核心，但业务 handler 是合成只读服务；两批不能相加宣称完整邮件／插件／浏览器链通过。内置固定包与外部插件实时版本规则不同，C09 不覆盖 PluginLifecycle／PluginSessionTools 的更新和在途调用。T3 仍是统一任务／执行器分层的架构参考，这些业务约束来自 SmartDD 实际代码，并非 T3 自带的邮件／连接实现。

仍待联合验证：完整业务数据路由、真实程序化 owner 与 binding／generation 映射、原生实时输入、邮件预检／最终授权与执行、外部插件生命周期、浏览器权限及真实 UI。正式产品验收不变：54 条，0 通过、54 未执行，0%。
