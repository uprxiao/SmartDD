// Calculation-only POI/JRE, with no ambient project/user resources. The caller
// preflights the candidate ZIP in a disposable Worker before handing it here.
static NSDictionary *officeCalculateOperation(NSDictionary *request) {
  constexpr uint64_t limit = 40ull * 1024 * 1024;
  const bool validating = [request[@"operation"] isEqual:@"office-validate"];
  NSUInteger validationCount = 0;
  Root job(request[@"job"]), runtime(request[@"runtime"]);
  require(job.privateObjects && job.initial.st_uid == geteuid() && (job.initial.st_mode & 0777) == 0700, "UNTRUSTED", "Office workspace must be private");
  pid_t owner; FD marker = engineJobMarker(job.fd.value, job.initial, owner, true);
  require(owner == getppid(), "UNTRUSTED", "Office workspace belongs to another application process");
  checked(flock(marker.value, LOCK_EX | LOCK_NB), "lock Office workspace");
  require([request[@"base64"] isKindOfClass:NSString.class] && [request[@"base64"] length] <= ((limit + 2) / 3) * 4, "TOO_LARGE", "Office calculation input exceeds 40 MiB");
  NSData *bytes = [[NSData alloc] initWithBase64EncodedString:request[@"base64"] options:0];
  require(bytes && bytes.length > 0 && bytes.length <= limit && [hashBytes(bytes) isEqual:request[@"hash"]], "CHANGED", "Office calculation input hash mismatch");
  FD input = texDirectory(job.fd.value, "input"), output = texDirectory(job.fd.value, "out"), home = texDirectory(job.fd.value, "home"), temporary = texDirectory(job.fd.value, "tmp");
  FD source(openat(input.value, "source.xlsx", O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0400)); checked(source.value, "create Office calculation snapshot"); writeAll(source.value, bytes); source = FD();
  if (validating) {
    NSArray *formulas = request[@"formulas"];
    require([formulas isKindOfClass:NSArray.class] && formulas.count > 0 && formulas.count <= 10000, "TOO_LARGE", "Formula validation count exceeds budget");
    NSMutableData *data = [NSMutableData data];
    for (NSDictionary *formula in formulas) {
      require([formula isKindOfClass:NSDictionary.class], "INVALID_INPUT", "Invalid formula request");
      NSNumber *sheet = formula[@"sheetIndex"], *row = formula[@"row"]; NSString *text = formula[@"formula"];
      require([sheet isKindOfClass:NSNumber.class] && [row isKindOfClass:NSNumber.class] && sheet.doubleValue == sheet.longLongValue && row.doubleValue == row.longLongValue && sheet.longLongValue >= 0 && sheet.longLongValue <= 65535 && row.longLongValue >= 0 && row.longLongValue < 1048576 && [text isKindOfClass:NSString.class] && text.length > 0 && text.length <= 8192, "INVALID_INPUT", "Invalid formula context");
      NSData *encoded = [text dataUsingEncoding:NSUTF8StringEncoding allowLossyConversion:NO]; require(encoded != nil, "INVALID_INPUT", "Invalid formula encoding");
      NSString *line = [NSString stringWithFormat:@"%lld\t%lld\t%@\n", sheet.longLongValue, row.longLongValue, [encoded base64EncodedStringWithOptions:0]];
      [data appendData:[line dataUsingEncoding:NSUTF8StringEncoding]];
      require(data.length <= 8ull * 1024 * 1024, "TOO_LARGE", "Formula validation input exceeds 8 MiB");
    }
    FD formulaFile(openat(input.value, "formulas.tsv", O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0400)); checked(formulaFile.value, "create private formula request"); writeAll(formulaFile.value, data); validationCount = formulas.count;
  }
  testPoint(@"office-snapshot", request);
  NSArray *files = request[@"files"];
  require([files isKindOfClass:NSArray.class] && files.count >= 20 && files.count <= 1024 && (runtime.initial.st_mode & 0022) == 0, "UNTRUSTED", "Office runtime manifest or permissions are invalid");
  std::set<std::string> paths; std::vector<std::string> libraries;
  uint64_t resourceBytes = 0;
  for (NSDictionary *file in files) {
    std::string path = str(file[@"path"]); require(paths.insert(path).second && (path.rfind("jre/", 0) == 0 || path.rfind("lib/", 0) == 0 || path.rfind("classes/", 0) == 0), "UNTRUSTED", "Unexpected Office runtime file");
    Opened asset = openPath(runtime, path, false, false); auto stat = info(asset.fd.value); regular(stat, 256ull * 1024 * 1024);
    resourceBytes += stat.st_size; require(resourceBytes <= 256ull * 1024 * 1024 && (stat.st_mode & 0022) == 0 && matches(stat, file[@"identity"]), "UNTRUSTED", "Office runtime file identity or permissions changed");
    require([hashFile(asset.fd.value, 256ull * 1024 * 1024) isEqual:file[@"hash"]], "CHANGED", "Office runtime file hash changed"); verifyPath(runtime, asset);
    if (path.rfind("lib/", 0) == 0) { require(path.find('/', 4) == std::string::npos && path.size() > 4 && path.substr(path.size() - 4) == ".jar", "UNTRUSTED", "Unexpected Office classpath file"); libraries.push_back(path); }
  }
  require(paths.count("jre/bin/java") && paths.count("classes/WillYouOffice.class") && libraries.size() == 13, "UNTRUSTED", "Fixed Office runtime is incomplete");
  std::sort(libraries.begin(), libraries.end());
  std::string java = runtime.path + "/jre/bin/java", classpath = runtime.path + "/classes";
  for (const auto &library : libraries) classpath += ':' + runtime.path + '/' + library;
  runtime.verify(); job.verify();
  auto literal = [](const std::string &value) { return "(literal " + texQuote(value) + ')'; };
  auto subpath = [](const std::string &value) { return "(subpath " + texQuote(value) + ')'; };
  std::string profile = "(version 1)(deny default)(allow process-exec " + literal(java) + ")(allow process-info* (target self))(allow sysctl-read)(allow file-read* ";
  for (const char *path : {"/usr/lib", "/System/Library", "/System/Volumes/Preboot", "/private/var/db/dyld", "/usr/share/zoneinfo"}) profile += subpath(path);
  for (const char *path : {"/", "/dev/null", "/dev/random", "/dev/urandom"}) profile += literal(path);
  profile += subpath(runtime.path) + subpath(job.path) + ")(allow file-write* " + subpath(job.path + "/out") + subpath(job.path + "/home") + subpath(job.path + "/tmp") + ')';
  // HotSpot resolves its own libjvm path during VM bootstrap. It needs ancestor
  // metadata for realpath, but no contents/listing outside the two private roots.
  profile += "(allow file-read-metadata ";
  for (std::string parent : {runtime.path, job.path}) {
    while (parent.size() > 1) { parent = gitParent(parent); profile += literal(parent); }
  }
  profile += ')';
  std::vector<std::string> values = {"/usr/bin/sandbox-exec", "-p", profile, java, "-Xmx512m", "-XX:+ExitOnOutOfMemoryError", "-XX:-UsePerfData", "-Djava.awt.headless=true", "-Duser.timezone=UTC", "-Dfile.encoding=UTF-8", "-Duser.home=" + job.path + "/home", "-Djava.io.tmpdir=" + job.path + "/tmp", "-cp", classpath, "WillYouOffice", "calculate", job.path + "/input/source.xlsx", job.path + "/out/calculated.xlsx"};
  if (validating) { values[values.size() - 3] = "validate"; values.back() = job.path + "/input/formulas.tsv"; }
  std::vector<char *> argv; for (auto &value : values) argv.push_back(value.data()); argv.push_back(nullptr);
  std::vector<std::string> environments = {"PATH=/usr/bin:/bin", "HOME=" + job.path + "/home", "TMPDIR=" + job.path + "/tmp", "LANG=en_US.UTF-8"};
  std::vector<char *> env; for (auto &value : environments) env.push_back(value.data()); env.push_back(nullptr);
  int out[2], err[2]; checked(pipe(out), "Office output pipe"); FD outRead(out[0]), outWrite(out[1]); checked(pipe(err), "Office error pipe"); FD errRead(err[0]), errWrite(err[1]);
  for (int fd : {out[0], out[1], err[0], err[1]}) checked(fcntl(fd, F_SETFD, FD_CLOEXEC), "protect Office pipe");
  FD nullInput(open("/dev/null", O_RDONLY | O_CLOEXEC)); checked(nullInput.value, "open Office null input");
  struct rlimit cpu = {18, 20}, fileSize = {limit, limit}, descriptors = {256, 256};
  checked(setrlimit(RLIMIT_CPU, &cpu), "set Office CPU budget"); checked(setrlimit(RLIMIT_FSIZE, &fileSize), "set Office file budget"); checked(setrlimit(RLIMIT_NOFILE, &descriptors), "set Office descriptor budget");
  posix_spawn_file_actions_t actions; posix_spawn_file_actions_init(&actions);
  posix_spawn_file_actions_adddup2(&actions, nullInput.value, STDIN_FILENO); posix_spawn_file_actions_adddup2(&actions, out[1], STDOUT_FILENO); posix_spawn_file_actions_adddup2(&actions, err[1], STDERR_FILENO); posix_spawn_file_actions_addfchdir_np(&actions, job.fd.value);
  const auto started = std::chrono::steady_clock::now(); int wall = 20000; uint64_t rssLimit = 768ull * 1024 * 1024;
#ifdef WILLYOU_FILE_BROKER_TEST
  if ([request[@"testWallMs"] intValue] > 0) wall = std::min(wall, [request[@"testWallMs"] intValue]);
  if ([request[@"testRssBytes"] unsignedLongLongValue] > 0) rssLimit = std::min(rssLimit, (uint64_t)[request[@"testRssBytes"] unsignedLongLongValue]);
#endif
  const auto deadline = started + std::chrono::milliseconds(wall);
  pid_t pid; int spawned = posix_spawn(&pid, "/usr/bin/sandbox-exec", &actions, nullptr, argv.data(), env.data()); posix_spawn_file_actions_destroy(&actions);
  if (spawned) { errno = spawned; checked(-1, "start Office calculation"); }
  outWrite = FD(); errWrite = FD(); for (int fd : {outRead.value, errRead.value}) checked(fcntl(fd, F_SETFL, O_NONBLOCK), "nonblocking Office pipe");
  uint64_t peak = 0; size_t logBytes = 0; std::string diagnostic, resultText; int status = 0; auto nextSizeCheck = started;
  try {
    testPoint(@"office-running", request);
    bool running = true;
    while (running || outRead.value >= 0 || errRead.value >= 0) {
      auto now = std::chrono::steady_clock::now(); require(now < deadline, "TIMEOUT", "Office calculation exceeded 20 seconds"); require(getppid() == owner, "CANCELLED", "Office application exited during calculation");
      struct proc_taskinfo metrics; if (proc_pidinfo(pid, PROC_PIDTASKINFO, 0, &metrics, sizeof(metrics)) == sizeof(metrics)) { peak = std::max(peak, metrics.pti_resident_size); require(peak <= rssLimit, "TOO_LARGE", "Office calculation exceeded its 768 MiB RSS budget"); }
      if (now >= nextSizeCheck) { size_t count = 0; require(texDirectoryBytes(output.value, count) <= limit, "TOO_LARGE", "Office calculation output exceeds 40 MiB"); count = 0; require(texDirectoryBytes(home.value, count) <= limit, "TOO_LARGE", "Office home budget exceeded"); count = 0; require(texDirectoryBytes(temporary.value, count) <= limit, "TOO_LARGE", "Office temporary budget exceeded"); nextSizeCheck = now + std::chrono::milliseconds(100); }
      pollfd polls[2] = {{outRead.value, POLLIN, 0}, {errRead.value, POLLIN, 0}}; poll(polls, 2, 20);
      for (int index = 0; index < 2; index++) if (polls[index].revents & (POLLIN | POLLHUP | POLLERR)) {
        char data[8192]; ssize_t count;
        do { count = read(polls[index].fd, data, sizeof(data)); if (count > 0) { logBytes += count; require(logBytes <= 1024 * 1024, "TOO_LARGE", "Office diagnostic output exceeds 1 MiB"); auto &text = index == 0 ? resultText : diagnostic; text.append(data, count); if (text.size() > 65536) text.erase(0, text.size() - 65536); } } while (count > 0);
        if (count == 0) { if (index == 0) outRead = FD(); else errRead = FD(); }
      }
      if (running) { pid_t value = waitpid(pid, &status, WNOHANG); if (value == pid) running = false; else if (value < 0 && errno != EINTR) checked(-1, "wait for Office calculation"); }
    }
  } catch (...) { kill(pid, SIGKILL); while (waitpid(pid, &status, 0) < 0 && errno == EINTR) {} throw; }
  job.verify(); runtime.verify();
  const bool succeeded = WIFEXITED(status) && WEXITSTATUS(status) == 0;
  if (!succeeded) diagnostic += resultText;
  NSString *log = [[NSString alloc] initWithBytes:diagnostic.data() length:diagnostic.size() encoding:NSUTF8StringEncoding] ?: @"Office diagnostic contains invalid UTF-8";
  log = [[log stringByReplacingOccurrencesOfString:ns(job.path) withString:@"<计算快照>"] stringByReplacingOccurrencesOfString:ns(runtime.path) withString:@"<固定引擎>"];
  if (!succeeded) return @{ @"state": @"failed", @"diagnostic": [NSString stringWithFormat:@"exit=%d signal=%d\n%@", WIFEXITED(status) ? WEXITSTATUS(status) : -1, WIFSIGNALED(status) ? WTERMSIG(status) : 0, log], @"message": validating ? @"公式未通过当前引擎校验；请检查语法或当前引擎支持情况。输入和草稿仍保留。" : @"工作簿计算失败；原件和草稿保留" };
  const std::string prefix = "WILLYOU_OFFICE_RESULT="; auto position = resultText.find(prefix);
  require(position != std::string::npos && (position == 0 || resultText[position - 1] == '\n') && resultText.find(prefix, position + prefix.size()) == std::string::npos, "IO", "Missing or repeated Office calculation receipt");
  // JVM/native initialization can report warnings on stdout. Keep those as
  // diagnostics; only the helper's unique final frame is an authoritative result.
  if (position) { NSString *warning = [[NSString alloc] initWithBytes:resultText.data() length:position encoding:NSUTF8StringEncoding]; if (warning) log = [log stringByAppendingString:warning]; }
  position += prefix.size(); NSData *resultData = [NSData dataWithBytes:resultText.data() + position length:resultText.size() - position];
  NSDictionary *result = [NSJSONSerialization JSONObjectWithData:resultData options:0 error:nil];
  require([result isKindOfClass:NSDictionary.class] && [result[@"engine"] isEqual:@"Apache POI 5.5.1"] && [result[@"formulas"] isKindOfClass:NSNumber.class] && [result[@"formulas"] integerValue] >= 0, "IO", "Invalid Office calculation receipt");
  if (validating) {
    require([result[@"formulas"] unsignedIntegerValue] == validationCount, "IO", "Formula validation receipt count mismatch");
    return @{ @"state": @"validated", @"hash": hashBytes(bytes), @"formulas": result[@"formulas"], @"peakRssBytes": @(peak), @"elapsedMs": @(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count()), @"diagnostic": log };
  }
  FD candidate(openat(output.value, "calculated.xlsx", O_RDONLY | O_NOFOLLOW | O_CLOEXEC)); checked(candidate.value, "open Office calculation result");
  NSData *calculated = readBytes(candidate.value, 0, limit, limit); require(calculated.length > 4 && memcmp(calculated.bytes, "PK\003\004", 4) == 0, "INVALID_INPUT", "Office calculation did not produce an OOXML package");
  return @{ @"state": @"ready", @"base64": [calculated base64EncodedStringWithOptions:0], @"hash": hashBytes(calculated), @"bytes": @(calculated.length), @"formulas": result[@"formulas"], @"peakRssBytes": @(peak), @"elapsedMs": @(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count()), @"diagnostic": log };
}
