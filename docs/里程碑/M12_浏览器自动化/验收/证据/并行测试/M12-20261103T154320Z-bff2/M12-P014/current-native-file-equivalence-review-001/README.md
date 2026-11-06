两组文件的代码/数据载荷相同，但拒绝以旧真实Native I覆盖当前App025。

| 比较项 | Electron Framework | better_sqlite3.node |
| --- | --- | --- |
| 架构、Mach-O header | arm64，同 | arm64，同 |
| 全部section代码/数据 | 36个，全同 | 14个，全同 |
| imports/exports、dyld表、版本 | 同 | 同 |
| XML/DER entitlements | 双方均无 | 双方均无 |
| CodeDirectory flags | 0x20002 → 0x10002 | 0x20002 → 0x10002 |
| 签名hash页 | 4096 → 16384 | 4096 → 16384 |
| 文件尺寸 | 192054720 → 190956272 | 1966320 → 1973040 |

完整载荷证明不是简单忽略尾部：逐section SHA、全部load commands、imports/exports符号、dyld数据块和版本记录已比对；签名前缀仅掩码经文件布局验证的__LINKEDIT vmsize/filesize与LC_CODE_SIGNATURE datasize后完全相等。实际非签名前缀差异位置逐字节列在comparison.json，签名各自所有CodeDirectory SHA256页与原文件自洽。未执行codesign/otool或系统信任验证。

签名身份、hardened-runtime/linker-signed标志和SQLite execSegmentLimit确实变化；因此只允许机器码/数据载荷结论，旧I保持历史，不能登记当前I或整条通过。

旧P014 host.source.ts的窗口全为show:false/focusable:false/skipTaskbar:true，无键鼠/前台依赖；坐标仅由Emulation.setGeolocationOverride合成，生产respond为I前置而非真实用户A。准确旧runner及限制在old-I-background-candidate.safe.json。未来仍需Root Native资源及当前App025明确绑定，并保留原provider/OS阻塞分类、六技术段、原judge和清场。

本组全程仅文件读取与纯Python解析；0 Native/App/OS探针/HTTP/模型/实际认证；不持有UI资源，不改生产/公共账。
