import AppKit
import Foundation
import Darwin

// Private test bridge. Never emit original item/type/value/hash.
// .general is evaluated only in the --general branch, never --self-test.
struct Representation: Codable, Equatable { let type: String; let data: Data }
struct Item: Codable, Equatable { let representations: [Representation] }
struct Backup: Codable, Equatable { let items: [Item]; let originalChangeCount: Int }
enum Failure: Error { case safe(String) }
let ownRoot = "/private/tmp/willyou-m12-t130-D23-active-root-App036-A-prep-001/clipboard-control-001/"
let originalPath = ownRoot + "clipboard-original-D23.private.json"

// D23-only immutable binding; never an arbitrary-path clipboard tool.
let d23OwnedPaths: [String] = ["/private/tmp/willyou-m12-t130-D23-active-root-App036-A-prep-001/runtime-001/light/root-A/a.md", "/private/tmp/willyou-m12-t130-D23-active-root-App036-A-prep-001/runtime-001/light/root-A/b.md", "/private/tmp/willyou-m12-t130-D23-active-root-App036-A-prep-001/runtime-001/light/root-B/a.md", "/private/tmp/willyou-m12-t130-D23-active-root-App036-A-prep-001/runtime-001/light/root-B/b.md", "/private/tmp/willyou-m12-t130-D23-active-root-App036-A-prep-001/runtime-001/dark/root-A/a.md", "/private/tmp/willyou-m12-t130-D23-active-root-App036-A-prep-001/runtime-001/dark/root-A/b.md", "/private/tmp/willyou-m12-t130-D23-active-root-App036-A-prep-001/runtime-001/dark/root-B/a.md", "/private/tmp/willyou-m12-t130-D23-active-root-App036-A-prep-001/runtime-001/dark/root-B/b.md"]
let d23RendererSourceURL = "file:///private/tmp/willyou-m12-app036-installer-001/Installed%20Applications/WillYou.app/Contents/Resources/app.asar/out/renderer/index.html"
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
    let namedDiagnostics: Bool
    var namedDiagnosticEmitted = false
    var original: Backup?
    var ownedCount: Int?
    var ownedSnapshot: [Item]?
    var touched = false, restored = false, workQuiesced = false, writeArmed = false
    var expectedSourceURL: String?
    var expectedOwnedPath: String?
    // This hook is instantiated only in named tests; general has none.
    var namedBeforeFirstWrite: (() -> Void)?
    init(_ pb: NSPasteboard, _ backupPath: String, budget: Int = 64 * 1024 * 1024, namedDiagnostics: Bool = false) { self.pb = pb; self.backupPath = backupPath; self.budget = budget; self.namedDiagnostics = namedDiagnostics }
    func snapshot() throws -> [Item] {
        let before = pb.changeCount
        var bytes = 0
        guard let nativeItems = pb.pasteboardItems else { throw Failure.safe("pasteboard-items-unavailable-no-write") }
        let declaredTypes = pb.types ?? []
        // Board-level legacy/aggregate types are not the per-item UTI set.
        // Reject inaccessible legacy-only contents; preserve every item UTI.
        try require(!nativeItems.isEmpty || declaredTypes.isEmpty, "declared-formats-without-readable-items-no-write")
        if namedDiagnostics && !namedDiagnosticEmitted {
            emit(["namedTypeDiagnostic": true, "namedOnly": true, "boardTypes": declaredTypes.map { $0.rawValue }, "itemTypes": nativeItems.map { $0.types.map { $0.rawValue } }, "generalPasteboardAccessed": false])
            namedDiagnosticEmitted = true
        }
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

    // Dedicated D23 mode. Original x/site mode below is unchanged legacy, not a path validator.
    func armOwnedPathCopy(_ path: String, _ sourceURL: String) throws -> [String: Any] {
        try require(touched && !restored && !writeArmed && !workQuiesced && (try ownedMatches()), "owned-marker-changed-before-path-copy-refused")
        try require(d23OwnedPaths.contains(path) && sourceURL == d23RendererSourceURL, "exact-d23-path-and-renderer-required")
        expectedOwnedPath = path; expectedSourceURL = sourceURL; writeArmed = true
        return ["ownedStateVerifiedImmediatelyBeforePathCopy": true, "exactD23Binding": true]
    }
    func ownedPathWithExactProvenance(_ items: [Item]) -> String? {
        guard expectedSourceURL == d23RendererSourceURL, items.count == 1, !items[0].representations.isEmpty else { return nil }
        let types = items[0].representations.map { $0.type }
        guard Set(types).count == types.count else { return nil }
        var path: String?, sourceSeen = false, tokenSeen = false
        for r in items[0].representations {
            switch r.type {
            case "public.utf8-plain-text", "NSStringPboardType":
                guard let value = String(data: r.data, encoding: .utf8), d23OwnedPaths.contains(value), path == nil || path == value else { return nil }; path = value
            case "public.utf16-external-plain-text", "public.utf16-plain-text":
                let values = [String.Encoding.utf16, .utf16LittleEndian, .utf16BigEndian].compactMap { String(data: r.data, encoding: $0) }.filter { d23OwnedPaths.contains($0) }
                guard let value = values.first, values.allSatisfy({ $0 == value }), path == nil || path == value else { return nil }; path = value
            case "org.chromium.source-url":
                guard r.data == Data(d23RendererSourceURL.utf8) else { return nil }; sourceSeen = true
            case "org.chromium.internal.source-rfh-token":
                guard r.data.count == 24 else { return nil }; tokenSeen = true
            default: return nil
            }
        }
        guard let value = path, sourceSeen == tokenSeen else { return nil }
        return value
    }
    func observeOwnedPathCopy() throws -> [String: Any] {
        try require(writeArmed && expectedOwnedPath != nil && !restored && !workQuiesced, "d23-path-copy-not-armed")
        guard let previous = ownedCount else { throw Failure.safe("missing-owned-marker") }
        let count = pb.changeCount, values = try snapshot()
        guard count > previous && count == pb.changeCount, let value = ownedPathWithExactProvenance(values), let fixtureID = d23OwnedPaths.firstIndex(of: value) else { throw Failure.safe("system-clipboard-not-exact-d23-fixture-no-claim") }
        ownedCount = count; ownedSnapshot = values; writeArmed = false
        return ["ownedD23FixtureClaimed": true, "fixtureID": fixtureID, "systemValueEqualsRequestedPath": value == expectedOwnedPath, "allRepresentationsExactOwnedTextOrExactChromiumProvenance": true]
    }
    func armCLIWrite(_ sourceURL: String) throws -> [String: Any] {
        try require(touched && !restored && !writeArmed && !workQuiesced && (try ownedMatches()), "owned-marker-changed-before-cli-write-refused")
        guard let url = URLComponents(string: sourceURL), let port = url.port else { throw Failure.safe("exact-owned-source-url-required") }
        try require(url.scheme == "http" && url.host == "127.0.0.1" && (1...65535).contains(port) && url.path == "/site" && url.user == nil && url.password == nil && url.query == nil && url.fragment == nil && url.string == sourceURL, "exact-owned-source-url-required")
        expectedSourceURL = sourceURL
        writeArmed = true
        return ["ownedStateVerifiedImmediatelyBeforeCLIWrite": true, "exactFixtureSourceURLBoundBeforeCLIWrite": true]
    }
    func isSyntheticXWithOwnedProvenance(_ items: [Item]) -> Bool {
        guard let sourceURL = expectedSourceURL, items.count == 1, !items[0].representations.isEmpty else { return false }
        var textSeen = false, sourceSeen = false, tokenSeen = false
        let types = items[0].representations.map { $0.type }
        guard Set(types).count == types.count else { return false }
        for r in items[0].representations {
            switch r.type {
            case "public.utf8-plain-text", "NSStringPboardType":
                guard String(data: r.data, encoding: .utf8) == "x" else { return false }; textSeen = true
            case "public.utf16-external-plain-text", "public.utf16-plain-text":
                guard [String.Encoding.utf16, .utf16LittleEndian, .utf16BigEndian].contains(where: { String(data: r.data, encoding: $0) == "x" }) else { return false }; textSeen = true
            case "org.chromium.source-url":
                guard r.data == Data(sourceURL.utf8) else { return false }; sourceSeen = true
            case "org.chromium.internal.source-rfh-token":
                guard r.data.count == 24 else { return false }; tokenSeen = true
            default: return false
            }
        }
        return textSeen && sourceSeen == tokenSeen
    }
    func observeCLIWrite() throws -> [String: Any] {
        try require(writeArmed && !restored && !workQuiesced, "cli-write-not-armed")
        guard let previous = ownedCount else { throw Failure.safe("missing-owned-marker") }
        let count = pb.changeCount, values = try snapshot()
        try require(count > previous && count == pb.changeCount && isSyntheticXWithOwnedProvenance(values), "system-clipboard-not-pure-synthetic-x-no-claim")
        ownedCount = count; ownedSnapshot = values; writeArmed = false
        return ["systemValueEqualsSyntheticX": true, "allCurrentRepresentationsSyntheticXOrExactChromiumProvenance": true, "exactFixtureSourceURLBoundBeforeCLIWrite": true]
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
    let namedBoardName = pb.name.rawValue
    emit(["namedBoardCreated": true, "namedOnly": true, "namedBoardName": namedBoardName, "generalPasteboardAccessed": false])
    var backupPaths: [String] = []
    defer {
        pb.clearContents(); pb.releaseGlobally()
        for path in backupPaths { try? FileManager.default.removeItem(atPath: path) }
        emit(["namedCleanup": true, "namedOnly": true, "namedBoardName": namedBoardName, "clearContentsCalled": true, "releaseGloballyCalled": true, "remainingSyntheticBackups": backupPaths.filter { FileManager.default.fileExists(atPath: $0) }.count, "generalPasteboardAccessed": false])
    }
    func session(_ budget: Int = 64 * 1024 * 1024) -> ClipboardSession { let path = ownRoot + "named-" + UUID().uuidString + ".private.json"; backupPaths.append(path); return ClipboardSession(pb, path, budget: budget, namedDiagnostics: true) }
    func expect(_ expected: String, _ action: () throws -> Void) throws { do { try action(); throw Failure.safe("named-negative-control-did-not-reject") } catch { try require(code(error) == expected, "named-negative-control-wrong-failure") } }
    let marker = "WILLYOU_M12_T088_00000000000000000000000000000000"
    let sourceURL = "http://127.0.0.1:12345/site"
    let samples = [Item(representations: [Representation(type: "public.utf8-plain-text", data: Data("SYNTHETIC_A".utf8)), Representation(type: "com.willyou.t088.binary", data: Data([0, 255, 1, 2]))]), Item(representations: [Representation(type: "public.html", data: Data("<b>SYNTHETIC_B</b>".utf8)), Representation(type: "public.rtf", data: Data("{\\rtf1 SYNTHETIC_B}".utf8))])]
    try setNamed(pb, samples); let first = session(); let before = try first.snapshot()
    _ = try first.captureSetMarker(marker); _ = try first.armCLIWrite(sourceURL)
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
    try setNamed(pb, samples); let wrong = session(); _ = try wrong.captureSetMarker(marker); _ = try wrong.armCLIWrite(sourceURL); try setNamed(pb, [Item(representations: [Representation(type: "public.utf8-plain-text", data: Data("x".utf8)), Representation(type: "com.willyou.t088.other", data: Data("OTHER".utf8))])])
    try expect("system-clipboard-not-pure-synthetic-x-no-claim") { _ = try wrong.observeCLIWrite() }
    emit(["test": "mixed-x-never-claimed", "ok": true, "namedOnly": true])
    try setNamed(pb, samples); let preWrite = session(); _ = try preWrite.captureSetMarker(marker); pb.clearContents(); _ = pb.setString("NAMED_NEW_BEFORE_CLI", forType: .string)
    try expect("owned-marker-changed-before-cli-write-refused") { _ = try preWrite.armCLIWrite(sourceURL) }; try require(pb.string(forType: .string) == "NAMED_NEW_BEFORE_CLI", "pre-cli-control-overwritten")
    emit(["test": "owned-marker-change-refuses-cli-write", "ok": true, "namedOnly": true])
    func provenance(_ url: String) -> [Representation] {
        return [Representation(type: "public.utf8-plain-text", data: Data("x".utf8)), Representation(type: "org.chromium.source-url", data: Data(url.utf8)), Representation(type: "org.chromium.internal.source-rfh-token", data: Data(repeating: 7, count: 24))]
    }
    try setNamed(pb, samples); let known = session(); let knownOriginal = try known.snapshot(); _ = try known.captureSetMarker(marker); _ = try known.armCLIWrite(sourceURL)
    try setNamed(pb, [Item(representations: provenance(sourceURL))]); _ = try known.observeCLIWrite(); known.workQuiesced = true; _ = try known.restore(); try require(try known.snapshot() == knownOriginal, "named-provenance-roundtrip-failed")
    emit(["test": "exact-fixture-chromium-provenance-accepted-and-restored", "ok": true, "namedOnly": true])
    try setNamed(pb, samples); let wrongSource = session(); _ = try wrongSource.captureSetMarker(marker); _ = try wrongSource.armCLIWrite(sourceURL)
    try setNamed(pb, [Item(representations: provenance("http://127.0.0.1:12346/site"))]); let wrongSourceBefore = try wrongSource.snapshot(); let wrongSourceCount = pb.changeCount
    try expect("system-clipboard-not-pure-synthetic-x-no-claim") { _ = try wrongSource.observeCLIWrite() }; try require(pb.changeCount == wrongSourceCount && (try wrongSource.snapshot()) == wrongSourceBefore, "named-wrong-source-overwritten")
    emit(["test": "wrong-fixture-chromium-source-refused-no-claim", "ok": true, "namedOnly": true])
    try setNamed(pb, samples); let unknownFormat = session(); _ = try unknownFormat.captureSetMarker(marker); _ = try unknownFormat.armCLIWrite(sourceURL)
    var unknownReps = provenance(sourceURL); unknownReps.append(Representation(type: "com.willyou.t088.unknown", data: Data([9])))
    try setNamed(pb, [Item(representations: unknownReps)]); let unknownBefore = try unknownFormat.snapshot(); let unknownCount = pb.changeCount
    try expect("system-clipboard-not-pure-synthetic-x-no-claim") { _ = try unknownFormat.observeCLIWrite() }; try require(pb.changeCount == unknownCount && (try unknownFormat.snapshot()) == unknownBefore, "named-unknown-format-overwritten")
    emit(["test": "unknown-provenance-format-refused-no-claim", "ok": true, "namedOnly": true])
    emit(["selfTestComplete": true, "ok": true, "namedOnly": true, "generalPasteboardAccessed": false, "tests": 11])
}

// Qualification only: no general pasteboard expression, no production entry loop.
func d23NamedQualification() throws {
    try checkPrivateDirectory()
    let pb = NSPasteboard.withUniqueName()
    var paths: [String] = []
    var tests = 0
    defer {
        pb.clearContents(); pb.releaseGlobally()
        var cleanupFailed = false
        for path in paths {
            var st = Darwin.stat()
            if lstat(path, &st) == 0 {
                if (st.st_mode & S_IFMT) == S_IFREG && st.st_uid == getuid() && st.st_nlink == 1 && (st.st_mode & 0o777) == 0o600 {
                    do { try FileManager.default.removeItem(atPath: path) } catch { cleanupFailed = true }
                } else { cleanupFailed = true }
            } else if errno != ENOENT { cleanupFailed = true }
        }
        let remaining = paths.filter { FileManager.default.fileExists(atPath: $0) }.count
        emit(["namedCleanup": true, "clearContentsCalled": true, "releaseGloballyCalled": true, "remainingSyntheticBackups": remaining, "cleanupFailed": cleanupFailed, "generalAccessed": false])
        if cleanupFailed || remaining != 0 { exit(3) }
    }
    func fresh() -> ClipboardSession {
        let path = ownRoot + "qualification-D23-named-" + UUID().uuidString + ".private.json"
        paths.append(path)
        return ClipboardSession(pb, path)
    }
    func expect(_ expected: String, _ action: () throws -> Void) throws {
        do { try action(); throw Failure.safe("named-path-negative-did-not-reject") }
        catch { try require(code(error) == expected, "named-path-negative-wrong-error") }
    }
    func done(_ name: String) { tests += 1; emit(["test": name, "ok": true, "namedOnly": true, "generalAccessed": false]) }
    let A = d23OwnedPaths[0], B = d23OwnedPaths[2]
    let marker = "WILLYOU_M12_T088_00000000000000000000000000000000"
    let original = [Item(representations: [Representation(type: "public.utf8-plain-text", data: Data("NAMED_SYNTHETIC_A".utf8)), Representation(type: "com.willyou.d23.binary", data: Data([0,255,1,2]))]), Item(representations: [Representation(type: "public.html", data: Data("<b>NAMED_SYNTHETIC_B</b>".utf8)), Representation(type: "public.rtf", data: Data("{\\rtf1 NAMED_SYNTHETIC_B}".utf8))])]
    func text(_ value: String) -> [Item] { return [Item(representations: [Representation(type: "public.utf8-plain-text", data: Data(value.utf8))])] }
    func begin() throws -> ClipboardSession {
        try setNamed(pb, original)
        let session = fresh(); _ = try session.captureSetMarker(marker)
        return session
    }
    func arm(_ session: ClipboardSession) throws { _ = try session.armOwnedPathCopy(A, d23RendererSourceURL) }
    func roundtrip(_ session: ClipboardSession) throws {
        session.workQuiesced = true
        let result = try session.restore()
        try require(result["allOriginalItemsTypesDataAndOrderEqual"] as? Bool == true && (try session.snapshot()) == original && !FileManager.default.fileExists(atPath: session.backupPath), "named-path-original-roundtrip-failed")
    }
    let matched = try begin(); try arm(matched); try setNamed(pb, text(A)); let match = try matched.observeOwnedPathCopy()
    try require(match["ownedD23FixtureClaimed"] as? Bool == true && match["systemValueEqualsRequestedPath"] as? Bool == true && match["fixtureID"] as? Int == 0, "named-path-A-not-matched")
    try roundtrip(matched); done("A-copy-matched-all-original-items-types-data-order-roundtrip")
    let wrongOwn = try begin(); try arm(wrongOwn); try setNamed(pb, text(B)); let wrong = try wrongOwn.observeOwnedPathCopy()
    try require(wrong["ownedD23FixtureClaimed"] as? Bool == true && wrong["systemValueEqualsRequestedPath"] as? Bool == false && wrong["fixtureID"] as? Int == 2, "named-path-B-wrong-business-match")
    try roundtrip(wrongOwn); done("own-B-safely-claimed-business-match-false-roundtrip")
    let invalidArm = try begin(), armCount = pb.changeCount, armState = try invalidArm.snapshot()
    try expect("exact-d23-path-and-renderer-required") { _ = try invalidArm.armOwnedPathCopy(ownRoot + "not-a-fixture.md", d23RendererSourceURL) }
    try require(pb.changeCount == armCount && (try invalidArm.snapshot()) == armState && !invalidArm.writeArmed, "named-path-unowned-arm-wrote")
    try roundtrip(invalidArm); done("non-whitelist-request-refused-before-write")
    let originArm = try begin(), originCount = pb.changeCount, originState = try originArm.snapshot()
    try expect("exact-d23-path-and-renderer-required") { _ = try originArm.armOwnedPathCopy(A, "file:///wrong-synthetic-renderer/index.html") }
    try require(pb.changeCount == originCount && (try originArm.snapshot()) == originState && !originArm.writeArmed, "named-path-wrong-origin-arm-wrote")
    try roundtrip(originArm); done("wrong-origin-request-refused-before-write")
    func rejectObserved(_ value: [Item], _ name: String) throws {
        let session = try begin(); try arm(session); try setNamed(pb, value)
        let count = pb.changeCount, before = try session.snapshot(), previousOwned = session.ownedCount
        try expect("system-clipboard-not-exact-d23-fixture-no-claim") { _ = try session.observeOwnedPathCopy() }
        try require(pb.changeCount == count && (try session.snapshot()) == before && session.ownedCount == previousOwned && session.writeArmed && FileManager.default.fileExists(atPath: session.backupPath), "named-path-invalid-observation-wrote-or-claimed")
        done(name)
    }
    try rejectObserved(text(ownRoot + "not-a-fixture.md"), "non-whitelist-actual-path-no-claim-no-overwrite")
    func withProvenance(_ url: String) -> [Representation] { return [Representation(type: "public.utf8-plain-text", data: Data(A.utf8)), Representation(type: "org.chromium.source-url", data: Data(url.utf8)), Representation(type: "org.chromium.internal.source-rfh-token", data: Data(repeating: 7, count: 24))] }
    try rejectObserved([Item(representations: withProvenance("file:///wrong-synthetic-renderer/index.html"))], "wrong-observed-origin-no-claim-no-overwrite")
    var unknown = withProvenance(d23RendererSourceURL); unknown.append(Representation(type: "com.willyou.d23.unknown", data: Data([9])))
    try rejectObserved([Item(representations: unknown)], "unknown-format-no-claim-no-overwrite")
    try rejectObserved([Item(representations: [Representation(type: "public.utf8-plain-text", data: Data(A.utf8)), Representation(type: "org.chromium.source-url", data: Data(d23RendererSourceURL.utf8))])], "unpaired-chromium-metadata-no-claim-no-overwrite")
    let paired = try begin(); try arm(paired); try setNamed(pb, [Item(representations: withProvenance(d23RendererSourceURL))]); let pairedResult = try paired.observeOwnedPathCopy()
    try require(pairedResult["systemValueEqualsRequestedPath"] as? Bool == true, "named-path-paired-origin-not-matched")
    try roundtrip(paired); done("exact-Chromium-origin-token-pair-roundtrip")
    let concurrent = try begin(); try arm(concurrent); try setNamed(pb, text(A)); _ = try concurrent.observeOwnedPathCopy()
    try setNamed(pb, [Item(representations: [Representation(type: "public.utf8-plain-text", data: Data("NAMED_CONCURRENT_NEW".utf8))])])
    let externalCount = pb.changeCount, externalState = try concurrent.snapshot(); concurrent.workQuiesced = true
    try expect("concurrent-change-restore-deferred-private-backup-retained") { _ = try concurrent.restore() }
    try require(pb.changeCount == externalCount && (try concurrent.snapshot()) == externalState && !concurrent.restored && FileManager.default.fileExists(atPath: concurrent.backupPath), "named-path-concurrent-copy-overwritten")
    done("post-observation-concurrent-copy-refuses-restore-preserves-new-state-backup")
    try require(tests == 10, "named-path-control-count-mismatch")
    emit(["qualificationComplete": true, "ok": true, "tests": tests, "namedOnly": true, "generalAccessed": false, "productionGeneralQualified": false, "boundary": "Only new path mode on unique named board, actual General integration and real writer output remain separately pending"])
}
do { try d23NamedQualification(); exit(0) }
catch { emit(["ok": false, "namedOnly": true, "generalAccessed": false, "errorCode": code(error)]); exit(2) }
