# 禅道 biz13.0 本人列表接口复验

2026-10-17；依据[需求R1.3](../../需求.md)的R03／R08。用户授权点击现有浏览器页面查看Network、研究对应公开源码并归档可复用部分。本轮只读研究，不是正式业务开发、工单流转或发布。

## 结论

**当前公司企业版13.0已跑通“我的工作→指派给我”的Bug／研发需求Story列表。** 有效路径是通用controller路由 `GET /api.php/v2/my/work`，使用原有REST Token；无需复制浏览器Cookie、开启getModel或扫描全部产品历史。

| 验证 | 实际结果 | 证据 |
| --- | --- | --- |
| 原生页面基准 | biz13.0；Bug共3项、1/1页，完整ID集合为79967／79291／79064；研发需求计数0 | [浏览器观察](浏览器观察.json)，使用CUA原生Chrome，非Mock |
| Bug自动发现／分页 | 请求不含已知Bug ID或产品ID；每页1条，连续3页，各页码／每页数被实际采用；唯一ID总数3，与页面集合相等，约3.351秒完成三页 | [最终真实复验](my-work-live-verification.json)，7项检查全部通过 |
| 排序与详情 | id_asc再次查询与id_desc三页反序一致；用自动发现的首个ID读取详情，ID／非空复现内容匹配，历史6条 | 同上；此前三条详情、13条历史与3张内嵌图材料检查仍在[前轮报告](../真实接入验证_20261017.md) |
| Story空列表 | `stories=[]`、pager `recTotal=0/pageTotal=0/pageID=1`，与页面计数0相符 | 同上；当前账号无非空本人Story，不能证明本人Story多页或资源下载 |
| 认证负控 | 一次故意无效Token的GET返回401；有效认证下的Story空列表不是认证失败造成 | 同上；未试错密码、未修改账号权限 |
| 客户端契约守卫 | 8项本地测试通过：拒绝登录页／缺字段、未经证实的空值、忽略分页、重复ID、归属错误、closed Bug、范围变化和预算超限 | [本地校验](本地校验.json)；合成失败数据只证明解析守卫，不计入真实业务通过率 |

**范围语义**：这是与网页一致的当前账号 `my/work + assignedTo`，Bug排除closed；不是所有历史状态下本人曾经或当前关联的全量归档。原Skill的全产品归档600秒失败仍为历史事实，不用新的work查询成功把它改写成归档通过。三条材料原独立验证器保留的整体scope失败也不覆盖。

## 浏览器请求与API参数

通过Chrome“显示→开发者→开发者工具→Network”，单击“指派给我”并重载后，实际观察到：

```text
GET /biz/my-work-bug-assignedTo--id_desc.html?zin=1
HTTP 200
Content-Type: text/html; Language=UTF-8;charset=UTF-8
```

它是Zin前端取HTML片段的请求，不是必须返回JSON的独立Bug REST接口。点击研发需求后本轮曾观察到加载遮罩，未取得新的完整空页渲染；Story对照使用页面导航明确显示的0，不把加载中的旧Bug正文当作Story页面。页面排序链接的完整形式保留 `mode/type/param/orderBy/recTotal/recPerPage/pageID`。使用同一controller经API v2返回JSON，已实测如下：

```text
GET {BASE}/api.php/v2/my/work
    ?mode=bug&type=assignedTo&param=0&orderBy=id_desc
    &recTotal=0&recPerPage=20&pageID=1
Token: <由连接服务在内存注入，禁止记日志>
```

研发需求仅将 `mode=bug` 改为 `mode=story`；响应集合键分别为 **`bugs`、`stories`**。`recTotal=0`是让服务端重新计算的输入，不把它当返回总数；完成条件使用返回pager和实际唯一ID数。Token通过原有v1登录取得、v1/user核对账号，详情／文件继续复用旧客户端。

前轮 `/v2/my/bugs`／`my/stories` 来自较新SDK候选。对应公开基线的通用路由取第二路径段作为方法，controller没有这两个复数方法，实际目标返回403。该事实不能据此推定密码错误或所有个人列表均无权限；本轮改用源码和页面共同定位的 `my/work` 后成功。它仍是常规认证／权限检查，不是绕过拒绝。

普通 `my-work-*.json + Token` 在此部署只返回含loginExpired／keepLogin的登录页JSON，即使外层status成功也没有业务集合。该回退没有通过，不能把静态源码的Token分支当成现场可用结论。

## 版本与源码位置

企业版biz13.0与开源22.0属于对应发布系列。公开参考固定在官方tag `zentaopms_22.0_20260318`、commit `88d6de983014956235e3bf735d225106e38be551`；**不是开源13.0**。版本证据、边界、5份代码摘录、38段行号／哈希和完整上游许可见[来源与版本](源码参考/来源与版本.md)及[调用链](源码参考/列表调用链与候选请求.md)。

公开版用于说明controller→model→查询条件→分页；企业版专有扩展、补丁和完整部署源码没有取得，不能声称二者字节一致。所有候选都以本次真实biz13.0结果核对。源码摘录仅供研究，没有将上游服务端PHP合入WillYou运行时。

## ChatGPT／Codex与SmartDD如何复用

同一份独立客户端适配候选在[my_work_client.py](my_work_client.py)，不复制两套演进：

- **ChatGPT／Codex侧**：原`export-zentao-bugs`保留Token认证、身份、详情与文件下载；从当前工作区导入`MyWorkClient(已认证旧客户端, 已核对account)`取得work列表。现成可执行的[verify_my_work_live.py](verify_my_work_live.py)读取现有私有绑定、隐藏输入认证并调用该模块，只输出脱敏检查；它是复验入口，不是已安装的新Skill。旧全量导出／SVN修复流程及其语义没有改动。
- **SmartDD／WillYou侧**：正式开发时将已验证的同一路径、参数、范围和规范化规则适配到主进程禅道provider，由统一连接服务取凭据；不让renderer／模型直接保管Token。候选已真实验证，但尚未接入生产主进程、IPC或打包App。

适配候选只暴露Bug／Story两种mode和assignedTo；解析时核对返回mode/type、pager、账号关系、ID精度和closed边界。收集时有页数／条数／时间预算，页码无效、重复、总数变化或未收齐均报不完整；不悄悄归空。并发编辑并非服务端原子快照，遇到范围变化应刷新重试，不能宣称全历史一致性。

## 实验勘误与保留

- [首轮路由探针](my-work-route-probe-result.json)已实际调用四个只读候选，但当时通用集合名用`mode + 's'`，对Story误拼成`storys`，误记`collectionPresent=false`；它不能说明服务端stories格式异常。当前脚本已修正，最终实际观察为`stories=[]`。
- [复验attempt1](my-work-live-attempt1.json)和[attempt2](my-work-live-attempt2.json)保留此客户端错误导致的失败；attempt2明确记录实际集合为list、报错Missing collection。最终修正为`bugs/stories`映射后7项检查通过；没有通过宽泛吞掉null／false／缺字段来掩盖错误。
- REA浏览器目标发现因现有CDP端点返回不符合协议而未成功，未形成REA浏览器Evidence ID；本次网络证据来自CUA操作的原生DevTools，不冒称REA捕获，也未更改调试或浏览器安全配置。
- 一次请求头区域UI操作被自动审批判为可能展开敏感会话材料而拒绝，未重试该区域或复制认证头。之后关闭DevTools，以独立REST认证完成验证；未保存HAR、完整AX请求头、浏览器Cookie或本轮请求／响应原文。公开观察只保留列表计数、用户已给编号及接口参数。

前轮164文件基线另存`release/m10-research/before-my-work-recheck-20261017/`，保留原来的未通过结论；当前文件及哈希从[阶段全量机器目录](../../验收/证据/m10-real-readiness-file-manifest-20261017.json)进入。研究与需求记录在当前开发分支归档，实际提交见Git历史；本轮未合并、推送或发布。

## 当前剩余项

本人work列表的接口／当前账号范围和分页障碍已解决，连接检查不再依赖全产品扫描。首版具体流转动作、邮件回复／附件与审阅、缓存／断开／迁移、目标平台及正式主进程契约仍须评审固定；打包态Foxmail权限、持续增量、故障恢复、其他平台和真实流转尚未验收。本轮不把接口验证通过等同M10全部开发或验收完成。
