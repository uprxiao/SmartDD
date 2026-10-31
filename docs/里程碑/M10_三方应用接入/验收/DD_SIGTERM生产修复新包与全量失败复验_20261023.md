# DD：SIGTERM生产修复、新包与失败组复验

2026-10-23。隔离提交a5b25ea6已cherry-pick至feature/0.0.2的6e6fe934。生产bridge-runtime幂等关闭stdin／Transform；内置mail、zentao1.0.3，Skill字节不变，保留旧版本；runtime hash adc15d5422904ec27ee9216e702e8a05139f7a49085aca2774b29d6249ad7625。

新DC包位于`/private/tmp/willyou-m10-dc-package-20261023/mac-arm64/WillYou.app`，ASAR b7e627df58846ed4a31647137d773376cb6c0a8f8757987260032758e3d2498e，6项原生检查通过。包基线为隔离fe299eb0加本次生产修复，构建后变更只有测试和外部驱动／配置，不能把包元数据写成后来的提交。

新包真实Codex0.162.1服务链：原任务创建本地草稿、停止／宿主重启／恢复后，对经内核身份确认的owned桥发SIGTERM，工具明确Transport closed，Agent原PTY继续、诊断桥断开、成功工具计数0，草稿1条及revision不变。共10检查通过；无UI／真实模型或外部服务声明，实例已清理。CZ原SIGTERM红测保留，DA候选及本次生产复验形成修复链。

旧全量17失败处理：资源夹具6条改为实际唯一内置版本；测试React dedupe保持同实例；Python3.11独立venv按requirements-ci锁定安装PyMySQL1.1.2、psycopg2-binary2.9.10；原生报告测试等待JSON完整而非仅文件存在。相关组74断言通过，但PDF suite因工作区外共享node_modules的worker URL被拒，整轮仍失败。任务定向7条中4过3失败：两条T64流程实耗8–9秒超过默认5秒，单独改15秒；真实PTY断言写死1.0.0改为原snapshot版本。其他生产截止时间与预期未改。

主工作区原生准备已更新，定向任务7条＋原型2条复验session84095，日志`/private/tmp/willyou-m10-dd-primary.*`；最终类型检查同时运行。未把旧失败组或整例提前标通过。完整新基线回归仍待这些修复验证后执行。

[结果、包检查、失败组及真实App证据](证据/bridge-fixed-dd-20261023/manifest.json)。正式15/72（20.83%）不变，T56/T68其他层及Claude仍未齐。隔离工作区暂保留供证据核对，主开发继续feature/0.0.2；未发布。

最终补记：主目录9条定向通过、0失败、229条名称未选中，退出0；最终类型检查通过。结合隔离组74断言（其中image-host一条与主目录复验重合），本批82唯一相关软件实例最新通过；原失败及PDF suite加载失败保留。不等于新基线完整全量通过，后续需完整回归。

修复后完整全量已启动，6e6fe934生产基线，session29047；使用独立Python venv PATH，maxWorkers=2，同时default／JSON reporter。日志`/private/tmp/willyou-m10-de-full.log`，最终JSON`/private/tmp/willyou-m10-de-full.json`。仍运行，不能预填成功；不再并行启动会重建共享node_modules的打包任务。
