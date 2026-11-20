// Read or select a keyboard input source by ID (A52 IME test only). Usage: inputsource current | list | select <id>
import Carbon
import Foundation
func idOf(_ s: TISInputSource) -> String { guard let p = TISGetInputSourceProperty(s, kTISPropertyInputSourceID) else { return "" }; return Unmanaged<CFString>.fromOpaque(p).takeUnretainedValue() as String }
let args = CommandLine.arguments
switch args.count > 1 ? args[1] : "current" {
case "list":
  let list = TISCreateInputSourceList([kTISPropertyInputSourceIsSelectCapable as String: true] as CFDictionary, false).takeRetainedValue() as! [TISInputSource]
  for s in list { print(idOf(s)) }
case "select":
  let list = TISCreateInputSourceList([kTISPropertyInputSourceID as String: args[2]] as CFDictionary, false).takeRetainedValue() as! [TISInputSource]
  guard let s = list.first else { print("missing"); exit(2) }
  let r = TISSelectInputSource(s); print(r == noErr ? "ok" : "err \(r)")
default:
  print(idOf(TISCopyCurrentKeyboardInputSource().takeRetainedValue()))
}
