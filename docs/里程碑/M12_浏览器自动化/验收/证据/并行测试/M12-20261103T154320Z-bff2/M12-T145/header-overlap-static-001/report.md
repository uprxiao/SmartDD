# T145 主任务标题栏覆盖：有界静态调查

结论：1440×900窗口、右区900px是原T145明确要求且当前App025/026布局允许的组合，不能把原图当非法尺寸删掉。原P008/009已有More中心被挡的真实只读观测；新建标签页按钮右侧有10.65625px进入右区，但其中心尚在右区外，原metadata未记录该按钮hit-test，不能宣布整个新建入口不可点。当前生产CSS具备同类必然空间不足结构；实际App点击/精确像素仍未执行，不能把P事实当A通过或失败。

原合同：需求R01.11（需求.md:244–250）要求任务标题右侧新建入口，并保留右区工具栏入口。T024（测试用例.md:62）要求真实点标题入口及系统快捷键，T145（:209）明确480/900右区×1440/1920窗口。右区替代入口可用不能替标题入口验收。

P事实（原件未修改）：P008 B01-tabs-entry和P009 R01-11-launcher-recent均 inner1440×900/dpr1/dark，右区 x536..1436、y4..896、width900；标题新建按钮 x517.65625..546.65625、y7.5..36.5，右侧10.65625px与右区相交，中心x532.15625仍在x536外。P009 theme-geometry日志 final-original-target-restored 明记More x551.65625..580.65625/y7.5..36.5、visible=true、disabled=false、unblocked=false；原图非单凭截图猜测。真实临时fit480时More unblocked=true，恢复900后又false；该动作仅用于P已存换主题前置，截图最终900未改。geometryEvents是有限投影，不读/执行浏览器。

当前App允许性：source030 src/main/app/window.ts:45–49 minWidth700/minHeight500，因此1440×900有效。src/renderer/core/navigation.ts:33/40侧栏240..420，默认240。m6.css:157 frame左右padding52/4，侧栏占240，sidebar-resizer:39 的4px和margin-right:-4px净0，故默认展开侧栏下split available=1440−52−240−4=1144。shared/file-panel-layout.mjs:10–20 右区最小min(420,0.7available)，最大max(minimum,available−240)=904；900合法可达，并非被上限挡住。侧栏若310，available1074/max834，900会被夹为834；不能把所有侧栏配置都说可900。窗口>1200，所以workspace.css:63自动隐藏侧栏的媒体分支不生效。收起侧栏则另有更宽空间，不能据此取消当前展开侧栏场景。

当前生产尺寸机制：workspace.tsx:92–97测实际split并把fileWidth同时写--m9-panel-measured与--file-panel-width。m6.css:510标题left=52+sidebarWidth，workspace.css:71 right=fileWidth+4；1440/240/900时标题border-box宽244，padding-left15后229。workspace-baseline.css:3标题min-width70；m6.css:510 gap16；:514 actions flex-shrink0/gap5。task-chrome.tsx:59–64 有三个带16px图标/文字的m9-file-entry（新建/应用/文件）加29px More；workspace.css:38每entry水平padding14/gap5。即使故意把三个文字的宽度计零，仅三个16图标+gap5+padding14、More29、actions三gap15，加标题70/外gap16/左padding15，最低宽已250>244；真实非空文字还增加所需宽度。因此244px并不能容纳现有标题和动作组，actions不缩且无响应式收纳/换行规则，发生横向越界。workspace-baseline.css:1 右区position:relative/z-index6，workspace.css:72负margin把右区顶到窗口条同一y段，标题没有更高z-index/自身overflow防护。发生在右区范围内的动作部分会由右区覆盖；没有一个按完整header动作预算计算的resize上限，保留240仅是左body预算。

边界：上述“至少250”是从冻结CSS属性/图标声明计算的静态下界，不伪造App实测DOM；实际字体形成的最终actions宽度、More中心坐标、标题新建是否中心可点击、键盘访问及不同侧栏/collapsed的最终paint/hit-test尚未知，应由Root后续单次真实App受影响复验核定。旧P证据足以登记原型布局问题与生产静态高置信同类风险，不足以回填实际A结果。深色只改变颜色，所读规则未有dark专属几何修正。

原型对应：reference.css:116–120 与生产同header/action结构；file-workspace.css:3 title min70、:57 right=prototype-file-width+4，:1右区z6。App.jsx:246默认侧栏240、:269–274与production相同shared bounds、:375–380标题More等动作。原型新建是图标29px、生产是文字按钮，不能用P坐标直接计算A坐标。参考和实现均未修改，未启动Chromium/App/OS/HTTP，未新增矩阵，已交F12/F17 READY字节保持。
