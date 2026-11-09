#include <sys/file.h>

static const char *engineMarkerName(bool office) { return office ? ".willyou-office-job.json" : ".willyou-tex-job.json"; }
static FD engineJobMarker(int directory, const struct stat &job, pid_t &owner, bool office = false) {
  FD marker(openat(directory, engineMarkerName(office), O_RDWR | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)); checked(marker.value, "open Engine job identity");
  auto value = info(marker.value); regular(value, 4096);
  require(value.st_uid == geteuid() && (value.st_mode & 0777) == 0600 && value.st_nlink == 1, "UNTRUSTED", "Engine job marker owner or mode changed");
  id json = [NSJSONSerialization JSONObjectWithData:readBytes(marker.value, 0, 4096, 4096) options:0 error:nil];
  require([json isKindOfClass:NSDictionary.class] && [json[@"schema"] isKindOfClass:NSNumber.class] && [json[@"schema"] intValue] == 1 && matches(job, json[@"identity"]), "UNTRUSTED", "Engine job identity is missing or changed");
  require([json[@"ownerPid"] isKindOfClass:NSNumber.class] && [json[@"ownerPid"] longLongValue] > 1 && [json[@"ownerPid"] longLongValue] <= INT_MAX, "UNTRUSTED", "Engine job owner is invalid");
  owner = [json[@"ownerPid"] intValue]; return marker;
}
static bool engineJobName(const std::string &name) {
  NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:@"^job-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}-[a-zA-Z0-9]{6}$" options:0 error:nil];
  NSString *text = ns(name); return [pattern numberOfMatchesInString:text options:0 range:NSMakeRange(0, text.length)] == 1;
}
// Both passes stay descriptor-relative and refuse links, other volumes and
// unexpected objects. Preflight finishes before deleting any job content.
static void engineWalkJob(int directory, dev_t device, bool remove, size_t &count, size_t depth = 0, bool office = false, const std::string &prefix = "") {
  require(depth <= 64 && count <= 8192, "TOO_LARGE", "Engine cleanup tree exceeds its budget");
  FD copy(openat(directory, ".", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)); checked(copy.value, "open Engine cleanup stream");
  DIR *stream = fdopendir(copy.value); require(stream != nullptr, "IO", "Cannot inspect Engine cleanup directory"); copy.value = -1;
  try {
    while (auto item = readdir(stream)) {
      std::string name(item->d_name); if (name == "." || name == "..") continue;
      if (depth == 0 && name == engineMarkerName(office)) continue;
      require(++count <= 8192, "TOO_LARGE", "Engine cleanup contains too many objects");
      struct stat before; checked(fstatat(directory, name.c_str(), &before, AT_SYMLINK_NOFOLLOW), "stat Engine cleanup object");
      const bool renderPipe = office && prefix == "ipc" && S_ISSOCK(before.st_mode) && name.rfind("OSL_PIPE_", 0) == 0;
      require(before.st_dev == device && before.st_uid == geteuid() && (S_ISDIR(before.st_mode) || S_ISREG(before.st_mode) || renderPipe) && (S_ISDIR(before.st_mode) || before.st_nlink == 1), "UNTRUSTED", "Unknown Engine cleanup object retained");
      if (S_ISDIR(before.st_mode)) {
        FD child(openat(directory, name.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)); checked(child.value, "open Engine cleanup child");
        require(sameIdentity(before, info(child.value)), "CHANGED", "Engine cleanup child changed"); engineWalkJob(child.value, device, remove, count, depth + 1, office, prefix.empty() ? name : prefix + '/' + name);
      }
      if (remove) {
        struct stat current; checked(fstatat(directory, name.c_str(), &current, AT_SYMLINK_NOFOLLOW), "recheck Engine cleanup object");
        require(sameIdentity(before, current), "CHANGED", "Engine cleanup object changed"); checked(unlinkat(directory, name.c_str(), S_ISDIR(before.st_mode) ? AT_REMOVEDIR : 0), "remove Engine temporary object");
      }
    }
  } catch (...) { closedir(stream); throw; }
  closedir(stream);
}
static NSString *engineCleanJob(Root &root, const std::string &name, NSDictionary *expected, bool orphan, bool office) {
  require(engineJobName(name), "UNTRUSTED", "Unknown Engine workspace name retained");
  FD directory(openat(root.fd.value, name.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)); checked(directory.value, "open Engine cleanup job");
  auto job = info(directory.value);
  require(job.st_uid == geteuid() && (job.st_mode & 0777) == 0700 && (!expected || matches(job, expected)), "UNTRUSTED", "Engine workspace identity or permissions changed");
  pid_t owner; FD marker = engineJobMarker(directory.value, job, owner, office);
  if (orphan) { if (kill(owner, 0) == 0 || errno != ESRCH) return @"active"; }
  else require(owner == getppid(), "UNTRUSTED", "Engine job belongs to another application process");
  if (flock(marker.value, LOCK_EX | LOCK_NB) < 0) { if (errno == EWOULDBLOCK) return @"busy"; checked(-1, "lock Engine cleanup job"); }
  size_t count = 0; engineWalkJob(directory.value, job.st_dev, false, count, 0, office); root.verify();
  struct stat current; checked(fstatat(root.fd.value, name.c_str(), &current, AT_SYMLINK_NOFOLLOW), "recheck Engine cleanup job");
  require(sameIdentity(job, current), "CHANGED", "Engine job changed before cleanup");
  count = 0; engineWalkJob(directory.value, job.st_dev, true, count, 0, office); root.verify();
  checked(fstatat(root.fd.value, name.c_str(), &current, AT_SYMLINK_NOFOLLOW), "recheck emptied Engine job");
  require(sameIdentity(job, current), "CHANGED", "Engine job changed during cleanup");
  checked(fstatat(directory.value, engineMarkerName(office), &current, AT_SYMLINK_NOFOLLOW), "recheck Engine job marker");
  require(sameIdentity(info(marker.value), current), "CHANGED", "Engine job marker changed during cleanup");
  checked(unlinkat(directory.value, engineMarkerName(office), 0), "remove Engine job marker"); checked(unlinkat(root.fd.value, name.c_str(), AT_REMOVEDIR), "remove Engine job directory");
  return @"removed";
}
static NSDictionary *engineWorkspaceOperation(NSDictionary *request, bool orphan, bool office = false) {
  Root root(request[@"root"]); require(root.privateObjects && [[ns(root.path) lastPathComponent] isEqualToString:office ? @"m9-office-jobs" : @"m9-tex-jobs"], "UNTRUSTED", "Expected the private Engine workspace root");
  if (!orphan) {
    std::string path = str(request[@"job"][@"path"]), prefix = root.path + '/';
    require(path.rfind(prefix, 0) == 0 && path.find('/', prefix.size()) == std::string::npos, "UNTRUSTED", "Engine job is outside its private root");
    NSString *state = engineCleanJob(root, path.substr(prefix.size()), request[@"job"][@"identity"], false, office);
    require([state isEqualToString:@"removed"], "CONFLICT", "Engine compilation is still using its workspace"); return @{ @"state": state };
  }
  NSMutableArray *removed = [NSMutableArray array], *busy = [NSMutableArray array], *issues = [NSMutableArray array];
  FD copy(openat(root.fd.value, ".", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)); checked(copy.value, "open Engine recovery stream");
  DIR *stream = fdopendir(copy.value); require(stream != nullptr, "IO", "Cannot inspect Engine recovery root"); copy.value = -1;
  size_t count = 0;
  try {
    while (auto item = readdir(stream)) {
      std::string name(item->d_name); if (name == "." || name == "..") continue;
      require(++count <= 1024, "TOO_LARGE", "Engine recovery root exceeds 1024 entries");
      try { NSString *state = engineCleanJob(root, name, nil, true, office); if ([state isEqualToString:@"removed"]) [removed addObject:ns(name)]; else if ([state isEqualToString:@"busy"]) [busy addObject:ns(name)]; }
      catch (const Failure &error) { [issues addObject:@{ @"name": ns(name), @"message": ns(error.message) }]; }
    }
  } catch (...) { closedir(stream); throw; }
  closedir(stream); return @{ @"removed": removed, @"busy": busy, @"issues": issues };
}
