// Save / restore the whole general pasteboard (all items, all types), and set synthetic content for A75.
// Usage: clipboard save DIR | restore DIR | png FILE | file FILE | summary
import AppKit
let a = CommandLine.arguments, pb = NSPasteboard.general
func dir(_ p: String) -> URL { URL(fileURLWithPath: p, isDirectory: true) }
switch a.count > 1 ? a[1] : "summary" {
case "save":
  let d = dir(a[2]); try! FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
  var manifest: [[String]] = []
  for (i, item) in (pb.pasteboardItems ?? []).enumerated() {
    var types: [String] = []
    for (j, t) in item.types.enumerated() { if let data = item.data(forType: t) { try! data.write(to: d.appendingPathComponent("\(i)-\(j).bin")); types.append(t.rawValue) } else { types.append("") } }
    manifest.append(types)
  }
  try! JSONSerialization.data(withJSONObject: ["changeCount": pb.changeCount, "items": manifest]).write(to: d.appendingPathComponent("manifest.json"))
  print("saved \(manifest.count) items")
case "restore":
  let d = dir(a[2]); let m = try! JSONSerialization.jsonObject(with: Data(contentsOf: d.appendingPathComponent("manifest.json"))) as! [String: Any]
  let itemsTypes = m["items"] as! [[String]]
  var items: [NSPasteboardItem] = []
  for (i, types) in itemsTypes.enumerated() { let it = NSPasteboardItem(); for (j, t) in types.enumerated() where !t.isEmpty { if let data = try? Data(contentsOf: d.appendingPathComponent("\(i)-\(j).bin")) { it.setData(data, forType: NSPasteboard.PasteboardType(t)) } }; items.append(it) }
  pb.clearContents(); if !items.isEmpty { pb.writeObjects(items) }
  print("restored \(items.count) items")
case "png": pb.clearContents(); pb.setData(try! Data(contentsOf: URL(fileURLWithPath: a[2])), forType: .png); print("png set")
case "file":
  // Mirror a Finder copy: file URL, the legacy filenames list, and the file name as text.
  let url = URL(fileURLWithPath: a[2]); pb.clearContents()
  let item = NSPasteboardItem()
  item.setString(url.absoluteString, forType: .fileURL)
  item.setString(url.lastPathComponent, forType: .string)
  pb.writeObjects([item])
  pb.setPropertyList([url.path], forType: NSPasteboard.PasteboardType("NSFilenamesPboardType"))
  print("file set: " + (pb.types ?? []).map { $0.rawValue }.joined(separator: ","))
default:
  let items = pb.pasteboardItems ?? []
  print(items.map { $0.types.map { $0.rawValue }.joined(separator: ",") }.joined(separator: " | "))
}
