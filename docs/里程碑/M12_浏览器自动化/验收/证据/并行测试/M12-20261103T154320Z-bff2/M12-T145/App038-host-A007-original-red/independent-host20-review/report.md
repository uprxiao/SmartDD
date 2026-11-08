# App038 A007 host20 独立有限视觉复核

仅读取已终态 A007 与冻结 P 图、metadata/source045；未读移动生产，未运行 Native/App/网络，未改 A007/原判据/公共账。20A+20P 图、各自 metadata 逐 key 的 SHA、PNG全部chunk CRC/IDAT解压、尺寸和绑定均核验通过：A2880×1800/DPR2，P1440×900/DPR1，CSS窗口均1440×900。JSON逐key保留全部原路径/哈希与有限判据。Root另做全部40图逐对看图；本执行者直接原分辨率看了light480 B12两原图，不冒称看完其余38图。

原456总矩阵不变。本组20槽、1920所选20硬件缺项、其余416仍分别保留。机械9/9及清场不等于视觉通过；本报告不判whole-state/T145通过、正式新增0。

## 旧六类偏差复核

| 旧偏差 | 当前可证结果 | 边界/残差 |
| --- | --- | --- |
| launcher额外inset2px | 四A launcher与page同rect，page border0，padding-left28；480卡x985,width423,height44，900卡x565,width275.664,height44。对照旧报告P原像素位置及同一冻结P launcher规则，原额外2px已消除。 | P metadata没有launcher子computed，不能伪造全computed一致。P原型演示按钮额外内容不在App。 |
| 16dialog无shadow | 16/16当前shadow实际非none并与P computed逐字相同；共同字体、字号、字重、行高、前景/背景、边框、16px圆角也全同。 | 全局frame/DPR不同不抹平；dialog在各自browser内，不按全局y硬对。 |
| mini28px/Clone图标另起行 | 当前所有采样mini都是26px、font12、padding0 9、radius7、gap4、nowrap；Clone Copy13图标在按钮内，与文字同行，light480原图直接确认；P冻结browser.css:76同规则。 | computed display为flex是flex-item blockification；P没有按钮子computed，不声称逐值实测同。窄B12仍有下述真实溢出。 |
| profile说明在body | 四A说明现在都在header，文案同P；窄header说明36px，宽18px。宽B12高度A/P均468。 | 窄B12 A554/P550仍差4px；任务名/项目profile标签不同，缺P子布局，不能断言这4px唯一因果或称整状态等价。 |
| grants文案/高度 | 四A subtitle、empty文案与P相同；四A/P高213，宽度也同。A空态p margin12 0 24。 | P只有dialog总computed，header/body细节靠冻结源码与原图，不冒子computed。 |
| restart全文/颜色/段距 | 四A全文精确含browser identity set；secondary色、font12/18、margin12px 0 24px，四项实际均高36；完整dialog A/P均537。普通设置均458，原多2px已消失。code为真实12px mono、padding0 4、radius4。 | P restart/code子computed未采，颜色/段距依据P真实级联源码和原图，不能说该子项computed已双向实测。 |

## 尚有真实“不溢出”失败

**light480/dark480 两个B12**：dialog右界1420；body右界1419、clientWidth445/scrollWidth450、overflowX=auto；导入按钮x1252,width172.265625,right1424.265625，越dialog **4.265625px**、越body **5.265625px**。按钮内部文本scrollWidth并未增大，仍是整按钮超出右列/可视边界。A light480原图右侧按钮边框被截；P对应原图也贴/截右缘，但P只存dialog rect，未存按钮rect/横向scroll，不能给P编造数值，**更不能因P也有豁免原不溢出判据**。宽900两个B12 import右界1226.765625，位于dialog1366.5/body1365.5之内，body scrollWidth=clientWidth758，无同类几何溢出。

冻结A CSS59与P browser.css144均是`.bw-profiles{grid-template-columns:minmax(200px,240px) 1fr;gap:16px}`；A CSS50/P76 mini nowrap且flex-shrink0；A CSS38/P123 body overflow:auto。响应式73/P158仅按整个window max-width760判断，当前1440窗口的窄480 pane不会命中。以上为真实规则与溢出结果的对应依据，不新增运行或声称P child rect已测。

## 数据/原型专用边界

设置4常态+4restart：App实际0MB，生产settings-dialog.tsx26由`busy||!artifactBytes`禁用清理；P合成12.4MB由`!bytes`启用。因此这8对清理按钮启用/禁用视觉不同，**不能整状态等价**；metadata未含disabled/opacity字段，规则与Root/原图观察分开记录，不填假computed。实际Downloads绝对路径与P`~/Downloads`、真实T026页与P合成qa、长任务名/项目profile名、sidebar/终端、额外AGENTS标签均保数据来源差异。P底部演示/Flask为P-only。

原P4px外框/App底部RuntimeBar的frame差异，导致当前多数同高dialog全局y差-18；不能移出自身browser中心去硬匹配。Launcher P焦点button、A地址input自动焦点仍不同，不移焦/删蓝圈冒一致。当前App真实profile badge/地址placeholder已存在并通过原driver实际metadata门闩，不能把它们再列为缺失，也不扩大成所有badge交互状态已验。

逐key明细见review.json；2个窄B12明确失败，其余条目只给有限旧六类判据，不自行预填18整图通过。A007原raw/9judge不改。资源0，未宣称Root当前T127资源释放。
