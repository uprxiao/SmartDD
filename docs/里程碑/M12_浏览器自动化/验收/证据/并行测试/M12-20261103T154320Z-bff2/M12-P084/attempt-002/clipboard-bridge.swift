import AppKit
import Foundation
import Darwin

// Private test bridge. Never emit original item/type/value/hash.
// .general is evaluated only in the --general branch, never --self-test.
struct Representation: Codable, Equatable { let type: String; let data: Data }
struct Item: Codable, Equatable { let representations: [Representation] }
struct Backup: Codable, Equatable { let items: [Item]; let originalChangeCount: Int }
enum Failure: Error { case safe(String) }
let ownRoot = "/private/tmp/willyou-m12-t088-system-clipboard-002/runtime-001/"
let originalPath = ownRoot + "clipboard-original.private.json"
func require(_ condition: Bool, _ code: String) throws { if !condition { throw Failure.safe(code) } }
func code(_ error: Error) -> String { if case Failure.safe(let s) = error { return s }; return "bridge-internal-error-private-material-retained" }
func emit(_ value: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(value), let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else { exit(70) }
    FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10]))
}
func checkPrivateDirectory() throws {
    var s = Darwin.stat()
    try require(lstat(String(ownRoot.dropLast()), &s) == 0 && (s.st_mode & S_IFMT) == S_IFDIR && s.st_uid == getuid() && (s.st_mode & 0o077) == 0, "private-runtime-directory-required")
    guard let canonical = Darwin.realpath(String(ownRoot.dropLast()), nil) else { throw Failure.safe("private-runtime-canonical-read-failed") }
    defer { free(canonical) }
    let resolved = String(cString: canonical)
    try require(resolved == String(ownRoot.dropLast()), "private-runtime-symlink-rejected")
}
func secureBackup(_ backup: Backup, _ path: String) throws {
    try checkPrivateDirectory()
    try require(path.hasPrefix(ownRoot) && !path.dropFirst(ownRoot.count).contains("/"), "private-backup-path-required")
    let fd = open(path, O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW, mode_t(0o600))
    try require(fd >= 0, "exclusive-private-backup-create-failed-no-write")
    let file = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
    defer { try? file.close() }
    var s = Darwin.stat()
    try require(fchmod(fd, mode_t(0o600)) == 0 && fstat(fd, &s) == 0 && (s.st_mode & S_IFMT) == S_IFREG && s.st_uid == getuid() && (s.st_mode & 0o777) == 0o600 && s.st_nlink == 1, "private-backup-mode-verification-failed-no-write")
    try file.write(contentsOf: JSONEncoder().encode(backup)); try file.synchronize(); try file.seek(toOffset: 0)
    guard let saved = try file.readToEnd() else { throw Failure.safe("private-backup-readback-failed-no-write") }
    try require(try JSONDecoder().decode(Backup.self, from: saved) == backup, "private-backup-readback-mismatch-no-write")
}
final class ClipboardSession {
    let pb: NSPasteboard
    let backupPath: String
    let budget: Int
    var original: Backup?
    var ownedCount: Int?
    var ownedSnapshot: [Item]?
    var touched = false, restored = false, workQuiesced = false, writeArmed = false
    // This hook is instantiated only in named tests; general has none.
    var namedBeforeFirstWrite: (() -> Void)?
    init(_ pb: NSPasteboard, _ backupPath: String, budget: Int = 64 * 1024 * 1024) { self.pb = pb; self.backupPath = backupPath; self.budget = budget }
    func snapshot() throws -> [Item] {
        let before = pb.changeCount
        var bytes = 0
        let nativeItems = pb.pasteboardItems ?? []
        let declaredTypes = pb.types ?? []
        // Legacy/unmaterialized pasteboards must not be mistaken for empty.
        // A declared type not represented by any readable item is unsupported.
        let representedTypes = Set(nativeItems.flatMap { $0.types.map { $0.rawValue } })
        try require(declaredTypes.allSatisfy { representedTypes.contains($0.rawValue) }, "declared-format-not-captured-no-write")
        let values = try nativeItems.map { item -> Item in
            // Preserve item AND type order. No sorting/coercion to plain text.
            let reps = try item.types.map { type -> Representation in
                guard let data = item.data(forType: type) else { throw Failure.safe("unavailable-representation-no-write") }
                bytes += data.count
                try require(bytes <= budget, "backup-budget-no-write")
                return Representation(type: type.rawValue, data: data)
            }
            return Item(representations: reps)
        }
        try require(pb.changeCount == before, "concurrent-change-during-snapshot")
        return values
    }
    func objects(_ values: [Item]) throws -> [NSPasteboardItem] {
        try values.map { value in
            let item = NSPasteboardItem()
            for r in value.representations { try require(item.setData(r.data, forType: NSPasteboard.PasteboardType(r.type)), "pasteboard-representation-construction-failed") }
            return item
        }
    }
    func ownedMatches() throws -> Bool {
        guard let count = ownedCount, let expected = ownedSnapshot, count == pb.changeCount else { return false }
        return try snapshot() == expected && pb.changeCount == count
    }
    func captureSetMarker(_ marker: String) throws -> [String: Any] {
        try require(original == nil && marker.range(of: "^WILLYOU_M12_T088_[a-f0-9]{32}$", options: .regularExpression) != nil, "invalid-marker-or-duplicate")
        let before = pb.changeCount, items = try snapshot(), backup = Backup(items: items, originalChangeCount: before)
        try require(pb.changeCount == before, "concurrent-change-before-backup-no-write")
        try secureBackup(backup, backupPath); original = backup
        namedBeforeFirstWrite?()
        try require(pb.changeCount == before && (try snapshot()) == items, "concurrent-change-before-first-write-refused")
        let expected = [Item(representations: [Representation(type: NSPasteboard.PasteboardType.string.rawValue, data: Data(marker.utf8))])]
        let objects = try self.objects(expected)
        try require(pb.changeCount == before, "concurrent-change-immediately-before-first-write-refused")
        touched = true
        let cleared = pb.clearContents(); ownedCount = cleared; ownedSnapshot = []
        try require(pb.changeCount == cleared, "concurrent-change-after-clear-restore-deferred")
        try require(pb.writeObjects(objects), "marker-write-failed")
        let after = pb.changeCount, actual = try snapshot()
        try require(actual == expected && pb.changeCount == after, "marker-not-exact-no-claim")
        ownedCount = after; ownedSnapshot = actual
        return ["originalBackupComplete": true, "originalBackupMode0600": true, "markerMatches": true, "originalOrderPreserved": true]
    }
    func armCLIWrite() throws -> [String: Any] {
        try require(touched && !restored && !writeArmed && !workQuiesced && (try ownedMatches()), "owned-marker-changed-before-cli-write-refused")
        writeArmed = true
        return ["ownedStateVerifiedImmediatelyBeforeCLIWrite": true]
    }
    func isOnlySyntheticX(_ items: [Item]) -> Bool {
        guard items.count == 1, !items[0].representations.isEmpty else { return false }
        return items[0].representations.allSatisfy { r in
            switch r.type {
            case "public.utf8-plain-text", "NSStringPboardType": return String(data: r.data, encoding: .utf8) == "x"
            case "public.utf16-external-plain-text", "public.utf16-plain-text": return [String.Encoding.utf16, .utf16LittleEndian, .utf16BigEndian].contains { String(data: r.data, encoding: $0) == "x" }
            default: return false
            }
        }
    }
    func observeCLIWrite() throws -> [String: Any] {
        try require(writeArmed && !restored && !workQuiesced, "cli-write-not-armed")
        guard let previous = ownedCount else { throw Failure.safe("missing-owned-marker") }
        let count = pb.changeCount, values = try snapshot()
        try require(count > previous && count == pb.changeCount && isOnlySyntheticX(values), "system-clipboard-not-pure-synthetic-x-no-claim")
        ownedCount = count; ownedSnapshot = values; writeArmed = false
        return ["systemValueEqualsSyntheticX": true, "allCurrentRepresentationsOnlySyntheticX": true]
    }
    func restore() throws -> [String: Any] {
        try require(workQuiesced, "actual-app-and-cli-must-stop-before-restoration")
        guard let backup = original else { return ["restored": false, "neverCaptured": true, "touched": false] }
        if restored { return ["restored": true, "alreadyRestored": true] }
        if !touched { try? FileManager.default.removeItem(atPath: backupPath); restored = true; return ["restored": true, "noWriteNeeded": true] }
        try require(try ownedMatches(), "concurrent-change-restore-deferred-private-backup-retained")
        let objects = try self.objects(backup.items)
        // NSPasteboard has no atomic CAS. Last ownership check immediately
        // precedes clear/write; users must avoid concurrent copying during test.
        try require(try ownedMatches(), "concurrent-change-immediately-before-restore-deferred")
        let clearCount = pb.clearContents()
        try require(pb.changeCount == clearCount, "concurrent-change-during-restore-private-backup-retained")
        try require(objects.isEmpty || pb.writeObjects(objects), "restore-write-failed-private-backup-retained")
        try require(try snapshot() == backup.items, "restoration-item-type-data-or-order-mismatch-private-backup-retained")
        restored = true
        try FileManager.default.removeItem(atPath: backupPath)
        return ["restored": true, "allOriginalItemsTypesDataAndOrderEqual": true, "privateBackupRemoved": true]
    }
}
func setNamed(_ pb: NSPasteboard, _ values: [Item]) throws {
    let helper = ClipboardSession(pb, ownRoot + "not-used.private.json")
    let objects = try helper.objects(values); pb.clearContents()
    try require(objects.isEmpty || pb.writeObjects(objects), "named-fixture-write-failed")
}
final class MissingProvider: NSObject, NSPasteboardItemDataProvider {
    func pasteboard(_ pasteboard: NSPasteboard?, item: NSPasteboardItem, provideDataForType type: NSPasteboard.PasteboardType) { /* intentionally no promised named-only data */ }
}
func namedTests() throws {
    try checkPrivateDirectory()
    let pb = NSPasteboard.withUniqueName()
    var backupPaths: [String] = []
    defer { pb.clearContents(); pb.releaseGlobally(); for path in backupPaths { try? FileManager.default.removeItem(atPath: path) } }
    func session(_ budget: Int = 64 * 1024 * 1024) -> ClipboardSession { let path = ownRoot + "named-" + UUID().uuidString + ".private.json"; backupPaths.append(path); return ClipboardSession(pb, path, budget: budget) }
    func expect(_ expected: String, _ action: () throws -> Void) throws { do { try action(); throw Failure.safe("named-negative-control-did-not-reject") } catch { try require(code(error) == expected, "named-negative-control-wrong-failure") } }
    let marker = "WILLYOU_M12_T088_00000000000000000000000000000000"
    let samples = [Item(representations: [Representation(type: "public.utf8-plain-text", data: Data("SYNTHETIC_A".utf8)), Representation(type: "com.willyou.t088.binary", data: Data([0, 255, 1, 2]))]), Item(representations: [Representation(type: "public.html", data: Data("<b>SYNTHETIC_B</b>".utf8)), Representation(type: "public.rtf", data: Data("{\\rtf1 SYNTHETIC_B}".utf8))])]
    try setNamed(pb, samples); let first = session(); let before = try first.snapshot()
    _ = try first.captureSetMarker(marker); _ = try first.armCLIWrite()
    try setNamed(pb, [Item(representations: [Representation(type: "public.utf8-plain-text", data: Data("x".utf8))])]); _ = try first.observeCLIWrite(); first.workQuiesced = true
    let round = try first.restore(); try require(round["allOriginalItemsTypesDataAndOrderEqual"] as? Bool == true && (try first.snapshot()) == before, "named-roundtrip-failed")
    emit(["test": "multi-item-multi-type-ordered-byte-roundtrip", "ok": true, "namedOnly": true])
    try setNamed(pb, samples); let budget = session(1), budgetBefore = pb.changeCount
    try expect("backup-budget-no-write") { _ = try budget.captureSetMarker(marker) }; try require(pb.changeCount == budgetBefore && !budget.touched, "budget-control-wrote")
    emit(["test": "budget-refuses-before-write", "ok": true, "namedOnly": true])
    let provider = MissingProvider(), missing = NSPasteboardItem(), missingType = NSPasteboard.PasteboardType("com.willyou.t088.unavailable")
    try require(missing.setDataProvider(provider, forTypes: [missingType]), "named-provider-setup-failed"); pb.clearContents(); try require(pb.writeObjects([missing]), "named-provider-write-failed")
    let unavailable = session(), unavailableBefore = pb.changeCount
    try expect("unavailable-representation-no-write") { _ = try unavailable.captureSetMarker(marker) }; try require(pb.changeCount == unavailableBefore && !unavailable.touched, "unavailable-control-wrote")
    emit(["test": "unreadable-refuses-before-write", "ok": true, "namedOnly": true])
    try setNamed(pb, samples); let concurrent = session()
    concurrent.namedBeforeFirstWrite = { pb.clearContents(); _ = pb.setString("NAMED_EXTERNAL", forType: .string) }
    try expect("concurrent-change-before-first-write-refused") { _ = try concurrent.captureSetMarker(marker) }; try require(!concurrent.touched && pb.string(forType: .string) == "NAMED_EXTERNAL", "concurrent-before-write-overwritten")
    emit(["test": "concurrent-before-first-write-refused", "ok": true, "namedOnly": true])
    try setNamed(pb, samples); let collision = session(); try Data("DUMMY_EXISTING".utf8).write(to: URL(fileURLWithPath: collision.backupPath)); let collisionBefore = pb.changeCount
    try expect("exclusive-private-backup-create-failed-no-write") { _ = try collision.captureSetMarker(marker) }; try require(pb.changeCount == collisionBefore && !collision.touched && (try Data(contentsOf: URL(fileURLWithPath: collision.backupPath))) == Data("DUMMY_EXISTING".utf8), "exclusive-backup-control-clobbered")
    emit(["test": "existing-backup-refuses-without-clobber", "ok": true, "namedOnly": true])
    try setNamed(pb, samples); let conflict = session(); _ = try conflict.captureSetMarker(marker); pb.clearContents(); _ = pb.setString("NAMED_USER_NEW", forType: .string); conflict.workQuiesced = true
    try expect("concurrent-change-restore-deferred-private-backup-retained") { _ = try conflict.restore() }; try require(pb.string(forType: .string) == "NAMED_USER_NEW" && FileManager.default.fileExists(atPath: conflict.backupPath), "restore-conflict-control-overwritten")
    emit(["test": "restore-conflict-preserves-new-state-and-private-backup", "ok": true, "namedOnly": true])
    try setNamed(pb, samples); let wrong = session(); _ = try wrong.captureSetMarker(marker); _ = try wrong.armCLIWrite(); try setNamed(pb, [Item(representations: [Representation(type: "public.utf8-plain-text", data: Data("x".utf8)), Representation(type: "com.willyou.t088.other", data: Data("OTHER".utf8))])])
    try expect("system-clipboard-not-pure-synthetic-x-no-claim") { _ = try wrong.observeCLIWrite() }
    emit(["test": "mixed-x-never-claimed", "ok": true, "namedOnly": true])
    try setNamed(pb, samples); let preWrite = session(); _ = try preWrite.captureSetMarker(marker); pb.clearContents(); _ = pb.setString("NAMED_NEW_BEFORE_CLI", forType: .string)
    try expect("owned-marker-changed-before-cli-write-refused") { _ = try preWrite.armCLIWrite() }; try require(pb.string(forType: .string) == "NAMED_NEW_BEFORE_CLI", "pre-cli-control-overwritten")
    emit(["test": "owned-marker-change-refuses-cli-write", "ok": true, "namedOnly": true])
    emit(["selfTestComplete": true, "ok": true, "namedOnly": true, "generalPasteboardAccessed": false, "tests": 8])
}
let args = CommandLine.arguments
if args.count == 2 && args[1] == "--self-test" {
    do { try namedTests(); exit(0) } catch { emit(["ok": false, "namedOnly": true, "errorCode": code(error)]); exit(2) }
}
guard args.count == 4 && args[1] == "--general" && args[2] == "--backup" && args[3] == originalPath else { exit(64) }
do { try checkPrivateDirectory() } catch { emit(["ok": false, "errorCode": code(error)]); exit(2) }
let session = ClipboardSession(NSPasteboard.general, originalPath)
while let line = readLine() {
    var requestId = "invalid"
    do {
        guard let d = line.data(using: .utf8), let v = try JSONSerialization.jsonObject(with: d) as? [String: Any], let op = v["op"] as? String, let id = v["id"] as? String, id.range(of: "^[a-z0-9-]{1,40}$", options: .regularExpression) != nil else { throw Failure.safe("invalid-request") }
        requestId = id
        var result: [String: Any]
        switch op {
        case "capture-set-marker": guard let marker = v["marker"] as? String else { throw Failure.safe("invalid-marker") }; result = try session.captureSetMarker(marker)
        case "arm-cli-write": result = try session.armCLIWrite()
        case "observe-cli-write": result = try session.observeCLIWrite()
        case "work-quiesced": session.workQuiesced = true; result = ["workQuiesced": true]
        case "restore": result = try session.restore()
        case "finish": try require(!session.touched || session.restored, "must-restore-before-finish"); emit(["id": id, "op": op, "ok": true]); exit(0)
        default: throw Failure.safe("unknown-operation")
        }
        result["id"] = id; result["op"] = op; result["ok"] = true; result["generalSystemPasteboard"] = true; emit(result)
    } catch { emit(["id": requestId, "ok": false, "errorCode": code(error), "privateBackupRetainedIfCreated": true, "originalContentIncluded": false]) }
}
// Unexpected EOF cannot prove a pending native write has stopped. Never restore
// before quiescence; retain private recovery material instead of racing a write.
if session.workQuiesced {
    do { let value = try session.restore(); emit(["eofCleanup": value, "originalContentIncluded": false]); exit(session.restored || !session.touched ? 0 : 2) }
    catch { emit(["ok": false, "errorCode": code(error), "privateBackupRetainedIfCreated": true]); exit(2) }
}
emit(["ok": false, "errorCode": "uncontrolled-eof-recovery-deferred-until-app-stopped", "privateBackupRetainedIfCreated": true]); exit(2)
