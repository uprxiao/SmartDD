M12-T004 A＋R 交付（固定包006 / R1.2）

原测试合同不改。整条未通过，分类 acceptance-contract-conflict，等待用户决定。正式完整通过数不增加。

T0 A 通过：私有已迁移 DB 预置 project_id=NULL、native_session_id=NULL 的既有任务；真实 UI 文件面板无网页标签/新建网页/浏览器内容层，真实双击固定 t0.txt，CodeMirror 文本及 task-cwd 路由正确。
T0 R 通过：真实 UI 点击“启动”，受管 Codex 0.166.0 接收真实终端输入；本机合成 Responses provider 选择一次真实 exec_command，原命令 willyou-app browser tab list 返回 exit127 与 command not found。native-0.jsonl 的原始调用、CommandExecution 及 function_call_output 可独立核对；没有外网模型推理声明。
P1 A 前置通过：真实 UI 固定 p1.txt，持久路由是 task-cwd；真实 UI 创建网页并成功加载本机 HTML。删除本次项目的真实 UI 确认也已执行。
删除后任务因实际 SQLite FK ON DELETE CASCADE 消失，无法再查看该任务标签栏/文件区。原 M2 task-service.test.ts:618 同样约定 deleting the project deletes its tasks，与 T004“被删项目任务文件区不受影响”冲突。保留原红，不修改旧规则、测试预期或生产代码。

原始结果 raw-result.json；独立判定 result.json；判定器 adjudicate.mjs。
输入/源码：inputs.json、source/、source-hash-verification.json。固定 ASAR 4043070facf4051d7a70fcb1475136db434cc8bcb1ffc46cae065528870d69d4。
清场：cleanup.json、process-cleanup-verification.json。全部已知 App/原生/PTY PID 与 9 个回环端口均已关闭，无生产钩子。
历史环境及驱动错误保留：attempt-001-environment（沙箱不允许回环 bind）；attempt-002-driver（初次终端加载草稿未提交，确认没有会话/调用后单按 Enter；provider 预取被过严校验误判，实际原命令已完整结束）；attempt-003-menu-animation（输入前几何未稳定，没有发送后续点击；改为有界稳定等待，只接续未执行删除）。T0/R 没有重发。

只归档 manifest.json 所列文件及 manifest 本身；userdata、home、codex、tools、cache、原项目目录为私有运行材料，不归入仓库。所有实验数据为本地合成，未读日常凭据。
