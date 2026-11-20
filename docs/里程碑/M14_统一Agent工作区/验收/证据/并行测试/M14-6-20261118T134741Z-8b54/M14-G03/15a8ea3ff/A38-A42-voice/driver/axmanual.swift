// Set AXManualAccessibility on a process (what assistive tools do for Electron apps), then report the focused element.
import ApplicationServices
import Foundation
let pid = pid_t(Int32(CommandLine.arguments[1])!)
let app = AXUIElementCreateApplication(pid)
let r = AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
print("set AXManualAccessibility:", r.rawValue)
usleep(800_000)
var v: AnyObject?
if AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &v) == .success, let f = v {
  let e = f as! AXUIElement; var role: AnyObject?; AXUIElementCopyAttributeValue(e, kAXRoleAttribute as CFString, &role)
  print("focused role:", role as Any)
} else { print("focused: <none>") }
