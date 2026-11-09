// The complete, pinned LibreOffice bundle is a read-only rendering dependency.
// It only sees an immutable OOXML copy and a fresh private user profile. Its
// output is a preview, never a replacement for the original OOXML package.
static void officeVerifyRenderTree(const Root &runtime, int directory, const std::string &prefix,
                                  NSDictionary *files, NSDictionary *links, std::set<std::string> &seen,
                                  uint64_t &bytes, size_t &directories, size_t depth = 0) {
  require(depth <= 48 && ++directories <= 32768, "TOO_LARGE", "Office renderer directory budget exceeded");
  auto before = info(directory); require(S_ISDIR(before.st_mode) && !(before.st_mode & 0022), "UNTRUSTED", "Office renderer directory permissions changed");
  FD duplicate(dup(directory)); checked(duplicate.value, "inspect Office renderer directory");
  DIR *stream = fdopendir(duplicate.value); require(stream, "IO", "Cannot list Office renderer resources"); duplicate.value = -1;
  try {
    while (auto item = readdir(stream)) {
      std::string name(item->d_name); if (name == "." || name == "..") continue;
      std::string path = prefix.empty() ? name : prefix + '/' + name;
      struct stat stat; checked(fstatat(directory, name.c_str(), &stat, AT_SYMLINK_NOFOLLOW), "stat Office renderer resource");
      if (S_ISDIR(stat.st_mode)) {
        FD child(openat(directory, name.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)); checked(child.value, "open Office renderer directory");
        require(sameIdentity(stat, info(child.value)), "CHANGED", "Office renderer directory was replaced");
        officeVerifyRenderTree(runtime, child.value, path, files, links, seen, bytes, directories, depth + 1);
      } else {
        require(seen.size() < 32769 && seen.insert(path).second, "UNTRUSTED", "Office renderer inventory changed");
        NSDictionary *file = files[ns(path)]; NSString *link = links[ns(path)];
        require((file != nil) != (link != nil), "UNTRUSTED", "Unregistered Office renderer resource");
        if (link) {
          require(S_ISLNK(stat.st_mode), "CHANGED", "Office renderer link was replaced");
          char target[1025]; ssize_t length = readlinkat(directory, name.c_str(), target, sizeof(target)); checked((int)length, "read Office renderer link");
          require(length < (ssize_t)sizeof(target) && std::string(target, length) == str(link), "CHANGED", "Office renderer link target changed");
          Opened resolved = openPath(runtime, path);
          require(resolved.relative.rfind("LibreOffice.app/", 0) == 0, "OUTSIDE_ROOT", "Office renderer link escapes its application");
        } else {
          regular(stat, 256ull * 1024 * 1024);
          require(!(stat.st_mode & 0022) && matches(stat, file[@"identity"]), "UNTRUSTED", "Office renderer file identity or permissions changed");
          bytes += stat.st_size; require(bytes <= 1024ull * 1024 * 1024, "TOO_LARGE", "Office renderer exceeds 1 GiB");
          FD asset(openat(directory, name.c_str(), O_RDONLY | O_NOFOLLOW | O_CLOEXEC)); checked(asset.value, "open Office renderer file");
          require(sameStamp(stat, info(asset.value)) && [hashFile(asset.value, 256ull * 1024 * 1024) isEqual:file[@"hash"]], "CHANGED", "Office renderer file checksum changed");
        }
        struct stat after; checked(fstatat(directory, name.c_str(), &after, AT_SYMLINK_NOFOLLOW), "recheck Office renderer resource");
        require(sameStamp(stat, after), "CHANGED", "Office renderer resource changed during verification");
      }
    }
  } catch (...) { closedir(stream); throw; }
  closedir(stream); require(sameStamp(before, info(directory)), "CHANGED", "Office renderer directory changed during verification");
}
static std::vector<pid_t> officeRenderChildren() {
  pid_t ids[65]; int count = proc_listpgrppids(getpgrp(), ids, sizeof(ids));
  // libproc's convenience wrapper returns a PID count, not bytes.
  require(count > 0 && count < 65, "TOO_LARGE", "Office renderer process count exceeded or cannot be inspected");
  std::vector<pid_t> children;
  for (int i = 0; i < count; ++i) if (ids[i] > 0 && ids[i] != getpid()) children.push_back(ids[i]);
  return children;
}
static void officeStopRenderer(pid_t leader) {
  // Cleanup must not throw while handling a process-count/inspection failure.
  pid_t ids[4096]; int count = proc_listpgrppids(getpgrp(), ids, sizeof(ids));
  kill(leader, SIGKILL);
  for (int i = 0; i < std::min(count, 4096); ++i) if (ids[i] > 0 && ids[i] != getpid()) kill(ids[i], SIGKILL);
}
static void officeInspectRenderPipes(int directory) {
  FD copy(openat(directory, ".", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)); checked(copy.value, "inspect private Office pipes");
  DIR *stream = fdopendir(copy.value); require(stream, "IO", "Cannot inspect private Office pipes"); copy.value = -1; size_t count = 0;
  try {
    while (auto item = readdir(stream)) {
      std::string name(item->d_name); if (name == "." || name == "..") continue;
      struct stat stat; if (fstatat(directory, name.c_str(), &stat, AT_SYMLINK_NOFOLLOW) < 0) { if (errno == ENOENT) continue; checked(-1, "inspect Office pipe"); }
      require(++count <= 4 && name.rfind("OSL_PIPE_", 0) == 0 && S_ISSOCK(stat.st_mode) && stat.st_uid == geteuid() && stat.st_nlink == 1, "UNTRUSTED", "Unexpected object in private Office pipe directory");
    }
  } catch (...) { closedir(stream); throw; }
  closedir(stream);
}
static NSDictionary *officeRenderOperation(NSDictionary *request) {
  constexpr uint64_t limit = 40ull * 1024 * 1024;
  Root job(request[@"job"]), runtime(request[@"runtime"]);
  require(getpgrp() == getpid(), "UNTRUSTED", "Office renderer requires its own process group");
  require(job.privateObjects && job.initial.st_uid == geteuid() && (job.initial.st_mode & 0777) == 0700, "UNTRUSTED", "Office rendering workspace must be private");
  pid_t owner; FD marker = engineJobMarker(job.fd.value, job.initial, owner, true);
  require(owner == getppid(), "UNTRUSTED", "Office rendering workspace has another owner"); checked(flock(marker.value, LOCK_EX | LOCK_NB), "lock Office rendering workspace");
  std::string format = str(request[@"format"]); require(format == "docx" || format == "pptx", "UNSUPPORTED", "Only DOCX and PPTX use this renderer");
  require([request[@"base64"] isKindOfClass:NSString.class] && [request[@"base64"] length] <= ((limit + 2) / 3) * 4, "TOO_LARGE", "Office rendering input exceeds 40 MiB");
  NSData *bytes = [[NSData alloc] initWithBase64EncodedString:request[@"base64"] options:0];
  require(bytes.length >= 4 && bytes.length <= limit && memcmp(bytes.bytes, "PK\003\004", 4) == 0 && [hashBytes(bytes) isEqual:request[@"hash"]], "INVALID_INPUT", "Office rendering input checksum or package header failed");
  NSArray *fileList = request[@"files"], *linkList = request[@"links"];
  require([fileList isKindOfClass:NSArray.class] && [linkList isKindOfClass:NSArray.class] && fileList.count + linkList.count >= 10000 && fileList.count + linkList.count <= 32769, "UNTRUSTED", "Incomplete Office renderer inventory");
  NSMutableDictionary *files = [NSMutableDictionary dictionary], *links = [NSMutableDictionary dictionary];
  for (NSDictionary *file in fileList) {
    require([file isKindOfClass:NSDictionary.class], "INVALID_INPUT", "Invalid Office renderer file");
    std::string path = str(file[@"path"]); auto components = parts(path);
    require(!components.empty() && components.size() <= 48 && (path == "resources.json" || path.rfind("LibreOffice.app/", 0) == 0) && !files[ns(path)] && [file[@"hash"] isKindOfClass:NSString.class] && [file[@"hash"] length] == 64, "UNTRUSTED", "Invalid Office renderer file path");
    files[ns(path)] = file;
  }
  for (NSDictionary *link in linkList) {
    require([link isKindOfClass:NSDictionary.class], "INVALID_INPUT", "Invalid Office renderer link");
    std::string path = str(link[@"path"]), target = str(link[@"target"]); auto components = parts(path);
    require(!components.empty() && components.size() <= 48 && path.rfind("LibreOffice.app/", 0) == 0 && !target.empty() && target.front() != '/' && target.size() <= 1024 && !files[ns(path)] && !links[ns(path)], "UNTRUSTED", "Invalid Office renderer link path");
    links[ns(path)] = ns(target);
  }
  require(files[@"resources.json"] && files[@"LibreOffice.app/Contents/MacOS/soffice"] && files[@"LibreOffice.app/Contents/Resources/registry/main.xcd"], "UNTRUSTED", "Required Office renderer resources are missing");
  testPoint(@"office-render-resources", request);
  std::set<std::string> seen; uint64_t resourceBytes = 0; size_t directories = 0;
  officeVerifyRenderTree(runtime, runtime.fd.value, "", files, links, seen, resourceBytes, directories);
  require(seen.size() == files.count + links.count, "CHANGED", "Office renderer resources are missing");
  FD input = texDirectory(job.fd.value, "input"), output = texDirectory(job.fd.value, "out"), home = texDirectory(job.fd.value, "home"), temporary = texDirectory(job.fd.value, "tmp"), ipc = texDirectory(job.fd.value, "ipc"), profileDirectory = texDirectory(home.value, "profile"), profileUser = texDirectory(profileDirectory.value, "user");
  std::string sourceName = "source." + format;
  FD source(openat(input.value, sourceName.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0400)); checked(source.value, "create Office rendering snapshot"); writeAll(source.value, bytes); source = FD();
  // This fresh profile is never the user's LibreOffice profile. Disable all
  // macro execution before the document is loaded; Seatbelt blocks external IO.
  NSString *settings = @"<?xml version=\"1.0\" encoding=\"UTF-8\"?><oor:items xmlns:oor=\"http://openoffice.org/2001/registry\"><item oor:path=\"/org.openoffice.Office.Common/Security/Scripting\"><prop oor:name=\"DisableMacrosExecution\" oor:op=\"fuse\"><value>true</value></prop><prop oor:name=\"MacroSecurityLevel\" oor:op=\"fuse\"><value>3</value></prop><prop oor:name=\"BlockUntrustedRefererLinks\" oor:op=\"fuse\"><value>true</value></prop></item></oor:items>";
  FD config(openat(profileUser.value, "registrymodifications.xcu", O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600)); checked(config.value, "create Office private configuration"); writeAll(config.value, [settings dataUsingEncoding:NSUTF8StringEncoding]); config = FD();
  runtime.verify(); job.verify(); testPoint(@"office-render-snapshot", request);
  std::string executable = runtime.path + "/LibreOffice.app/Contents/MacOS/soffice";
#ifdef WILLYOU_FILE_BROKER_TEST
  if (request[@"testRenderer"]) {
    NSDictionary *canary = request[@"testRenderer"];
    executable = str(canary[@"path"]); texVerifyEngine(executable, canary[@"identity"], canary[@"hash"]);
  }
#endif
  auto literal = [](const std::string &value) { return "(literal " + texQuote(value) + ')'; };
  auto subpath = [](const std::string &value) { return "(subpath " + texQuote(value) + ')'; };
  std::string profile = "(version 1)(deny default)(allow process-exec " + literal(executable) + ")(allow process-info* (target self))(allow sysctl-read)(allow file-read* ";
  for (const char *path : {"/usr/lib", "/System/Library", "/System/Volumes/Preboot", "/private/var/db/dyld", "/usr/share/zoneinfo", "/Library/Fonts"}) profile += subpath(path);
  for (const char *path : {"/", "/dev/null", "/dev/random", "/dev/urandom"}) profile += literal(path);
  profile += literal(executable) + subpath(runtime.path) + subpath(job.path) + ")(allow file-write* " + subpath(job.path + "/out") + subpath(job.path + "/home") + subpath(job.path + "/tmp") + subpath(job.path + "/ipc") + ")(allow file-read-metadata ";
  for (std::string parent : {runtime.path, job.path}) while (parent.size() > 1) { parent = gitParent(parent); profile += literal(parent); }
  profile += ')';
  // macOS URL resolution opens ancestor directories. These exact directory
  // names permit traversal/listing, not the contents of sibling files.
  profile += "(allow file-read-data (require-all (vnode-type DIRECTORY) (require-any ";
  for (std::string parent : {runtime.path, job.path}) while (parent.size() > 1) { parent = gitParent(parent); profile += literal(parent); }
  profile += ")))";
  // Only local UNIX sockets beneath this fresh 0700 directory; TCP/UDP and
  // other local sockets remain denied. A relative bootstrap path also avoids
  // Darwin's 104-byte sockaddr_un pathname limit for long user-data paths.
  profile += "(allow network* " + subpath(job.path + "/ipc") + ')';
  // The vendor macOS build uses its AppKit VCL plugin even in headless mode.
  profile += "(allow mach-lookup (global-name \"com.apple.coreservices.launchservicesd\") (global-name \"com.apple.windowserver.active\"))";
  std::string userProfile = str([[NSURL fileURLWithPath:ns(job.path + "/home/profile") isDirectory:YES] absoluteString]);
  // Source slide indexes also include hidden slides. Notes remain separate
  // OOXML metadata, so each rendered PDF page maps to exactly one slide.
  require(!request[@"tableLayout"] || CFGetTypeID((__bridge CFTypeRef)request[@"tableLayout"]) == CFBooleanGetTypeID(), "INVALID_INPUT", "Invalid table layout flag");
  bool tableLayout = [request[@"tableLayout"] boolValue];
  require(!tableLayout || format == "pptx", "INVALID_INPUT", "Table layout requires PPTX");
  std::string filter = tableLayout ? "svg:impress_svg_Export" : format == "docx" ? "pdf:writer_pdf_Export" : R"(pdf:impress_pdf_Export:{"ExportHiddenSlides":{"type":"boolean","value":"true"},"ExportNotesPages":{"type":"boolean","value":"false"}})";
  // --norestore controls LibreOffice, while Cocoa has its own state persistence.
  // IgnoreState skips old state but still permits new state to be written.
  // A disposable renderer needs neither: disable persistence in this process's
  // NSArgumentDomain without changing host preferences or sandbox permissions.
  // The pinned 26.2.4.2 parser consumes two operands for each --protector pair.
  std::vector<std::string> values = {"/usr/bin/sandbox-exec", "-p", profile, executable, "-env:UserInstallation=" + userProfile, "-env:OSL_SOCKET_PATH=ipc", "--headless", "--invisible", "--norestore", "--protector", "-ApplePersistenceIgnoreState", "YES", "--protector", "-ApplePersistence", "NO", "--nodefault", "--nolockcheck", "--nologo", "--nofirststartwizard", "--convert-to", filter, "--outdir", job.path + "/out", job.path + "/input/" + sourceName};
  std::vector<char *> argv; for (auto &value : values) argv.push_back(value.data()); argv.push_back(nullptr);
  std::vector<std::string> environments = {"PATH=/usr/bin:/bin", "HOME=" + job.path + "/home", "TMPDIR=" + job.path + "/tmp", "XDG_CACHE_HOME=" + job.path + "/home/cache", "XDG_CONFIG_HOME=" + job.path + "/home", "LANG=en_US.UTF-8", "PYTHONDONTWRITEBYTECODE=1"};
  std::vector<char *> env; for (auto &value : environments) env.push_back(value.data()); env.push_back(nullptr);
  int out[2], err[2]; checked(pipe(out), "Office rendering stdout"); FD outRead(out[0]), outWrite(out[1]); checked(pipe(err), "Office rendering stderr"); FD errRead(err[0]), errWrite(err[1]);
  for (int fd : {out[0], out[1], err[0], err[1]}) checked(fcntl(fd, F_SETFD, FD_CLOEXEC), "protect Office rendering pipe");
  FD nullInput(open("/dev/null", O_RDONLY | O_CLOEXEC)); checked(nullInput.value, "open Office rendering null input");
  struct rlimit cpu = {18, 20}, fileSize = {limit, limit}, descriptors = {512, 512};
  checked(setrlimit(RLIMIT_CPU, &cpu), "set Office rendering CPU budget"); checked(setrlimit(RLIMIT_FSIZE, &fileSize), "set Office rendering file budget"); checked(setrlimit(RLIMIT_NOFILE, &descriptors), "set Office rendering descriptor budget");
  posix_spawn_file_actions_t actions; posix_spawn_file_actions_init(&actions);
  posix_spawn_file_actions_adddup2(&actions, nullInput.value, STDIN_FILENO); posix_spawn_file_actions_adddup2(&actions, out[1], STDOUT_FILENO); posix_spawn_file_actions_adddup2(&actions, err[1], STDERR_FILENO); posix_spawn_file_actions_addfchdir_np(&actions, job.fd.value);
  const auto started = std::chrono::steady_clock::now(); int wall = 20000; uint64_t rssLimit = 1024ull * 1024 * 1024;
#ifdef WILLYOU_FILE_BROKER_TEST
  if ([request[@"testWallMs"] intValue] > 0) wall = std::min(wall, [request[@"testWallMs"] intValue]);
  if ([request[@"testRssBytes"] unsignedLongLongValue] > 0) rssLimit = std::min(rssLimit, (uint64_t)[request[@"testRssBytes"] unsignedLongLongValue]);
#endif
  const auto deadline = started + std::chrono::milliseconds(wall);
  pid_t pid; int spawned = posix_spawn(&pid, "/usr/bin/sandbox-exec", &actions, nullptr, argv.data(), env.data()); posix_spawn_file_actions_destroy(&actions);
  if (spawned) { errno = spawned; checked(-1, "start Office renderer"); }
  outWrite = FD(); errWrite = FD(); for (int fd : {outRead.value, errRead.value}) checked(fcntl(fd, F_SETFL, O_NONBLOCK), "nonblocking Office rendering pipe");
  uint64_t peak = 0; size_t logBytes = 0; std::string diagnostic; int status = 0; auto nextSizeCheck = started;
  try {
    testPoint(@"office-render-running", request);
    bool running = true;
    while (running || outRead.value >= 0 || errRead.value >= 0) {
      auto now = std::chrono::steady_clock::now(); require(now < deadline, "TIMEOUT", "Office rendering exceeded 20 seconds"); require(getppid() == owner, "CANCELLED", "Office application exited during rendering");
      uint64_t resident = 0;
      for (pid_t child : officeRenderChildren()) { struct proc_taskinfo metrics; if (proc_pidinfo(child, PROC_PIDTASKINFO, 0, &metrics, sizeof(metrics)) == sizeof(metrics)) resident += metrics.pti_resident_size; }
      peak = std::max(peak, resident); require(peak <= rssLimit, "TOO_LARGE", "Office renderer process tree exceeded 1 GiB RSS");
      if (now >= nextSizeCheck) { size_t count = 0; require(texDirectoryBytes(output.value, count) <= limit, "TOO_LARGE", "Office preview exceeds 40 MiB"); count = 0; uint64_t temporaryBytes = texDirectoryBytes(home.value, count); count = 0; temporaryBytes += texDirectoryBytes(temporary.value, count); require(temporaryBytes <= 128ull * 1024 * 1024, "TOO_LARGE", "Office rendering temporary files exceed 128 MiB"); officeInspectRenderPipes(ipc.value); nextSizeCheck = now + std::chrono::milliseconds(100); }
      pollfd polls[2] = {{outRead.value, POLLIN, 0}, {errRead.value, POLLIN, 0}}; poll(polls, 2, 20);
      for (int index = 0; index < 2; index++) if (polls[index].revents & (POLLIN | POLLHUP | POLLERR)) {
        char data[8192]; ssize_t count;
        do { count = read(polls[index].fd, data, sizeof(data)); if (count > 0) { logBytes += count; require(logBytes <= 1024 * 1024, "TOO_LARGE", "Office rendering diagnostics exceed 1 MiB"); diagnostic.append(data, count); if (diagnostic.size() > 65536) diagnostic.erase(0, diagnostic.size() - 65536); } } while (count > 0);
        if (count == 0) { if (index == 0) outRead = FD(); else errRead = FD(); }
      }
      if (running) { pid_t value = waitpid(pid, &status, WNOHANG); if (value == pid) running = false; else if (value < 0 && errno != EINTR) checked(-1, "wait for Office renderer"); }
    }
  } catch (...) { officeStopRenderer(pid); while (waitpid(pid, &status, 0) < 0 && errno == EINTR) {} throw; }
  // A rendering subprocess may not outlive the owning job/profile.
  auto remaining = officeRenderChildren(); for (pid_t child : remaining) kill(child, SIGKILL);
  require(remaining.empty(), "IO", "Office renderer left an unexpected child process"); job.verify(); runtime.verify();
  NSString *log = [[NSString alloc] initWithBytes:diagnostic.data() length:diagnostic.size() encoding:NSUTF8StringEncoding] ?: @"Office rendering diagnostic contains invalid UTF-8";
  log = [[log stringByReplacingOccurrencesOfString:ns(job.path) withString:@"<文档快照>"] stringByReplacingOccurrencesOfString:ns(runtime.path) withString:@"<固定引擎>"];
  if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) return @{ @"state": @"failed", @"message": @"Office 文档排版失败；原件与草稿保留", @"diagnostic": [NSString stringWithFormat:@"exit=%d signal=%d\n%@", WIFEXITED(status) ? WEXITSTATUS(status) : -1, WIFSIGNALED(status) ? WTERMSIG(status) : 0, log] };
  FD pdf(openat(output.value, tableLayout ? "source.svg" : "source.pdf", O_RDONLY | O_NOFOLLOW | O_CLOEXEC));
  if (pdf.value < 0 && errno == ENOENT) return @{ @"state": @"failed", @"message": @"Office 未生成文档预览；文件可能损坏、加密或格式不受支持", @"diagnostic": log };
  checked(pdf.value, "open rendered Office PDF"); NSData *rendered = readBytes(pdf.value, 0, limit, limit);
  if (tableLayout) {
    require(rendered.length >= 5 && memcmp(rendered.bytes, "<?xml", 5) == 0, "INVALID_INPUT", "Table renderer did not produce XML");
    // Zero PDF pages: this projection is strict-parsed into polygons by the
    // bounded Worker. It is never displayed or evaluated as SVG in the UI.
    return @{ @"state": @"ready", @"base64": [rendered base64EncodedStringWithOptions:0], @"hash": hashBytes(rendered), @"bytes": @(rendered.length), @"pages": @0, @"peakRssBytes": @(peak), @"elapsedMs": @(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count()), @"diagnostic": log };
  }
  require(rendered.length >= 5 && memcmp(rendered.bytes, "%PDF-", 5) == 0, "INVALID_INPUT", "Office renderer did not produce a PDF");
  CGDataProviderRef provider = CGDataProviderCreateWithCFData((__bridge CFDataRef)rendered); CGPDFDocumentRef document = CGPDFDocumentCreateWithProvider(provider); CGDataProviderRelease(provider);
  require(document, "INVALID_INPUT", "Office preview cannot be reopened"); size_t pages = CGPDFDocumentGetNumberOfPages(document); CGPDFDocumentRelease(document); require(pages > 0 && pages <= 2000, "TOO_LARGE", "Office preview is empty or exceeds 2000 pages");
  return @{ @"state": @"ready", @"base64": [rendered base64EncodedStringWithOptions:0], @"hash": hashBytes(rendered), @"bytes": @(rendered.length), @"pages": @(pages), @"peakRssBytes": @(peak), @"elapsedMs": @(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count()), @"diagnostic": log };
}
