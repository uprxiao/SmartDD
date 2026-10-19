// Read-only Git is a conditional metadata provider, never a command runner.
// Git gets no inherited user environment; Seatbelt forbids writes, networking
// and subprocesses (including filters, hooks, fsmonitor and lazy fetch).
#include <spawn.h>
#include <poll.h>
#include <sys/wait.h>
#include <chrono>

static std::string gitParent(const std::string &path) { auto at = path.rfind('/'); return at == 0 ? "/" : path.substr(0, at); }
static std::string gitCanonical(const std::string &path) { char resolved[PATH_MAX]; checked(realpath(path.c_str(), resolved) ? 0 : -1, "resolve repository metadata"); return resolved; }
static std::string gitTrim(std::string value) { while (!value.empty() && (value.back() == '\n' || value.back() == '\r')) value.pop_back(); return value; }
static std::string gitSmallFile(const std::string &path) {
  FD fd(open(path.c_str(), O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)); checked(fd.value, "open repository descriptor");
  auto s = info(fd.value); require(s.st_uid == geteuid(), "UNTRUSTED", "Repository metadata has a different owner");
  NSData *data = readBytes(fd.value, 0, 32768, 32768); return std::string((const char *)data.bytes, data.length);
}
struct GitRepository {
  std::string path, metadata, common, prefix; FD directory, metaDirectory, commonDirectory; struct stat initial, metaInitial, commonInitial;
  explicit GitRepository(const Root &root) {
    for (std::string cursor = root.path;; cursor = gitParent(cursor)) {
      struct stat marker;
      if (lstat((cursor + "/.git").c_str(), &marker) == 0) {
        require(marker.st_uid == geteuid() && !S_ISLNK(marker.st_mode), "UNTRUSTED", "Repository marker is not trusted");
        path = cursor;
        if (S_ISDIR(marker.st_mode)) metadata = cursor + "/.git";
        else {
          std::string pointer = gitTrim(gitSmallFile(cursor + "/.git"));
          require(pointer.rfind("gitdir: ", 0) == 0 && pointer.find('\0') == std::string::npos, "UNTRUSTED", "Invalid worktree repository descriptor");
          std::string target = pointer.substr(8); require(!target.empty(), "UNTRUSTED", "Empty worktree repository descriptor");
          metadata = target.front() == '/' ? target : cursor + '/' + target;
        }
        break;
      }
      if (errno != ENOENT) checked(-1, "discover repository");
      if (cursor == "/") return;
    }
    metadata = gitCanonical(metadata); common = metadata;
    struct stat commonMarker;
    if (lstat((metadata + "/commondir").c_str(), &commonMarker) == 0) {
      std::string target = gitTrim(gitSmallFile(metadata + "/commondir"));
      require(!target.empty() && target.find('\0') == std::string::npos, "UNTRUSTED", "Invalid common repository descriptor");
      common = gitCanonical(target.front() == '/' ? target : metadata + '/' + target);
    } else if (errno != ENOENT) checked(-1, "inspect common repository");
    directory = FD(open(path.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)); checked(directory.value, "open repository"); initial = info(directory.value);
    metaDirectory = FD(open(metadata.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)); checked(metaDirectory.value, "open git directory"); metaInitial = info(metaDirectory.value);
    commonDirectory = FD(open(common.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)); checked(commonDirectory.value, "open common git directory"); commonInitial = info(commonDirectory.value);
    require(initial.st_uid == geteuid() && metaInitial.st_uid == geteuid() && commonInitial.st_uid == geteuid(), "UNTRUSTED", "Repository ownership is not trusted");
    struct statfs volume; checked(fstatfs(metaDirectory.value, &volume), "repository volume"); require(volume.f_flags & MNT_LOCAL, "UNSUPPORTED", "Remote repository metadata is not supported");
    checked(fstatfs(commonDirectory.value, &volume), "common repository volume"); require(volume.f_flags & MNT_LOCAL, "UNSUPPORTED", "Remote common repository metadata is not supported");
    prefix = root.path == path ? "" : root.path.substr(path == "/" ? 1 : path.size() + 1) + '/';
  }
  void verify(const Root &root) const {
    root.verify(); GitRepository latest(root);
    require(latest.path == path && latest.metadata == metadata && latest.common == common && sameIdentity(initial, latest.initial) && sameIdentity(metaInitial, latest.metaInitial) && sameIdentity(commonInitial, latest.commonInitial), "CHANGED", "Repository identity changed during metadata request");
  }
};
struct GitResult { int code; std::string out, error; };
using GitDeadline = std::chrono::steady_clock::time_point;
static GitResult runReadOnlyGit(const GitRepository &repo, const std::vector<std::string> &args, const std::string &input, GitDeadline deadline, size_t limit = 8 * 1024 * 1024) {
  std::string executable;
  for (const char *candidate : {"/Library/Developer/CommandLineTools/usr/bin/git", "/Applications/Xcode.app/Contents/Developer/usr/bin/git"}) if (access(candidate, X_OK) == 0) { executable = candidate; break; }
  require(!executable.empty(), "UNSUPPORTED", "Git is not installed; file browsing is still available");
  // Only fixed, OS-installed executable paths enter this profile.
  std::string profile = "(version 1)(allow default)(deny network*)(deny file-write* (require-not (literal \"/dev/null\")))(deny process-fork)(deny process-exec (require-not (literal \"" + executable + "\")))";
  std::vector<std::string> values = {"/usr/bin/sandbox-exec", "-p", profile, executable, "--no-pager", "--no-optional-locks", "--literal-pathspecs", "--git-dir=" + repo.metadata, "--work-tree=.", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "core.untrackedCache=false", "-c", "core.attributesFile=/dev/null", "-c", "core.excludesFile=/dev/null", "-c", "core.quotePath=false", "-c", "diff.external=", "-c", "diff.ignoreSubmodules=all", "-c", "submodule.recurse=false", "-c", "credential.helper=", "-c", "protocol.allow=never", "-c", "core.pager=cat"};
  values.insert(values.end(), args.begin(), args.end());
  std::vector<char *> argv; for (auto &value : values) argv.push_back(value.data()); argv.push_back(nullptr);
  char envPath[] = "PATH=/usr/bin:/bin", envLang[] = "LANG=C.UTF-8", envHome[] = "HOME=/nonexistent", envGlobal[] = "GIT_CONFIG_GLOBAL=/dev/null", envSystem[] = "GIT_CONFIG_NOSYSTEM=1", envPrompt[] = "GIT_TERMINAL_PROMPT=0", envLocks[] = "GIT_OPTIONAL_LOCKS=0", envFetch[] = "GIT_NO_LAZY_FETCH=1", envReplace[] = "GIT_NO_REPLACE_OBJECTS=1", envAttr[] = "GIT_ATTR_NOSYSTEM=1";
  char *env[] = {envPath, envLang, envHome, envGlobal, envSystem, envPrompt, envLocks, envFetch, envReplace, envAttr, nullptr};
  int in[2], out[2], err[2]; checked(pipe(in), "git input pipe"); FD inRead(in[0]), inWrite(in[1]); checked(pipe(out), "git output pipe"); FD outRead(out[0]), outWrite(out[1]); checked(pipe(err), "git error pipe"); FD errRead(err[0]), errWrite(err[1]);
  for (int fd : {in[0], in[1], out[0], out[1], err[0], err[1]}) checked(fcntl(fd, F_SETFD, FD_CLOEXEC), "protect git pipe");
  posix_spawn_file_actions_t actions; posix_spawn_file_actions_init(&actions);
  posix_spawn_file_actions_adddup2(&actions, in[0], STDIN_FILENO); posix_spawn_file_actions_adddup2(&actions, out[1], STDOUT_FILENO); posix_spawn_file_actions_adddup2(&actions, err[1], STDERR_FILENO);
  posix_spawn_file_actions_addfchdir_np(&actions, repo.directory.value);
  pid_t pid; int spawned = posix_spawn(&pid, "/usr/bin/sandbox-exec", &actions, nullptr, argv.data(), env); posix_spawn_file_actions_destroy(&actions);
  if (spawned) { errno = spawned; checked(-1, "start read-only Git"); }
  inRead = FD(); outWrite = FD(); errWrite = FD();
  for (int fd : {inWrite.value, outRead.value, errRead.value}) checked(fcntl(fd, F_SETFL, O_NONBLOCK), "nonblocking git pipe");
  GitResult result{0, "", ""}; size_t sent = 0; bool outputOpen = true, errorOpen = true; int status = 0;
  try {
    while (outputOpen || errorOpen) {
      require(std::chrono::steady_clock::now() < deadline, "TIMEOUT", "Git metadata exceeded the 12 second budget");
      if (sent == input.size()) inWrite = FD();
      pollfd polls[3] = {{outRead.value, POLLIN, 0}, {errRead.value, POLLIN, 0}, {inWrite.value, POLLOUT, 0}}; poll(polls, 3, 20);
      if (inWrite.value >= 0 && (polls[2].revents & POLLOUT)) { ssize_t count = write(inWrite.value, input.data() + sent, std::min<size_t>(16384, input.size() - sent)); if (count > 0) sent += count; else if (errno != EAGAIN && errno != EINTR) inWrite = FD(); }
      if (polls[2].revents & (POLLHUP | POLLERR)) inWrite = FD();
      for (int index = 0; index < 2; ++index) if (polls[index].revents & (POLLIN | POLLHUP | POLLERR)) {
        char bytes[16384]; ssize_t count;
        do { count = read(polls[index].fd, bytes, sizeof(bytes)); if (count > 0) {
          std::string &target = index == 0 ? result.out : result.error;
          require(target.size() + count <= (index == 0 ? limit : 65536), "TOO_LARGE", "Git metadata output exceeded its budget"); target.append(bytes, count);
        } } while (count > 0);
        if (count == 0) { if (index == 0) { outputOpen = false; outRead = FD(); } else { errorOpen = false; errRead = FD(); } }
      }
    }
    while (waitpid(pid, &status, WNOHANG) == 0) { require(std::chrono::steady_clock::now() < deadline, "TIMEOUT", "Git did not exit"); poll(nullptr, 0, 10); }
  } catch (...) { kill(pid, SIGKILL); while (waitpid(pid, &status, 0) < 0 && errno == EINTR) {} throw; }
  result.code = WIFEXITED(status) ? WEXITSTATUS(status) : 128;
  return result;
}
static std::vector<std::string> gitZeroParts(const std::string &input) {
  std::vector<std::string> result; size_t start = 0, end;
  while ((end = input.find('\0', start)) != std::string::npos) { result.push_back(input.substr(start, end - start)); start = end + 1; }
  require(start == input.size(), "IO", "Invalid NUL-delimited Git result"); return result;
}
static NSDictionary *gitMetadataOperation(NSDictionary *request) {
  Root root(request[@"root"]); checkProtected(root, "", request[@"protected"] ?: @[]); GitRepository repo(root);
  if (repo.path.empty()) return @{ @"state": @"unavailable", @"reason": @"当前目录不在 Git 工作树中" };
  GitDeadline deadline = std::chrono::steady_clock::now() + std::chrono::seconds(12);
  auto run = [&](const std::vector<std::string> &args, const std::string &input = "", size_t limit = 8 * 1024 * 1024) { return runReadOnlyGit(repo, args, input, deadline, limit); };
  auto headResult = run({"rev-parse", "--verify", "HEAD"});
  std::string head = headResult.code == 0 ? gitTrim(headResult.out) : "";
  auto remote = run({"config", "--get", "remote.origin.url"}, "", 32768);
  NSMutableDictionary *result = [@{ @"state": @"ready", @"repository": identity(repo.initial), @"metadata": identity(repo.metaInitial), @"head": ns(head), @"prefix": ns(repo.prefix), @"remote": remote.code == 0 ? ns(gitTrim(remote.out)) : @"" } mutableCopy];
  if (str(request[@"operation"]) == "git-status") {
    auto status = run({"status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching", "--ignore-submodules=all", "--", repo.prefix.empty() ? "." : repo.prefix});
    require(status.code == 0, "UNSUPPORTED", "Git status is unavailable; external filters, helpers and writes are disabled");
    auto records = gitZeroParts(status.out); std::string visible, attributeInput; size_t count = 0; bool truncated = false;
    for (size_t i = 0; i < records.size(); ++i) {
      std::string record = records[i]; require(record.size() >= 4 && record[2] == ' ', "IO", "Malformed Git status record");
      bool rename = record[0] == 'R' || record[1] == 'R' || record[0] == 'C' || record[1] == 'C'; std::string previous;
      if (rename) { require(++i < records.size(), "IO", "Incomplete Git rename record"); previous = records[i]; }
      std::string path = record.substr(3); if (path.rfind(repo.prefix, 0) != 0) continue;
      std::string relative = path.substr(repo.prefix.size()); if (!relative.empty() && relative.back() == '/') relative.pop_back(); if (relative.empty()) continue;
      try { checkProtected(root, relative, request[@"protected"] ?: @[]); } catch (const Failure &e) { if (e.code != "MISSING") continue; }
      if (count++ >= 20000) { truncated = true; break; }
      visible += record + '\0'; if (rename) visible += (previous.rfind(repo.prefix, 0) == 0 ? previous : "") + '\0';
      attributeInput += path + '\0';
    }
    auto attributes = attributeInput.empty() ? GitResult{0, "", ""} : run({"check-attr", "-z", "--stdin", "linguist-generated"}, attributeInput);
    result[@"statusBase64"] = [[NSData dataWithBytes:visible.data() length:visible.size()] base64EncodedStringWithOptions:0];
    result[@"attributesBase64"] = [[NSData dataWithBytes:attributes.out.data() length:attributes.out.size()] base64EncodedStringWithOptions:0]; result[@"attributesAvailable"] = @(attributes.code == 0); result[@"truncated"] = @(truncated);
  } else {
    std::string relative = str(request[@"relativePath"]); checkProtected(root, relative, request[@"protected"] ?: @[]); Opened file = openPath(root, relative);
    require(matches(info(file.fd.value), request[@"expectedIdentity"]), "CHANGED", "Blame file identity changed");
    NSData *bytes = readBytes(file.fd.value, 0, 20 * 1024 * 1024, 20 * 1024 * 1024);
    require([hashBytes(bytes) isEqual:request[@"baseHash"]], "CHANGED", "Blame file revision changed");
    if (head.empty()) return @{ @"state": @"unavailable", @"reason": @"仓库尚无提交，无法显示行归属" };
    std::string path = repo.prefix + file.relative;
    auto committed = run({"cat-file", "blob", head + ':' + path}, "", 20 * 1024 * 1024);
    if (committed.code != 0 || committed.out.size() != bytes.length || memcmp(committed.out.data(), bytes.bytes, bytes.length) != 0) { repo.verify(root); return @{ @"state": @"unavailable", @"reason": @"当前文件没有匹配的已提交版本，行归属暂不可用" }; }
    int start = [request[@"lineStart"] intValue], end = [request[@"lineEnd"] intValue]; require(start >= 1 && end >= start && end - start < 400, "INVALID_INPUT", "Blame range is limited to 400 lines");
    auto blame = run({"blame", "--line-porcelain", "--no-textconv", "-L", std::to_string(start) + ',' + std::to_string(end), head, "--", path});
    require(blame.code == 0, "UNSUPPORTED", "Git blame is unavailable for this file or line range");
    testPoint(@"git-read", request); verifyPath(root, file); require([hashFile(file.fd.value, 20 * 1024 * 1024) isEqual:request[@"baseHash"]], "CHANGED", "File changed while reading blame");
    result[@"blameBase64"] = [[NSData dataWithBytes:blame.out.data() length:blame.out.size()] base64EncodedStringWithOptions:0]; result[@"baseHash"] = request[@"baseHash"];
  }
  testPoint(@"git-finished", request); repo.verify(root);
  auto finalHead = run({"rev-parse", "--verify", "HEAD"}); require((finalHead.code == 0 ? gitTrim(finalHead.out) : "") == head, "CHANGED", "Repository revision changed during metadata request");
  return result;
}
