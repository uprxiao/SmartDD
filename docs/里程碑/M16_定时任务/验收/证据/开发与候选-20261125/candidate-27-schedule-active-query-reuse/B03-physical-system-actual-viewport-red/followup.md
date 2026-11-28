# B03 同活动状态几何复核准备

当前真实结果仍红：旧前景已测活动条状态624×763，停放及后台末端均624×763，回原页时624×797，恰等本轮初始idle几何；实际宿主UI有20秒活动保留且`.bw-agent`实际进入布局流。旧驱动未采实际活动标记，不能仅凭数值断言原因或认通过。v2 仅读取实际原DOM banner、同任务页state、native宽高、document/form 和相同活动态两次稳定记录；原还要执行的返回3次合法实际操作和最后active同形状仍必须通过，停放尺寸与实测median<1000ms原条件保留。旧错误原样留证，纯前置正2负3，不替代真机。未重打包、未启动App；待新的实际系统时段。

驱动 `/private/tmp/willyou-m16-f36-qa/C27-B03-physical-system-recheck-comparable-activity-v2.mjs`，除驱动文件名外沿用已冻结C27 B03原命令。


实际C27短诊断已完成：C27隔离实包短诊断（非系统层）：同真实WC/document/form，7次实际点击与独立HTTP计数一致；实际状态栏34px，idle 624×797、active/parked 624×763；停放态原20秒自然到期，回原idle及再3次active后的同状态尺寸分别完全一致。确认旧误比较为状态条布局差异，原B03.5完整系统3/10/3仍待，不冒记整条。正常exit0、0 renderer错误。[实证](actual-activity-calibration.json)。未变更产品源或原验收合同。
