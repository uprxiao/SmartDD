const {contextBridge, webFrame} = require('electron');
const world = 1007;
webFrame.setIsolatedWorldInfo(world, {name: 'WillYou native prompt probe'});
// The exposed function can only call the existing native prompt, not App/IPC APIs.
contextBridge.exposeInMainWorld('__m12NativePromptProbe', (message, initial) => {
  let complete = false, value = null, failure;
  const source = '(()=>{if(typeof process!=="undefined"||typeof require!=="undefined")throw Error("Unexpected Node in prompt world");return window.prompt('+JSON.stringify(message)+','+JSON.stringify(initial)+');})()';
  const promise = webFrame.executeJavaScriptInIsolatedWorld(world, [{code: source}], false, (result, error) => {
    complete = true; value = result; failure = error;
  });
  void promise.catch(() => {});
  if (failure) throw failure;
  if (!complete) throw new Error('Native prompt execution did not settle synchronously');
  return value;
});
contextBridge.executeInMainWorld({func: () => {
  window.prompt = function (message = '', initial = '') {
    return window.__m12NativePromptProbe(String(message), String(initial));
  };
}});
