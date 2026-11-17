// 无副作用的小工具：首页等入口只需要生成输入标识，不应加载任务区组件及其事件订阅。
export function newClientInputId() { return `in-${crypto.randomUUID().replace(/-/g, '')}`; }
