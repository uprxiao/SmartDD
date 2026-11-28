# C25 B09.2：B13 三个原视觉状态双包实际复验

**独立归档结论：建议新增支持 B13-import-source、B13-import-confirm、B13-import-missing-browser 三个唯一原状态／12 个实际 1440 矩阵 key；不在此修改权威账。** 浅／深 × 480／900 宽；macOS arm64，真实 CSS 1440×900，DPR 2。旧包 12 张、C25 12 张实际原图，12 对，全部验证 SHA。未执行 1920、其余六态、真实成功导入、系统钥匙串授权或真实浏览器数据验收。

## 真实业务及隔离边界

- 双包实际主进程每组前后 HOME、SMARTDD_CLI_HOME、Node os.homedir() 都匹配本轮专属 source-only-mock-* 私有目录。两个实际 Electron app.getPath('home') 均不等于该目录，诚实保留：冻结旧包使用 Node home，C25 使用显式 CLI workspace home；精确包内源初始化、发现和早退代码与实际守卫闭合，而非假定 Electron 全局 home 已变。
- 私有 Local State 仅两条合成名称、两个普通 120B 存在性标记（未读标记内容），Edge 缺失。两包复验结束后 metadata SHA、同 inode/大小、两目录已恢复、无 held 目录，全独立只读核验。不读取任何日常浏览器、Cookie 数据库、系统安全存储或源凭据。
- 每组实际发现 → 下一步确认展示 → 返回 → 取消 → 完成，且确认分支只是展示，未提交。第二次分支创建同一 owned source 的确定性缺失：正常选择和进入确认后才将自建 Default 目录移开，实际唯一确认点击前再次校验同根与目录缺失；精确正常错误“所选浏览器或profile已不存在，请重新选择”出现时仍缺失，已知结果及关闭后才恢复。8 组实际 UI 顺序、缺失及恢复全部保留。双冻结包 discovery 为纯名称/存在性，精确缺失 guard 早于任何源内容／Keychain 路径且早于目标事务；结合实际执行路径可判定本轮**浏览器导入 Keychain 路径为 0 次**，不冒充整个进程的系统调用监控。原有隔离 App mock-storage 启动旗标不等于浏览器导入 key 夹具。
- 八个独立任务/项目/profile，24 次真实弹层预览与实际同 WC、同文档，旧包实际透明、不可聚焦 parked 根；C25 同一主根内隐藏的同 WC，均无可见前景原生页遮挡。正常取消／缺失错误均恢复原前景、同页/同 WC/profile/doc；目标 source=null、importState=ready，32 个业务检查点 journal 空，退出后两私有 journal 仍空。不声称真实登录态内容或成功导入验收。

## 原视觉目标复核

- 三态四组合实际原 M12 A 来源/哈希逐 key 核对。八张衍生三方板均逐图检查；当前 12 个 dialog/body、20 个 footer 按钮及 12 个 radio 的原相对几何精确，整体 y+18px（现有 M14 统一宿主垂直位置差，亦见 C24 final-clone 原验收）。标题、提示、确认四项内容换行、radio checked/disabled、缺失错误、按钮启用、原右面板遮罩与实际预览一致，无内容/横向溢出。
- 旧包 20 个 footer 全为继承的 14px/21px、无边框、5px 圆角；四个真实确认态 enabled 按钮指针对应上一页“下一步”点击位置，原主要底色被灰 hover 覆盖、明显对比不足。C25 的 20 个按钮全部回到原 12px/18px、1px、8px，并且原浅深边/文字/背景等 **140 项实际计算字段全一致**；四确认按钮实际指针仍在该按钮内而原主要底色正常。未发现这三态 C25 新产品目标样式红。
- 保留原 M12 1x 与本次真实 Retina 2x、任务外壳/输入栏/地址与固定 fixture 标识差、native radio 焦点色细微区别；不主张整幅像素相等、独立系统焦点覆盖或完整 native compositor 截图。

## 归档与清退

support/actual-selected.json 是原报告的严格白名单投影，含实际原报告及驱动 hash；support/independent-original-target-review.json 是原目标逐 key 实际几何、style、radio 及 pointer 比对。support/*preflight.json、精确包代码边界、原目标 manifest 和静态合成页是离线旁证，不冒充实际。两 App PID 46934/47571 均正常退出 0 / signal null，独立 ESRCH；61181/61186/64889/3425 独立 lsof 均 exit1 空，两个私有 data 无打开句柄，fixture closed，最终 secret/providerSecret 计数均0。未复制 DB、原日志、真实或合成凭据值、Cookie 标记内容或任何导入源内容；原图与原始私有报告保持不改。manifest.json、SHA256SUMS 可逐文件复核。
