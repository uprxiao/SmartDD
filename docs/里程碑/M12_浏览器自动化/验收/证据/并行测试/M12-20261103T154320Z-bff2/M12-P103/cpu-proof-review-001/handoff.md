# P103 CPU proof independent review

结论：原11项证明逐SHA一致；唯一额外文件是原P096 source024 bridge的完整原字节，current bridge精确链接它并绑定source025。18个完整proof谓词全部通过；不是把proof_ok写成true。7个缺项/重复/改hash/断链/错source纯数据负控全部拒绝，且原adjudicate不批准scope。

原coalition_judge.py与P096逐字相同。独立重放原计数条件，完整再现原红结果；原红仅PROOF-INPUT-HASHES（12≠11）。只按原必要11项＋精确额外父链计算proof_ok，再调用同一原adjudicate：1867项全部通过，CPU own下界0.8013017864%，coalition保守上界2.8703728667%，idle1786.902486418s，门槛仍严格<5%，分母/原raw/时长/阈值未改。上界含同coalition其它成员、busy和sampler，不宣称App独占归因。

3个实际跨版runtime SHA差异（主exe、两个node-pty）明确记录在proof-review.json，不假称metadata过期、同字节或已证明仅签名差异。当前实际文件分别匹配App021当前PIN；固定Framework/Helper/nativeCLI/identity、9项选定spawn/native源码仍同原证明。完整source023→024→025 manifest和modes实际核对，精确2/3个变化文件及其实际字节SHA与bridge一致；未改变Native/进程创建闭包源码。当前20roles/UID/出生/path/CID/权限/API仍由这次原始数据和原判定器验证。

原输入/原raw/原red的before/after SHA完全相同；原judge与red副本在original-inputs。静态复核未启动Native/App/OS查询/模型/监听，资源0，formalCaseCredit=0，正式T111归账由root完整复核。

主要产物：result.json、proof-review.json（原11逐项/18谓词/源码链/实际runtime差异/7负控）、readjudication.json、input-hashes.json、review.py。私有输出已冻结，若需重跑使用新attempt。
