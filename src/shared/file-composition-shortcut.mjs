/** Keep editor commands out of an active IME without cancelling candidate keys. */
export function guardEditorComposition(event, ownsCommands = true) {
  if (!(event.nativeEvent?.isComposing || event.isComposing || event.keyCode === 229 || event.nativeEvent?.keyCode === 229)) return false;
  const command = ownsCommands && Boolean(event.metaKey) !== Boolean(event.ctrlKey) && !event.shiftKey && !event.altKey && !event.getModifierState?.('AltGraph');
  if (command && ['f', 's'].includes(event.key?.toLowerCase())) event.preventDefault();
  event.stopPropagation();
  return true;
}
