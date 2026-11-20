// Read-only: what the Accessibility API reports as the focused element of a process.
import ApplicationServices
import Foundation
let pid = pid_t(Int32(CommandLine.arguments[1])!)
let app = AXUIElementCreateApplication(pid)
func attr(_ e: AXUIElement, _ n: String) -> AnyObject? { var v: AnyObject?; return AXUIElementCopyAttributeValue(e, n as CFString, &v) == .success ? v : nil }
print("trusted:", AXIsProcessTrusted())
print("manualAX:", attr(app, "AXManualAccessibility") as Any, "enhancedUI:", attr(app, "AXEnhancedUserInterface") as Any)
guard let f = attr(app, kAXFocusedUIElementAttribute) else { print("focused: <none>"); exit(0) }
let e = f as! AXUIElement
var settable: DarwinBoolean = false; AXUIElementIsAttributeSettable(e, kAXValueAttribute as CFString, &settable)
print("focused role:", attr(e, kAXRoleAttribute) as Any, "subrole:", attr(e, kAXSubroleAttribute) as Any, "valueSettable:", settable.boolValue)
if let v = attr(e, kAXValueAttribute) as? String { print("value prefix:", String(v.prefix(20))) }
