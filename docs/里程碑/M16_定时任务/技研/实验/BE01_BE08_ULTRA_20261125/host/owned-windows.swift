import Foundation
import CoreGraphics
let args=CommandLine.arguments
let pid=Int(args.count==2 ? args[1] : "0") ?? 0
if pid<=1 { exit(2) }
let options:CGWindowListOption = [.optionAll,.excludeDesktopElements]
let raw=CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String:Any]] ?? []
let filtered=raw.filter { ($0[kCGWindowOwnerPID as String] as? Int)==pid }.map { w -> [String:Any] in
 var r:[String:Any]=[:]
 for key in [kCGWindowNumber,kCGWindowName,kCGWindowLayer,kCGWindowAlpha,kCGWindowIsOnscreen,kCGWindowBounds,kCGWindowOwnerPID] { if let v=w[key as String] { r[key as String]=v } }
 return r
}
let data=try JSONSerialization.data(withJSONObject:["ownerPid":pid,"screenCapturePermission":CGPreflightScreenCaptureAccess(),"windows":filtered],options:[.sortedKeys]);print(String(data:data,encoding:.utf8)!)
