import AppKit
import CoreGraphics
import Foundation
func deny(_ message: String) -> Never { FileHandle.standardError.write(Data((message+"\n").utf8)); exit(2) }
let a = CommandLine.arguments
guard a.count == 3, let pid = Int32(a[1]), pid > 0 else { deny("Expected exact own PID and executable") }
guard let app = NSRunningApplication(processIdentifier:pid), app.executableURL?.path == a[2], !app.isTerminated, let birth = app.launchDate else { deny("Exact own running executable required") }
guard let rows = CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements], kCGNullWindowID) as? [[String:Any]] else { deny("Window metadata unavailable") }
let own = rows.filter { ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid }.map { row -> [String:Any] in
 var out:[String:Any] = [:]
 for k in [kCGWindowNumber,kCGWindowName,kCGWindowLayer,kCGWindowBounds,kCGWindowIsOnscreen,kCGWindowAlpha] { if let v = row[k as String] { out[k as String] = v } }
 return out
}
guard let again = NSRunningApplication(processIdentifier:pid), again.executableURL?.path == a[2], again.launchDate == birth, !again.isTerminated else { deny("Own PID identity changed during read") }
let result:[String:Any] = ["schema":"m12-own-window-metadata-v1","pid":pid,"executable":a[2],"launchTime":birth.timeIntervalSince1970,"windows":own,"capturePerformed":false,"inputPerformed":false,"otherWindowRowsReturned":0]
let data = try JSONSerialization.data(withJSONObject:result,options:[.sortedKeys])
FileHandle.standardOutput.write(data);FileHandle.standardOutput.write(Data([10]))
