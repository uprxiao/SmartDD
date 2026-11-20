// Real OS mouse events for foreground acceptance only. Usage: osinput move X Y | click X Y [cmd]
import CoreGraphics
import Foundation
let a = CommandLine.arguments
guard a.count >= 4, let x = Double(a[2]), let y = Double(a[3]) else { print("usage"); exit(2) }
let p = CGPoint(x: x, y: y)
let src = CGEventSource(stateID: .hidSystemState)
func post(_ t: CGEventType, _ flags: CGEventFlags = []) { let e = CGEvent(mouseEventSource: src, mouseType: t, mouseCursorPosition: p, mouseButton: .left)!; e.flags = flags; e.post(tap: .cghidEventTap) }
switch a[1] {
case "move": post(.mouseMoved)
case "click":
  let flags: CGEventFlags = a.count > 4 && a[4] == "cmd" ? .maskCommand : []
  post(.mouseMoved); usleep(80_000); post(.leftMouseDown, flags); usleep(60_000); post(.leftMouseUp, flags)
default: print("usage"); exit(2)
}
print("ok")
