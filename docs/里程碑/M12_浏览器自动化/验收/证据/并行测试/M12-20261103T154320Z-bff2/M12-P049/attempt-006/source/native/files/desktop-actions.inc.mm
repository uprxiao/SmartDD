// Included after the descriptor/transaction helpers. Only the main process
// issues these requests; selected applications and save destinations are never
// interpreted as command strings.
static NSString *absoluteItemPath(const Root &root, const Opened &item) {
  return ns(root.path + (item.relative.empty() ? "" : (root.path == "/" ? "" : "/") + item.relative));
}
static NSString *applicationIcon(NSWorkspace *workspace, NSString *path) {
  @try {
    NSImage *image = [workspace iconForFile:path];
    NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:nil pixelsWide:32 pixelsHigh:32 bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
    [NSGraphicsContext saveGraphicsState];
    NSGraphicsContext.currentContext = [NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap];
    [image drawInRect:NSMakeRect(0, 0, 32, 32) fromRect:NSZeroRect operation:NSCompositingOperationCopy fraction:1];
    [NSGraphicsContext.currentContext flushGraphics];
    [NSGraphicsContext restoreGraphicsState];
    NSData *data = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    if (data.length <= 16384) return [data base64EncodedStringWithOptions:0];
  } @catch (NSException *exception) { /* An absent icon does not invent an app. */ }
  return nil;
}
static NSDictionary *desktopOperation(NSDictionary *request) {
  Root root(request[@"root"]); std::string relative = str(request[@"relativePath"]), operation = str(request[@"operation"]);
  bool directory = [request[@"directory"] boolValue];
  checkProtected(root, relative, request[@"protected"] ?: @[]);
  Opened item = openPath(root, relative, directory);
  checkProtected(root, item.relative, request[@"protected"] ?: @[]);
  require(directory ? S_ISDIR(item.initial.st_mode) : S_ISREG(item.initial.st_mode), "NOT_REGULAR", "The selected item is not a regular file or directory");
  if (request[@"expectedIdentity"]) require(matches(item.initial, request[@"expectedIdentity"]), "CHANGED", "The selected file was replaced; refresh before opening it");
  verifyPath(root, item, directory);
  if (request[@"expectedRevision"]) require(!directory && [revision(item.fd.value, 40ULL * 1024 * 1024) isEqual:request[@"expectedRevision"]], "CHANGED", "The attachment copy changed before desktop dispatch");
  NSURL *url = [NSURL fileURLWithPath:absoluteItemPath(root, item) isDirectory:directory];
  NSURL *reference = url.fileReferenceURL;
  require(reference != nil, "MISSING", "The selected file is unavailable");
  NSWorkspace *workspace = NSWorkspace.sharedWorkspace;
  if (operation == "applications") {
    NSURL *systemDefault = [workspace URLForApplicationToOpenURL:url];
    NSMutableArray<NSURL *> *urls = [[workspace URLsForApplicationsToOpenURL:url] mutableCopy];
    if (systemDefault && ![urls containsObject:systemDefault]) [urls insertObject:systemDefault atIndex:0];
    NSMutableArray *apps = [NSMutableArray array]; NSMutableSet *seen = [NSMutableSet set];
    for (NSURL *appURL in urls) {
      if (apps.count >= 80) break;
      NSString *path = appURL.URLByResolvingSymlinksInPath.path;
      if (!path || [seen containsObject:path]) continue;
      [seen addObject:path];
      FD app(open(path.fileSystemRepresentation, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC));
      if (app.value < 0) continue;
      NSBundle *bundle = [NSBundle bundleWithURL:[NSURL fileURLWithPath:path]];
      NSString *name = [bundle objectForInfoDictionaryKey:@"CFBundleDisplayName"] ?: [bundle objectForInfoDictionaryKey:@"CFBundleName"] ?: path.lastPathComponent.stringByDeletingPathExtension;
      NSMutableDictionary *entry = [@{ @"path": path, @"identity": identity(info(app.value)), @"name": name, @"bundleId": bundle.bundleIdentifier ?: @"", @"systemDefault": @([path isEqual:systemDefault.URLByResolvingSymlinksInPath.path]) } mutableCopy];
      NSString *icon = applicationIcon(workspace, path); if (icon) entry[@"icon"] = icon;
      [apps addObject:entry];
    }
    verifyPath(root, item, directory);
    return @{ @"identity": identity(info(item.fd.value)), @"relativePath": ns(item.relative), @"applications": apps };
  }
  if (operation == "reveal") {
    verifyPath(root, item, directory);
    [workspace activateFileViewerSelectingURLs:@[reference]];
    return @{ @"state": @"dispatched" };
  }
  NSDictionary *application = request[@"application"];
  std::string appPath = str(application[@"path"]);
  require(!appPath.empty() && appPath.front() == '/' && appPath.rfind("//", 0) != 0, "UNTRUSTED", "Expected a discovered local application");
  FD app(open(appPath.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)); checked(app.value, "open selected application");
  require(matches(info(app.value), application[@"identity"]), "CHANGED", "The selected application was replaced; reload the application list");
  NSURL *appURL = [NSURL fileURLWithPath:ns(appPath) isDirectory:YES];
  require([NSBundle bundleWithURL:appURL] != nil, "UNSUPPORTED", "The selected application is unavailable");
  verifyPath(root, item, directory);
  NSWorkspaceOpenConfiguration *configuration = NSWorkspaceOpenConfiguration.configuration;
  if (request[@"expectedRevision"]) require([revision(item.fd.value, 40ULL * 1024 * 1024) isEqual:request[@"expectedRevision"]], "CHANGED", "The attachment copy changed before opening");
  configuration.promptsUserIfNeeded = NO; configuration.allowsRunningApplicationSubstitution = NO;
  __block BOOL done = NO; __block NSError *failure = nil;
  [workspace openURLs:@[reference] withApplicationAtURL:appURL configuration:configuration completionHandler:^(NSRunningApplication *running, NSError *error) { failure = error; done = YES; }];
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:12];
  while (!done && deadline.timeIntervalSinceNow > 0) [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.025]];
  require(done, "TIMEOUT", "The system did not acknowledge opening the file; do not automatically retry");
  if (failure) fail("IO", str(failure.localizedDescription));
  return @{ @"state": @"opened" };
}

static NSDictionary *inspectCopyTarget(NSDictionary *request) {
  std::string full = str(request[@"path"]);
  require(!full.empty() && full.front() == '/' && full.rfind("//", 0) != 0, "UNTRUSTED", "Expected a native save-dialog path");
  auto at = full.rfind('/'); std::string parent = at == 0 ? "/" : full.substr(0, at), leaf = full.substr(at + 1);
  require(parts(leaf).size() == 1, "INVALID_INPUT", "Invalid copy filename");
  NSMutableDictionary *descriptor = [inspectRoot(@{ @"path": ns(parent), @"operation": @"inspect-root" }) mutableCopy];
  descriptor[@"sourcePath"] = ns(parent); Root root(descriptor);
  checkProtected(root, "", request[@"protected"] ?: @[]);
  NSMutableDictionary *result = [@{ @"root": descriptor, @"relativePath": ns(leaf), @"revision": NSNull.null } mutableCopy];
  try {
    Opened file = openPath(root, leaf, false, false);
    checkProtected(root, leaf, request[@"protected"] ?: @[]);
    result[@"revision"] = revision(file.fd.value, 256ull * 1024 * 1024); verifyPath(root, file);
  } catch (const Failure &e) { if (e.code != "MISSING") throw; }
  root.verify(); return result;
}

static NSDictionary *copyOperation(NSDictionary *request) {
  constexpr uint64_t limit = 256ull * 1024 * 1024;
  Root source(request[@"root"]); std::string relative = str(request[@"relativePath"]);
  checkProtected(source, relative, request[@"sourceProtected"] ?: request[@"protected"] ?: @[]); Opened input = openPath(source, relative);
  checkProtected(source, input.relative, request[@"sourceProtected"] ?: request[@"protected"] ?: @[]);
  NSDictionary *sourceRevision = revision(input.fd.value, limit);
  require([sourceRevision isEqual:request[@"expectedRevision"]], "CHANGED", "The source changed while the save dialog was open");
  NSData *bytes = request[@"draftBase64"] ? [[NSData alloc] initWithBase64EncodedString:request[@"draftBase64"] options:0] : readBytes(input.fd.value, 0, [sourceRevision[@"size"] unsignedLongLongValue], limit);
  require(bytes != nil && bytes.length <= limit, "INVALID_INPUT", "Invalid copy bytes");
  verifyPath(source, input); require([revision(input.fd.value, limit) isEqual:sourceRevision], "CHANGED", "The source changed during the copy");
  NSDictionary *destination = request[@"destination"]; Root targetRoot(destination[@"root"]);
  std::string leaf = str(destination[@"relativePath"]); require(parts(leaf).size() == 1, "INVALID_INPUT", "Copy target must be a filename");
  checkProtected(targetRoot, "", request[@"protected"] ?: @[]);
  // A copy never resolves a symlink at the destination and never writes the
  // source inode, even when the user selects a hard link or another alias.
  NSDictionary *expected = destination[@"revision"] == NSNull.null ? nil : destination[@"revision"];
  if (expected) {
    Opened target = openPath(targetRoot, leaf, false, false);
    require(!sameIdentity(input.initial, target.initial), "CONFLICT", "Choose another filename; Save a Copy cannot overwrite its source");
    require([revision(target.fd.value, limit) isEqual:expected], "CONFLICT", "The destination changed after selection");
    NSMutableDictionary *save = [request mutableCopy];
    save[@"operation"] = @"save"; save[@"root"] = destination[@"root"]; save[@"relativePath"] = ns(leaf);
    save[@"baseHash"] = expected[@"hash"]; save[@"base64"] = [bytes base64EncodedStringWithOptions:0]; save[@"draftHash"] = hashBytes(bytes);
    save[@"copySourceRoot"] = request[@"root"]; save[@"copySourcePath"] = ns(input.relative);
    save[@"expectedDestinationRevision"] = expected;
    return saveOperation(save);
  }
  Root recovery(request[@"recoveryRoot"]); recovery.privateObjects = true;
  std::string opId = str(request[@"opId"]), project = str(request[@"projectKey"]);
  require(internalId(opId) && internalId(project), "INVALID_INPUT", "Invalid copy transaction identifier");
  checkSpace(recovery.fd.value, bytes.length + 65536); checkSpace(targetRoot.fd.value, bytes.length + 65536);
  FD projectDir = privateDirectory(recovery.fd.value, project, false), recordDir = privateDirectory(projectDir.value, opId, true);
  NSString *draftHash = hashBytes(bytes);
  NSMutableDictionary *record = [@{ @"schemaVersion": @1, @"kind": @"copy", @"opId": ns(opId), @"projectKey": ns(project), @"fingerprint": request[@"fingerprint"], @"root": destination[@"root"], @"relativePath": ns(leaf), @"source": request[@"source"], @"copySourceRoot": request[@"root"], @"copySourcePath": ns(input.relative), @"draftHash": draftHash, @"bufferVersion": @0, @"draftLeaf": @"draft", @"state": @"preparing", @"createdAt": @((long long)(NSDate.date.timeIntervalSince1970 * 1000)), @"targetParentIdentity": identity(targetRoot.initial), @"recordIdentity": identity(info(recordDir.value)), @"bytes": @(bytes.length * 2 + 65536) } mutableCopy];
  bool installed = false;
  NSDictionary *receipt;
  try {
    writeJournal(recordDir.value, record);
    FD draft = newFile(recordDir.value, "draft", bytes); record[@"draftIdentity"] = identity(info(draft.value));
    std::string transaction = ".willyou-recovery-" + str(request[@"installationId"]) + "-" + opId;
    checked(mkdirat(targetRoot.fd.value, transaction.c_str(), 0700), "create copy transaction");
    FD transactionDir(openat(targetRoot.fd.value, transaction.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)); checked(transactionDir.value, "open copy transaction");
    record[@"transactionLeaf"] = ns(transaction); record[@"transactionIdentity"] = identity(info(transactionDir.value));
    record[@"stagingLeaf"] = @"candidate"; checked(fsync(targetRoot.fd.value), "sync copy transaction parent"); writeJournal(recordDir.value, record);
    emit(@{ @"event": @"transaction", @"identity": record[@"transactionIdentity"], @"opId": ns(opId) });
    FD candidate = newFile(transactionDir.value, "candidate", bytes);
    checked(linkat(transactionDir.value, "candidate", transactionDir.value, "materialized", 0), "retain copy inode");
    record[@"materializedLeaf"] = @"materialized"; record[@"candidateIdentity"] = identity(info(candidate.value)); record[@"state"] = @"prepared";
    checked(fsync(transactionDir.value), "sync copy candidate"); writeJournal(recordDir.value, record); testPoint(@"copy-prepared", request);
    source.verify(); verifyPath(source, input); targetRoot.verify(); recovery.verify();
    struct stat transactionNow; checked(fstatat(targetRoot.fd.value, transaction.c_str(), &transactionNow, AT_SYMLINK_NOFOLLOW), "verify copy transaction");
    require(matches(transactionNow, record[@"transactionIdentity"]), "CONFLICT", "Copy transaction moved");
    require([hashFile(candidate.value, limit) isEqual:draftHash], "CONFLICT", "Prepared copy changed");
    // RENAME_EXCL is atomic: a file created after the dialog is never clobbered.
    int moved = renameatx_np(transactionDir.value, "candidate", targetRoot.fd.value, leaf.c_str(), RENAME_EXCL);
    if (moved < 0 && errno == EEXIST) fail("CONFLICT", "A file appeared at the destination; choose again");
    checked(moved, "install copy"); installed = true; testPoint(@"copy-installed", request);
    checked(fsync(targetRoot.fd.value), "sync copied file parent"); checked(fsync(transactionDir.value), "sync copy staging directory");
    Opened result = openPath(targetRoot, leaf, false, false); verifyPath(targetRoot, result);
    require(sameIdentity(info(result.fd.value), info(candidate.value)), "CONFLICT", "The copied file was replaced after installation");
    NSDictionary *saved = revision(result.fd.value, limit); require([saved[@"hash"] isEqual:draftHash], "CONFLICT", "The copy changed after installation");
    receipt = @{ @"opId": ns(opId), @"bufferVersion": @0, @"state": @"saved", @"revision": saved, @"recoveryId": ns(opId) }; record[@"state"] = @"saved";
  } catch (const Failure &e) {
    NSString *state = e.code == "CONFLICT" || e.code == "CHANGED" ? @"conflict" : installed ? @"unknown" : @"failed";
    receipt = @{ @"opId": ns(opId), @"bufferVersion": @0, @"state": state, @"message": ns(e.message), @"recoveryId": ns(opId) }; record[@"state"] = state;
  }
  record[@"receipt"] = receipt; record[@"exchanged"] = @(installed); writeJournal(recordDir.value, record); return receipt;
}

// Release only an acknowledged copy's private aliases and recovery draft.
// The final output and source are never unlinked or written by this operation.
static std::vector<std::pair<std::string, struct stat>> checkedCopyCleanupEntries(int directory, NSDictionary *allowed) {
  int copy = dup(directory); checked(copy, "dup copy cleanup directory"); DIR *stream = fdopendir(copy);
  if (!stream) { close(copy); checked(-1, "open copy cleanup directory"); }
  std::vector<std::pair<std::string, struct stat>> entries;
  try {
    for (;;) {
      errno = 0; dirent *entry = readdir(stream); if (!entry) { checked(errno ? -1 : 0, "read cleanup directory"); break; }
      std::string name(entry->d_name); if (name == "." || name == "..") continue;
      NSDictionary *expected = allowed[ns(name)]; require([expected isKindOfClass:NSDictionary.class], "UNTRUSTED", "An unrecognized copy material was retained");
      struct stat current; checked(fstatat(directory, name.c_str(), &current, AT_SYMLINK_NOFOLLOW), "inspect copy material");
      require(S_ISREG(current.st_mode) && matches(current, expected), "UNTRUSTED", "A copy material identity changed; nothing was released");
      entries.emplace_back(name, current);
    }
  } catch (...) { closedir(stream); throw; }
  closedir(stream); return entries;
}
static void unlinkCopyCleanupEntries(int directory, const std::vector<std::pair<std::string, struct stat>> &entries) {
  for (const auto &entry : entries) {
    struct stat current; checked(fstatat(directory, entry.first.c_str(), &current, AT_SYMLINK_NOFOLLOW), "recheck copy cleanup entry");
    require(sameIdentity(current, entry.second) && S_ISREG(current.st_mode), "CHANGED", "Copy cleanup entry moved");
    checked(unlinkat(directory, entry.first.c_str(), 0), "release copy material");
  }
  checked(fsync(directory), "sync released copy materials");
}
static NSDictionary *finishCopyOperation(NSDictionary *request) {
  Root target(request[@"root"]), recovery(request[@"recoveryRoot"]); recovery.privateObjects = true;
  std::string project = str(request[@"projectKey"]), op = str(request[@"opId"]);
  require(internalId(project) && internalId(op), "INVALID_INPUT", "Invalid copy cleanup identity");
  NSDictionary *fallback = request[@"savedRecord"], *record = nil;
  require([fallback isKindOfClass:NSDictionary.class], "UNTRUSTED", "A verified saved-copy receipt is required");
  try { record = loadJournal(recovery, project, op); require([record isEqual:fallback], "UNTRUSTED", "Saved copy journal changed"); }
  catch (const Failure &e) { if (e.code != "MISSING") throw; record = fallback; }
  require([record[@"kind"] isEqual:@"copy"] && [record[@"state"] isEqual:@"saved"] && [record[@"receipt"][@"state"] isEqual:@"saved"] && [record[@"opId"] isEqual:ns(op)] && [record[@"projectKey"] isEqual:ns(project)] && [record[@"fingerprint"] isEqual:request[@"fingerprint"]], "UNTRUSTED", "Only the original acknowledged saved copy can be released");
  require([record[@"root"] isEqual:request[@"root"]] && [record[@"receipt"][@"opId"] isEqual:ns(op)] && [record[@"receipt"][@"revision"][@"hash"] isEqual:record[@"draftHash"]], "UNTRUSTED", "Saved copy destination or content receipt differs");
  checkProtected(target, "", request[@"protected"] ?: @[]);
  const std::string transaction = str(record[@"transactionLeaf"]);
  require(transaction == ".willyou-recovery-" + str(request[@"installationId"]) + "-" + op, "UNTRUSTED", "Copy transaction does not belong to this operation");
  std::optional<Opened> volume, journalDirectory;
  std::vector<std::pair<std::string, struct stat>> volumeEntries, journalEntries;
  try {
    volume.emplace(openPath(target, transaction, true, false));
    require(matches(info(volume->fd.value), record[@"transactionIdentity"]), "CHANGED", "Copy transaction directory was replaced");
    NSDictionary *candidate = record[@"displacedIdentity"] ?: record[@"candidateIdentity"];
    require(candidate && record[@"candidateIdentity"], "UNTRUSTED", "Saved copy material identities are missing");
    volumeEntries = checkedCopyCleanupEntries(volume->fd.value, @{ @"candidate": candidate, @"materialized": record[@"candidateIdentity"] });
  } catch (const Failure &e) { if (e.code != "MISSING") throw; }
  try {
    journalDirectory.emplace(openPath(recovery, project + '/' + op, true, false));
    require(matches(info(journalDirectory->fd.value), record[@"recordIdentity"]), "CHANGED", "Copy recovery directory was replaced");
    NSMutableDictionary *allowed = [NSMutableDictionary dictionary];
    if (record[@"draftIdentity"]) allowed[@"draft"] = record[@"draftIdentity"];
    try { Opened journal = openPath(recovery, project + '/' + op + "/journal.json", false, false); allowed[@"journal.json"] = identity(info(journal.fd.value)); }
    catch (const Failure &e) { if (e.code != "MISSING") throw; }
    journalEntries = checkedCopyCleanupEntries(journalDirectory->fd.value, allowed);
  } catch (const Failure &e) { if (e.code != "MISSING") throw; }
  // Validate both areas before the first deletion; missing areas are a prior
  // cleanup's progress, not authority to adopt another directory or material.
  target.verify(); recovery.verify(); testPoint(@"copy-cleanup-checked", request);
  if (volume) {
    verifyPath(target, *volume, true); unlinkCopyCleanupEntries(volume->fd.value, volumeEntries); verifyPath(target, *volume, true);
    checked(unlinkat(volume->parent.value, volume->leaf.c_str(), AT_REMOVEDIR), "release copy transaction directory"); checked(fsync(volume->parent.value), "sync released copy transaction");
  }
  testPoint(@"copy-cleanup-target-removed", request);
  if (journalDirectory) {
    verifyPath(recovery, *journalDirectory, true); unlinkCopyCleanupEntries(journalDirectory->fd.value, journalEntries); verifyPath(recovery, *journalDirectory, true);
    checked(unlinkat(journalDirectory->parent.value, journalDirectory->leaf.c_str(), AT_REMOVEDIR), "release saved copy record"); checked(fsync(journalDirectory->parent.value), "sync released saved copy record");
  }
  return @{ @"state": @"cleaned" };
}
