# 浏览器程序化运行授权与排空

2026-11-14；技术方案 §9.7，验证账 §4.68；R02／03／05／08／10，Q27／28／37。仅技术研究，产品／共享原型未改。

## 实际执行范围

真实 Codex 0.167.1 父运行、Claude SDK 0.3.321／native 2.1.321 子运行，以及同一父 task 切换到新 Claude run，均使用当前候选程序化 owner／ExecutionPlan 初始化。受信实验宿主调用实际 `ApplicationToolService(entry=cli) → ApplicationAdapterRegistry → ApplicationService.data → BrowserModuleData → ApplicationExecutionContexts → BrowserService／BrowserAccess`。没有模型请求，也没有通过原生 shell、willyou-app 二进制或 CLI socket；不能将此结果称为完整 SDK→CLI 端到端通过。

Electron 替身在创建窗口、session 或读取系统路径时直接抛错，本批不创建网页、不读登录态。使用实际浏览器 tab list 空结果、授权服务、暂停状态、审计表和运行生存期。资源包由当前 definitions／assets 生成，但 runtime hash 重绑至研究 bridge；不声称验证正式发布包。Agent adapter 和程序化接线沿用临时研究候选。

## 六项通过

| 检查 | 实际证据 |
| --- | --- |
| B01 真实 run 到现有浏览器处理器 | 两端已初始化原生 run 可访问自己的空标签列表；传入同一个 RunRegistry 长期 signal，单命令 signal 不同；子默认读取父任务被拒 |
| B02 两种跨任务授权 | 父获 control、子获 observe，各绑定申请方 run；后续命令读列表可用，授权不随命令结束消失；observe 不获得 write 权限 |
| B03 单命令取消 | 取消父新一项待授权请求，原 control grant 保留，run 未停止，后续读成功；迟到批准拒绝 |
| B04 父停止 | 父原生退出／run 停止，父申请的 grant 撤销、暂停清除；仍活跃子 run 已获的父 task observe grant 保留，可继续读该逻辑任务 |
| B05 同 task 换 Provider | 新 Claude run 保留父 task，但不能继承旧父 run 对子的授权；子的授权仍属于子，目标仍为同一个逻辑父 task |
| B06 等待真实业务排空 | 停止新父 run 时，用受控 Promise 暂停浏览器请求的业务收尾；原生已经退出，run 仍 stopping、activity 与租约保留，投递不能退役。释放该 Promise 后停止完成，迟到批准拒绝；子再停止后全部 grant 清空 |

最终 attempt-7JlkWN，3 个原生进程退出（Codex 0、Claude 各 143），调用均由研究宿主发起；14 次实际 BrowserService scope 观测均满足稳定 runSignal／独立 command signal。BrowserService 自身一直保留到实验最后由 ApplicationService.dispose 关闭，单 Agent 停止不销毁宿主服务。

## 发现的候选停止缺口与修正

初次 setup 未安装激活 browser 包，获取 active package 失败，尚未启动原生进程。第二批 attempt-oUppYV 的 B01–B05 通过，B06 出现 RUN_NOT_DRAINED：临时 launch.cancel 等到 native exit 就试图 retire 投递，实际 withActivity 的 finally 尚未结束。原有运行表阻止了过早释放；最终清理仍完成。两份失败保留。

修正临时启动协调：撤销入口与运行 signal、结束原生范围后，等待该 run 已登记的真实 withActivity Promise 结束，再检查 activity／租约并退役。没有删除活动行或强行标成 stopped。最终 B06 添加确定性的业务收尾暂停点，证实 native exit 与业务结束之间资源占用保留；不以 sleep 或多次 stop 侥幸通过。挂起不明业务仍须维持 stopping／恢复状态，不能为了返回成功跳过等待。

## 迁移规则与边界

浏览器运行权限由申请方 run 持有，目标是 task。停止申请方撤销其权限；目标 task 的 Provider 改变不会把仍活跃申请方的 grant 复制给新 Provider，也不等于删除目标页面。实际页面与登录是否保留仍需原生 Electron 验证，本批只有空标签列表。

保留 BrowserModule 的 CLI 入口限制，不在统一任务 UI 改造时直接转成公共 MCP。SDK Driver 后续须接受管业务 CLI 的环境／内核身份路径，并将稳定 runSignal 与一次命令取消分开。审批响应由受信宿主发起，真实 renderer／IPC 还未接线。进程初始化不是模型成功使用浏览器的证据。

未覆盖真实页面／登录、原生 shell→CLI socket、在途网页写入、输入／下载、页面工作区 UI、宿主崩溃或跨平台。本批候选等待修正不等于正式产品已有此 launcher。

[结果](result.json)、[失败／最终运行审计](runtime-audit.json)、[源码及实验替身边界](source-review.json)、[摘要](archive-manifest.json)、[脚本／资源／协议／SQLite](raw-evidence.tar.gz)。483 文件，14 份 SQLite 完整性／外键通过，1097 构建输入复核。
