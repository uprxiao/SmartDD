# 0.1.3 合并与发布前证据

`ci-candidate.json` 对应代码提交588acd2a的完整CI；`actual-app-adjudication.json`是已安装候选的实际Codex/CLI/UI回归，附实际两条浏览器回执及数据库关联。模型和禅道服务为本机合成服务，不声称真实模型推理、真实禅道或钥匙串验收。`normal-installed-startup.json`单独证明未覆写安全存储的隔离新用户启动、页面加载与正常退出；业务夹具的清场不冒充正常退出。

`production-inputs.json`冻结生产/构建输入（含SQL、NOTICE及跨阶段资源锁）；只增加本文证据及文档时按实际文件哈希复用已验收包。`helper-binary-comparison.json`证明新helper与原058仅UUID和代码签名元数据不同，其余字节相同；运行身份仍使用新包的实际完整SHA。

本机中断的全量运行与完整CI旧红测均保留，不计全量通过；后续完整CI没有缩减用例、变更业务断言或放宽超时。定向绿测报告在本目录。Root投影曾错误要求只读snapshot也进入写操作回执表，纠正说明见`adjudication-correction.json`；没有因此重跑App或改产品。

`windows-incompatible-originals.tar`逐字节保存3个Windows无法检出的历史原文件，原清单不改；按`windows-evidence-relocation.json`从归档解析历史路径。不要在Windows直接解包这些成员。

安装包、完整原生对话/模型请求和运行凭据不入库；原始私有路径与哈希在投影中登记。正式main检查、tag、Release与下载后核验在发布记录追加，不在这里预填成功。
