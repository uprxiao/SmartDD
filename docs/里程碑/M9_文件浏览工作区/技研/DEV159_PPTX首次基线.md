# DEV159 PPTX首次基线

依据 M9 R3.4/R3.4-P1、J02/R07.11。当前macOS arm64实际r95；同范围开发授权持续有效，无生产/原型改变。

**最新接续（2026-10-20，DEV159，复用r95）：** 正式 **266/419（63.48%）**，150未执行、3阻塞，150含App。新增J02完整U/I/A：3原schema/真实native基线场景、r95正常匹配基线浅深A2继承、异常基线浅深A4通过，266原V8核验。源变化拒绝CHANGED，空hash由原schema拒绝；异常零edit/save/Worker，源字节保持。空hash为明确标注的provider克隆传输故障，原认证/输入/metadata/error不变，不冒充正常环境；原watch/7RPC/Worker构造恢复，App正常0/null。1340构建前输入完全一致，82运行/原六smoke沿用，生产0改。[30项证据](../验收/证据/m9-acceptance-pptx-baseline-dev159-r95-20261020.json)及[DEV159](DEV159_PPTX首次基线.md)记录完整边界。W28的r95 PPT16已全过、XLSX16运行中，待全32与最终审计才结案；阶段未完成、未发布。

原三场景完整保留：源bytes/hash匹配才可编辑保存；实际源变化以原CHANGED拒绝；hash空不得盲写。独立native探针使用真实当前main源码与包内Worker/native，无引擎分支按实际cached能力，不称GUI。真实匹配A精确继承已完成W28 PPT14里的浅深notes-normal两组，保存/不blur关闭/重开最新、原baseHash/源hash均直接核验。其余四负向A独立执行：延迟原metadata期间物理外改；传输clone只清空hash，原结果不动。受损provider元数据不是正常native输出；故障边界、被动watch暂扣及原帧释放详见证据。

本条只要求U/I/A；不宣称视觉完全一致、系统/外部App、跨平台通过，也不要求在无有效基线时创建可编辑文档来触发写入。原schema/原native先拒绝、编辑/保存入口禁用及零真实write，是该拒绝分支的保护行为。未放宽条件或改期望。
