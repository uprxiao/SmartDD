// 输入法合成判断。React 合成事件不一定暴露 isComposing，原生事件与 keyCode 229 才可靠。
export const composing = event => !!(event?.nativeEvent?.isComposing || event?.isComposing || event?.keyCode === 229 || event?.nativeEvent?.keyCode === 229);
