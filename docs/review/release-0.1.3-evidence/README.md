# 0.1.3 整合与交付证据

`ci-candidate.json` 对应代码提交588acd2a的完整CI；`actual-app-adjudication.json`是已安装候选的实际Codex/CLI/UI回归，附实际两条浏览器回执及数据库关联。模型和禅道服务为本机合成服务，不声称真实模型推理、真实禅道或钥匙串验收。`normal-installed-startup.json`单独证明未覆写安全存储的隔离新用户启动、页面加载与正常退出；业务夹具的清场不冒充正常退出。

`production-inputs.json`冻结生产/构建输入（含SQL、NOTICE及跨阶段资源锁）；只增加本文证据及文档时按实际文件哈希复用已验收包。`helper-binary-comparison.json`仅比较本机候选与原058，证明两者只UUID/签名不同；不扩大到CI helper。CI差异、真实完整pin与新增实际回归见`ci-helper-comparison.json`和`actual-ci007-adjudication.json`；运行身份均使用实际完整SHA。

本机中断的全量运行与完整CI旧红测均保留，不计全量通过；后续完整CI没有缩减用例、变更业务断言或放宽超时。定向绿测报告在本目录。Root投影曾错误要求只读snapshot也进入写操作回执表，纠正说明见`adjudication-correction.json`；没有因此重跑App或改产品。

`windows-incompatible-originals.tar`逐字节保存3个Windows无法检出的历史原文件，原清单不改；按`windows-evidence-relocation.json`从归档解析历史路径。不要在Windows直接解包这些成员。

`main-merge.json`记录main远端合并，`ci-main.json`记录最终main的完整CI，`tag-push.json`及两份标签日志记录新附注tag的实际对象与远端解析。`release-start.json`只记录tag触发的唯一Release运行，不代替最终发布成功。

`release-final.json`记录原样重试后的实际Actions/Release成功，`public-assets.json`、四份manifest和`SHA256SUMS.txt`记录七安装包/十二资产及实际公开下载校验。CI安装/原生/正常启动与公开DMG按完整SHA关联，保留真实先后顺序。

`actual-ci-driver/`是007的冻结源码与准备时静态记录，不包含runtime/cache或旧结果；`actual-ci007-adjudication.json`及独立cleanup才是执行后的实际结论。006前置失败单独保留。模型/禅道/cipher边界不变；无安全存储覆写的正常启动另行证明。

安装包、完整原生对话/模型请求和运行凭据不入库；原始私有路径与哈希在投影中登记。所有成功结论均据实际回执形成，Intel真机及其它既有暂缓项不因发布成功变为通过。

原始日志保留终端输出的全部字节，包括尾空格与空行；目录属性关闭原始日志的换行转换和空白告警，逐文件SHA仍须匹配。正文与源码继续正常格式检查。
