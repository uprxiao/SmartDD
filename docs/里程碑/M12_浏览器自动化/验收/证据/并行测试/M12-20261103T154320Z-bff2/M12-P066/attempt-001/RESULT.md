# P066统一App017

P065稳定运行生命周期修复及软件回归后，P064002原Native I15项绿，统一生成arm64测试包。沿用已验证公共构建路径／Rust缓存；完整3671项源码／构建输入SHA与mode前后一致，构建退出0，六项原生smoke通过。固定Helper、CLI、identity与SOURCE哈希不变。

App：`/private/tmp/willyou-m12-s2-package-017/mac-arm64/WillYou.app`；ASAR `d6d82db473d5550c7b9a69d0d4412e38ce1120c95816d6c81e08b5fc4626407b`。新包为既有ad-hoc本地验收路径，未作x64／发行签名／公证／发布声明。prompt兼容仍未接入生产。构建不是原用例通过，下一步新隔离App实际UI授权／暂停／停止。
