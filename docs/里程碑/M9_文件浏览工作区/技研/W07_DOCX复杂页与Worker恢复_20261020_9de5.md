# W07 DOCX复杂页与Worker恢复

依据R3.4/P1、M9-R06.9/R08.1与原W07约定I/A，本条完整通过，新增一条。正式306/419（73.03%），107未完成、6阻塞，余113；阶段仍在验收，未完成、未发布。见[126项分层证据](../验收/证据/m9-acceptance-docx-worker-20261020-9de5.json)。

复用DEV166/F19既有复杂DOCX生成器与独立oracle：原修订文本、中文、两页A4、2×2表格、页眉页脚、64×32原始绿PNG（排版144×72pt）、批注锚点与未知XML。正常字体与故意声明不存在字体两种输入均保留，源OOXML每个部件名称/顺序/hash可追溯。缺失字体是生成夹具，不是修改用户或系统字体；实际PDF嵌入字体与替换逐项记录，不声明MSWord/Codex版式或所有字体一致。

18项代码零失败/零skip：新3项真实I，另15项pages相关代码回归。真实I使用FileService、可信根/native broker、包内原Office页面Worker与固定LibreOffice：正常源可排版；缺Worker入口与实际require缺依赖均由原OfficeWorkerClient返回IO，session归零且没有调用native排版。保持同一FileRef、版本与service，在私有入口恢复透明require原包Worker后，新请求真实恢复2页PDF；释放后旧chunk拒绝。I的私有bootstrap与Electron非界面模块夹具明示，不冒充GUI或未修改故障环境。

真实r118 App按浅深两主题串行：每主题正常复杂DOCX一组；另两组分别使Office页面Worker入口缺失、导入失败，等待原明确错误/原重试按钮，确认没有rendered canvas冒充成功，再点“重新预览”。四个故障一次性只重定向本次App的node:worker_threads.Worker入口到本次不存在文件或真正导入失败bootstrap；原options、源字节、认证、IO与错误处理/返回保持。触发一次后取消重定向，四次真实UI重试均重新使用包内原入口，不通过伪造成功消息、业务RPC、Store或DOM值推进。本轮正常/恢复六份PDF、预期故障四组，共十项App检查，不将故障注入说成自然环境故障。

六份原Office RPC的PDF回执/分块字节与hash完整匹配，均由Poppler加stdlib ZIP/XML独立验证：两页A4、中文及全部表格单元文本、两列相距225pt（容差2pt）、页眉页脚两页存在、插入/删除修订文本与源匹配、PDF内64×32图像原色逐像素一致、声明和实际字体记录。两页实际App canvas有正确非空内容，第一页出现原绿图像、第二页没有，真实滚动定位第二页；窗口与canvas截图保存。缺失字体名称没有被伪称实际嵌入。只读页面没有内容编辑器或编辑工具。

36条原文件RPC输入/输出hash同，六handler恢复；十个实际Office解析Worker全部退出、六个有原成功结果、四个有真实启动错误，所有已投递消息与请求hash同。故障constructor先恢复到观察器，再把观察器恢复原constructor，未留门闩；files.save为0。六个源文件hash/inode/mtime/ctime一致，另外逐份独立重算六App+三I的原PDF与源hash，全部成立。App正常code0/signal null，已知PID不再存活；测试清理没有冒充业务正常退出。

生产、共享原型、依赖、原生及构建配置未改。2048冻结输入逐一核对，仍只有上一批F02外部driver退出观察差异；唯一新增src是本条测试，另两文件为外部driver/故障helper。类型检查通过。复用[R01新r118完整构建](R01_全文入口能力门控_20261020_9de5.md)的六native smoke、339运行文件与两来源文件匹配及2048可恢复源；本轮又核对ASAR cb0719b92cb50b86314dec7fba50104a1a5dc48f32cbe67386141102761f7d5b、broker 75049c1606d6303f8bf37df829740440a18c5f67d2765b74ce6afdae695d8b82，页面Worker 7bc14947c93bb16c8411f043445897700ce2a153252898443995f65888416953。没有为外部故障驱动重建或改包。

本条不证明DOCX可编辑写回、接受/拒绝修订、复制/键盘/导出保真、全部OOXML/宏或其他平台；W01–W06、W26、Y10/Y13等原用例独立保留，F19回归不重复计数。没有实际产品或驱动失败被隐藏，四个受控错误是预期分支并有原始错误和截图。目标active，继续独立优先，系统/人工协作最后；另一会话仍暂停，不触发发布。
