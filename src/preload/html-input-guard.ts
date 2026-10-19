// Runs in the HTML document's isolated preload world, before document scripts.
// No IPC, Node API or application object is exposed to the document. Chromium's
// native chooser is separately denied by the main-process host.
export function installHtmlInputGuard(target: Window): void {
  const stop = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  for (const name of ['dragenter', 'dragover', 'drop']) target.addEventListener(name, stop, { capture: true });
  target.addEventListener('paste', (event) => {
    const data = (event as ClipboardEvent).clipboardData;
    if (data && (data.files.length || Array.from(data.items).some((item) => item.kind === 'file'))) stop(event);
  }, { capture: true });
}
