// A fixed, offline compiler receives only a descriptor-validated private copy.
// No shell, project command, PATH lookup, network, or user's font/cache folders.
#include <sys/resource.h>
#include <libproc.h>

static std::string texQuote(const std::string &value) {
  NSData *json = [NSJSONSerialization dataWithJSONObject:@[ns(value)] options:0 error:nil];
  std::string result((const char *)json.bytes, json.length); return result.substr(1, result.size() - 2);
}
static FD texDirectory(int parent, const std::string &name) {
  if (mkdirat(parent, name.c_str(), 0700) < 0 && errno != EEXIST) checked(-1, "create TeX snapshot directory");
  FD fd(openat(parent, name.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)); checked(fd.value, "open TeX snapshot directory");
  auto s = info(fd.value); require(s.st_uid == geteuid() && (s.st_mode & 0777) == 0700, "UNTRUSTED", "TeX directory owner or mode changed"); return fd;
}
static void texWriteSnapshot(int parent, const std::string &path, int source, uint64_t size, NSData *normalized) {
  auto components = parts(path); require(!components.empty() && components.size() <= 64, "INVALID_INPUT", "Invalid TeX snapshot path");
  FD directory(dup(parent)); checked(directory.value, "dup TeX snapshot root");
  for (size_t i = 0; i + 1 < components.size(); i++) directory = texDirectory(directory.value, components[i]);
  FD output(openat(directory.value, components.back().c_str(), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0400)); checked(output.value, "create TeX snapshot file");
  if (normalized) { writeAll(output.value, normalized); return; }
  char bytes[65536];
  for (uint64_t offset = 0; offset < size;) {
    ssize_t count = pread(source, bytes, std::min<uint64_t>(sizeof(bytes), size - offset), offset); if (count < 0 && errno == EINTR) continue; checked((int)count, "read TeX resource"); require(count > 0, "CHANGED", "TeX resource shrank during snapshot");
    writeAll(output.value, [NSData dataWithBytesNoCopy:bytes length:count freeWhenDone:NO]); offset += count;
  }
}
static uint64_t texDirectoryBytes(int directory, size_t &count, size_t depth = 0) {
  require(depth <= 32 && count <= 4096, "TOO_LARGE", "TeX output tree exceeds the directory budget");
  FD duplicate(dup(directory)); checked(duplicate.value, "dup TeX output directory");
  DIR *stream = fdopendir(duplicate.value); require(stream != nullptr, "IO", "Cannot inspect TeX output directory"); duplicate.value = -1;
  uint64_t total = 0;
  try {
    while (auto entry = readdir(stream)) {
      std::string name(entry->d_name); if (name == "." || name == "..") continue;
      require(++count <= 4096, "TOO_LARGE", "TeX generated too many output files");
      struct stat s; if (fstatat(directory, name.c_str(), &s, AT_SYMLINK_NOFOLLOW) < 0) { if (errno == ENOENT) continue; checked(-1, "stat TeX output"); }
      require(!S_ISLNK(s.st_mode), "UNTRUSTED", "Symbolic links are forbidden in TeX output");
      if (S_ISDIR(s.st_mode)) { FD child(openat(directory, name.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)); checked(child.value, "open TeX output directory"); total += texDirectoryBytes(child.value, count, depth + 1); }
      else { require(S_ISREG(s.st_mode) && s.st_size >= 0, "UNTRUSTED", "Unexpected TeX output object"); total += s.st_size; }
      require(total <= 128ull * 1024 * 1024, "TOO_LARGE", "TeX generated resources exceed 128 MiB");
    }
  } catch (...) { closedir(stream); throw; }
  closedir(stream); return total;
}
static void texVerifyEngine(const std::string &path, NSDictionary *expected, NSString *hash) {
  FD file(open(path.c_str(), O_RDONLY | O_NOFOLLOW | O_CLOEXEC)); checked(file.value, "open fixed TeX resource");
  auto s = info(file.value); require((s.st_mode & 0022) == 0 && matches(s, expected), "UNTRUSTED", "Fixed TeX resource identity or permissions changed");
  require([hashFile(file.value, 100ull * 1024 * 1024) isEqual:hash], "CHANGED", "Fixed TeX resource hash changed");
}
static NSDictionary *texCompileOperation(NSDictionary *request) {
  constexpr uint64_t sourceLimit = 10ull * 1024 * 1024, snapshotLimit = 128ull * 1024 * 1024, outputLimit = 40ull * 1024 * 1024;
  Root source(request[@"root"]), job(request[@"job"]);
  require(job.initial.st_uid == geteuid() && (job.initial.st_mode & 0777) == 0700, "UNTRUSTED", "Compiler workspace must be private");
  pid_t owner; FD marker = engineJobMarker(job.fd.value, job.initial, owner);
  require(owner == getppid(), "UNTRUSTED", "TeX workspace belongs to another application process");
  checked(flock(marker.value, LOCK_EX | LOCK_NB), "lock active TeX workspace");
  std::string entry = str(request[@"entry"]), engine = str(request[@"engine"]), bundle = str(request[@"bundle"]);
  require(engine.size() > 9 && engine.substr(engine.size() - 9) == "/tectonic" && bundle == gitParent(engine) + "/willyou-tex-v33.zip", "UNTRUSTED", "Unexpected TeX resource layout");
  texVerifyEngine(engine, request[@"engineIdentity"], request[@"engineHash"]); texVerifyEngine(bundle, request[@"bundleIdentity"], request[@"bundleHash"]);
  NSArray *resources = request[@"files"]; require([resources isKindOfClass:NSArray.class] && resources.count > 0 && resources.count <= 1024, "TOO_LARGE", "Invalid TeX resource manifest");
  FD input = texDirectory(job.fd.value, "input"), output = texDirectory(job.fd.value, "out"), home = texDirectory(job.fd.value, "home"), cache = texDirectory(job.fd.value, "cache"), temporary = texDirectory(job.fd.value, "tmp");
  uint64_t bytes = 0, copiedBytes = 0; bool hasEntry = false; std::set<std::string> paths;
  for (NSDictionary *resource in resources) {
    std::string path = str(resource[@"path"]); require(paths.insert(path).second, "INVALID_INPUT", "Duplicate TeX resource");
    checkProtected(source, path, request[@"protected"] ?: @[]); Opened file = openPath(source, path, false, false);
    auto before = info(file.fd.value); regular(before, snapshotLimit); require(matchesRevisionMetadata(before, resource[@"revision"]), "CHANGED", "TeX resource revision changed");
    if (path == entry) { hasEntry = true; regular(before, sourceLimit); require([resource[@"revision"][@"hash"] isEqual:request[@"baseHash"]], "CHANGED", "TeX source revision changed"); }
    bytes += before.st_size; require(bytes <= snapshotLimit, "TOO_LARGE", "TeX snapshot exceeds 128 MiB");
    require([hashFile(file.fd.value, snapshotLimit) isEqual:resource[@"revision"][@"hash"]], "CHANGED", "TeX resource hash changed");
    NSData *normalized = nil;
    if (resource[@"normalized"]) {
      NSDictionary *replacement = resource[@"normalized"];
      require([replacement isKindOfClass:NSDictionary.class] && [[ns(path) lowercaseString] hasSuffix:@".pdf"] && [replacement[@"base64"] isKindOfClass:NSString.class], "INVALID_INPUT", "Invalid private PDF compatibility data");
      require([replacement[@"base64"] length] <= ((outputLimit + 2) / 3) * 4, "TOO_LARGE", "Private PDF compatibility data exceeds 40 MiB");
      normalized = [[NSData alloc] initWithBase64EncodedString:replacement[@"base64"] options:0];
      require(normalized && normalized.length >= 5 && normalized.length <= outputLimit && normalized.length == [replacement[@"bytes"] unsignedLongLongValue] && memcmp(normalized.bytes, "%PDF-", 5) == 0 && [hashBytes(normalized) isEqual:replacement[@"hash"]], "INVALID_INPUT", "Private PDF compatibility checksum failed");
    }
    copiedBytes += normalized ? normalized.length : before.st_size; require(copiedBytes <= snapshotLimit, "TOO_LARGE", "Compatible TeX snapshot exceeds 128 MiB");
    texWriteSnapshot(input.value, path, file.fd.value, before.st_size, normalized);
    require(sameStamp(before, info(file.fd.value)), "CHANGED", "TeX resource changed while copying"); verifyPath(source, file);
  }
  require(hasEntry, "INVALID_INPUT", "TeX source is missing from the snapshot"); source.verify(); job.verify(); testPoint(@"tex-snapshot", request);
  auto components = parts(entry); require(!components.empty(), "INVALID_INPUT", "TeX entry is missing");
  std::string name = components.back(); require(name.size() > 4 && [[ns(name) lowercaseString] hasSuffix:@".tex"], "INVALID_INPUT", "Expected a TeX source file"); components.pop_back();
  FD working(dup(input.value)); checked(working.value, "dup TeX working directory"); for (const auto &part : components) { FD next(openat(working.value, part.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)); checked(next.value, "open TeX working directory"); working = std::move(next); }
  auto literal = [](const std::string &value) { return "(literal " + texQuote(value) + ')'; };
  auto subpath = [](const std::string &value) { return "(subpath " + texQuote(value) + ')'; };
  std::string profile = "(version 1)(deny default)(allow process-exec " + literal(engine) + ")(allow process-info* (target self))(allow sysctl-read)(allow file-read* ";
  for (const char *path : {"/usr/lib", "/System/Library", "/System/Volumes/Preboot", "/private/var/db/dyld"}) profile += subpath(path);
  for (const char *path : {"/", "/dev/null", "/dev/random", "/dev/urandom"}) profile += literal(path);
  profile += literal(engine) + literal(bundle) + subpath(job.path) + ")(allow file-write* ";
  for (const char *part : {"out", "cache", "home", "tmp"}) profile += subpath(job.path + '/' + part);
  profile += ')';
  std::vector<std::string> values = {"/usr/bin/sandbox-exec", "-p", profile, engine, "-X", "compile", "--untrusted", "--only-cached", "--bundle", bundle, "--keep-logs", "--keep-intermediates", "--outdir", job.path + "/out", "./" + name};
  std::vector<char *> argv; for (auto &value : values) argv.push_back(value.data()); argv.push_back(nullptr);
  std::vector<std::string> environments = {"PATH=/usr/bin:/bin", "HOME=" + job.path + "/home", "TMPDIR=" + job.path + "/tmp", "XDG_CACHE_HOME=" + job.path + "/cache", "XDG_CONFIG_HOME=" + job.path + "/home", "TECTONIC_UNTRUSTED_MODE=1", "LANG=en_US.UTF-8"};
  std::vector<char *> env; for (auto &value : environments) env.push_back(value.data()); env.push_back(nullptr);
  int out[2], err[2]; checked(pipe(out), "TeX output pipe"); FD outRead(out[0]), outWrite(out[1]); checked(pipe(err), "TeX error pipe"); FD errRead(err[0]), errWrite(err[1]);
  for (int fd : {out[0], out[1], err[0], err[1]}) checked(fcntl(fd, F_SETFD, FD_CLOEXEC), "protect TeX pipe");
  FD nullInput(open("/dev/null", O_RDONLY | O_CLOEXEC)); checked(nullInput.value, "open TeX null input");
  struct rlimit cpu = {25, 27}, fileSize = {outputLimit, outputLimit}, descriptors = {128, 128};
  checked(setrlimit(RLIMIT_CPU, &cpu), "set TeX CPU budget"); checked(setrlimit(RLIMIT_FSIZE, &fileSize), "set TeX output budget"); checked(setrlimit(RLIMIT_NOFILE, &descriptors), "set TeX descriptor budget");
  posix_spawn_file_actions_t actions; posix_spawn_file_actions_init(&actions);
  posix_spawn_file_actions_adddup2(&actions, nullInput.value, STDIN_FILENO); posix_spawn_file_actions_adddup2(&actions, out[1], STDOUT_FILENO); posix_spawn_file_actions_adddup2(&actions, err[1], STDERR_FILENO); posix_spawn_file_actions_addfchdir_np(&actions, working.value);
  const auto started = std::chrono::steady_clock::now();
  int wall = [request[@"wallMs"] intValue]; require(wall == 15000 || wall == 30000, "INVALID_INPUT", "Invalid TeX wall-clock budget");
#ifdef WILLYOU_FILE_BROKER_TEST
  if ([request[@"testWallMs"] intValue] > 0) wall = std::min(wall, [request[@"testWallMs"] intValue]);
#endif
  const auto deadline = started + std::chrono::milliseconds(wall);
  pid_t pid; int spawned = posix_spawn(&pid, "/usr/bin/sandbox-exec", &actions, nullptr, argv.data(), env.data()); posix_spawn_file_actions_destroy(&actions);
  if (spawned) { errno = spawned; checked(-1, "start offline TeX compiler"); }
  outWrite = FD(); errWrite = FD(); for (int fd : {outRead.value, errRead.value}) checked(fcntl(fd, F_SETFL, O_NONBLOCK), "nonblocking TeX pipe");
  uint64_t peak = 0; size_t logBytes = 0; std::string diagnostic; int status = 0; auto nextSizeCheck = started;
  try {
    bool running = true;
    while (running || outRead.value >= 0 || errRead.value >= 0) {
      auto now = std::chrono::steady_clock::now(); require(now < deadline, "TIMEOUT", "TeX compile exceeded its wall-clock budget");
      struct proc_taskinfo metrics; if (proc_pidinfo(pid, PROC_PIDTASKINFO, 0, &metrics, sizeof(metrics)) == sizeof(metrics)) { peak = std::max(peak, metrics.pti_resident_size); require(peak <= 768ull * 1024 * 1024, "TOO_LARGE", "TeX compiler exceeded 768 MiB RSS"); }
      if (now >= nextSizeCheck) { size_t count = 0; require(texDirectoryBytes(output.value, count) <= outputLimit, "TOO_LARGE", "TeX output exceeds 40 MiB"); count = 0; texDirectoryBytes(cache.value, count); count = 0; texDirectoryBytes(home.value, count); count = 0; texDirectoryBytes(temporary.value, count); nextSizeCheck = now + std::chrono::milliseconds(100); }
      pollfd polls[2] = {{outRead.value, POLLIN, 0}, {errRead.value, POLLIN, 0}}; poll(polls, 2, 20);
      for (int index = 0; index < 2; index++) if (polls[index].revents & (POLLIN | POLLHUP | POLLERR)) {
        char data[8192]; ssize_t count;
        do { count = read(polls[index].fd, data, sizeof(data)); if (count > 0) { logBytes += count; require(logBytes <= 1024 * 1024, "TOO_LARGE", "TeX diagnostic output exceeds 1 MiB"); diagnostic.append(data, count); if (diagnostic.size() > 65536) diagnostic.erase(0, diagnostic.size() - 65536); } } while (count > 0);
        if (count == 0) { if (index == 0) outRead = FD(); else errRead = FD(); }
      }
      if (running) { pid_t value = waitpid(pid, &status, WNOHANG); if (value == pid) running = false; else if (value < 0 && errno != EINTR) checked(-1, "wait for TeX compiler"); }
    }
  } catch (...) { kill(pid, SIGKILL); while (waitpid(pid, &status, 0) < 0 && errno == EINTR) {} throw; }
  job.verify(); source.verify();
  for (NSDictionary *resource in resources) { std::string path = str(resource[@"path"]); checkProtected(source, path, request[@"protected"] ?: @[]); Opened current = openPath(source, path, false, false); require(matchesRevisionMetadata(info(current.fd.value), resource[@"revision"]) && [hashFile(current.fd.value, snapshotLimit) isEqual:resource[@"revision"][@"hash"]], "CHANGED", "TeX source or resource changed during compilation"); verifyPath(source, current); }
  NSData *log = [NSData dataWithBytes:diagnostic.data() length:diagnostic.size()]; NSString *logText = [[NSString alloc] initWithData:log encoding:NSUTF8StringEncoding] ?: @"编译日志包含无效 UTF-8";
  logText = [logText stringByReplacingOccurrencesOfString:ns(job.path) withString:@"<编译快照>"];
  if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) return @{ @"state": @"failed", @"diagnostic": logText, @"message": @"TeX 编译失败；源码保留，未采用残留产物" };
  size_t count = 0; require(texDirectoryBytes(output.value, count) <= outputLimit, "TOO_LARGE", "TeX output exceeds 40 MiB");
  std::string pdfName = name.substr(0, name.size() - 4) + ".pdf"; FD pdf(openat(output.value, pdfName.c_str(), O_RDONLY | O_NOFOLLOW | O_CLOEXEC)); checked(pdf.value, "open TeX PDF result");
  NSData *pdfBytes = readBytes(pdf.value, 0, outputLimit, outputLimit); require(pdfBytes.length >= 5 && memcmp(pdfBytes.bytes, "%PDF-", 5) == 0, "INVALID_INPUT", "Compiler did not produce a PDF");
  CGDataProviderRef provider = CGDataProviderCreateWithCFData((__bridge CFDataRef)pdfBytes); CGPDFDocumentRef document = CGPDFDocumentCreateWithProvider(provider); CGDataProviderRelease(provider);
  require(document != nullptr, "INVALID_INPUT", "Compiled PDF cannot be reopened"); size_t pages = CGPDFDocumentGetNumberOfPages(document); CGPDFDocumentRelease(document); require(pages > 0 && pages <= 2000, "TOO_LARGE", "Compiled PDF is empty or exceeds 2000 pages");
  return @{ @"state": @"ready", @"base64": [pdfBytes base64EncodedStringWithOptions:0], @"hash": hashBytes(pdfBytes), @"pages": @(pages), @"bytes": @(pdfBytes.length), @"peakRssBytes": @(peak), @"elapsedMs": @(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count()), @"diagnostic": logText };
}
