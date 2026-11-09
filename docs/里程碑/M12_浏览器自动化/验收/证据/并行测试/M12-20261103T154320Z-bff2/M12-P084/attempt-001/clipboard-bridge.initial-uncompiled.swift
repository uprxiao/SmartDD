import AppKit
import Foundation

// Test-only system clipboard bridge. No original clipboard bytes/text/hashes go to stdout.
struct Representation: Codable, Equatable { let type: String; let data: Data }
struct Item: Codable, Equatable { let representations: [Representation] }
struct Backup: Codable { let items: [Item]; let originalChangeCount: Int }
enum Failure: Error { case invalid(String) }
let args = CommandLine.arguments
guard args.count == 3, args[1] == "--backup" else { exit(64) }
let backupURL = URL(fileURLWithPath: args[2]).standardizedFileURL
let ownRoot = "/private/tmp/willyou-m12-t088-system-clipboard-001/runtime-001/"
guard backupURL.path == ownRoot + "clipboard-original.private.json" else { exit(64) }
let pb = NSPasteboard.general
var original: Backup?
var ownedCount: Int?
var ownedSnapshot: [Item]?
var restored = false
var touched = false

func snapshot() throws -> [Item] {
    let before = pb.changeCount
    var bytes = 0
    let items = try (pb.pasteboardItems ?? []).map { item in
        let representations = try item.types.sorted { $0.rawValue < $1.rawValue }.map { type in
            guard let data = item.data(forType: type) else { throw Failure.invalid("unavailable-representation-no-write") }
            bytes += data.count
            guard bytes <= 64 * 1024 * 1024 else { throw Failure.invalid("backup-budget-no-write") }
            return Representation(type: type.rawValue, data: data)
        }
        return Item(representations: representations)
    }
    guard pb.changeCount == before else { throw Failure.invalid("concurrent-clipboard-change-no-write") }
    return items
}
func writeItems(_ values: [Item]) throws {
    let objects = try values.map { value -> NSPasteboardItem in
        let item = NSPasteboardItem()
        for r in value.representations {
            guard item.setData(r.data, forType: NSPasteboard.PasteboardType(r.type)) else { throw Failure.invalid("restore-representation-failed") }
        }
        return item
    }
    pb.clearContents()
    if !objects.isEmpty && !pb.writeObjects(objects) { throw Failure.invalid("pasteboard-write-failed") }
}
func claimCurrent() throws {
    ownedCount = pb.changeCount
    ownedSnapshot = try snapshot()
    guard ownedCount == pb.changeCount else { throw Failure.invalid("concurrent-change-during-claim") }
}
func restore() throws -> [String: Any] {
    guard let prior = original else { return ["restored": false, "neverCaptured": true, "touched": false] }
    if restored { return ["restored": true, "alreadyRestored": true] }
    guard touched else { return ["restored": true, "noWriteNeeded": true] }
    guard ownedCount == pb.changeCount, let expected = ownedSnapshot, try snapshot() == expected else {
        throw Failure.invalid("concurrent-change-restore-deferred-private-backup-retained")
    }
    try writeItems(prior.items)
    guard try snapshot() == prior.items else { throw Failure.invalid("restoration-byte-comparison-failed-private-backup-retained") }
    restored = true
    try FileManager.default.removeItem(at: backupURL)
    return ["restored": true, "allOriginalItemsAndRepresentationsEqual": true, "privateBackupRemoved": true]
}
func emit(_ value: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
}
while let line = readLine() {
    do {
        guard let data = line.data(using: .utf8), let request = try JSONSerialization.jsonObject(with: data) as? [String: Any], let op = request["op"] as? String else { throw Failure.invalid("invalid-request") }
        switch op {
        case "capture-set-marker":
            guard original == nil, let marker = request["marker"] as? String, marker.hasPrefix("WILLYOU_M12_T088_") else { throw Failure.invalid("invalid-marker-or-duplicate") }
            let before = pb.changeCount
            let items = try snapshot()
            guard pb.changeCount == before else { throw Failure.invalid("concurrent-change-before-backup") }
            let backup = Backup(items: items, originalChangeCount: before)
            let backupData = try JSONEncoder().encode(backup)
            guard !FileManager.default.fileExists(atPath: backupURL.path) else { throw Failure.invalid("backup-path-must-be-new") }
            FileManager.default.createFile(atPath: backupURL.path, contents: nil, attributes: [.posixPermissions: 0o600])
            try backupData.write(to: backupURL)
            let saved = try JSONDecoder().decode(Backup.self, from: Data(contentsOf: backupURL))
            guard saved.items == items, pb.changeCount == before else { throw Failure.invalid("backup-verification-or-concurrent-change-no-write") }
            original = backup
            let markerItem = Item(representations: [Representation(type: NSPasteboard.PasteboardType.string.rawValue, data: Data(marker.utf8))])
            touched = true
            try writeItems([markerItem])
            try claimCurrent()
            guard pb.string(forType: .string) == marker else { throw Failure.invalid("marker-write-verification-failed") }
            emit(["ok": true, "op": op, "originalBackupComplete": true, "originalBackupMode0600": true, "markerMatches": true, "changeCount": pb.changeCount])
        case "observe-cli-write":
            guard touched, !restored, let expected = request["expected"] as? String, expected == "x" else { throw Failure.invalid("invalid-synthetic-expectation") }
            guard let before = ownedCount, pb.changeCount > before, pb.string(forType: .string) == expected else { throw Failure.invalid("system-clipboard-not-updated-to-x") }
            try claimCurrent()
            emit(["ok": true, "op": op, "systemValueEqualsSyntheticX": true, "changeCount": pb.changeCount])
        case "restore":
            var result = try restore(); result["ok"] = true; result["op"] = op; emit(result)
        case "finish":
            guard !touched || restored else { throw Failure.invalid("must-restore-before-finish") }
            emit(["ok": true, "op": op]); exit(0)
        default: throw Failure.invalid("unknown-operation")
        }
    } catch {
        emit(["ok": false, "error": String(describing: error), "credentialOrOriginalClipboardContentIncluded": false])
    }
}
// On controlled EOF attempt restoration; concurrent user changes are never overwritten.
do { let result = try restore(); emit(["eofCleanup": result]); exit(restored || !touched ? 0 : 2) }
catch { emit(["ok": false, "error": String(describing: error), "privateBackupRetained": true]); exit(2) }
