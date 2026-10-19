// WillYou's local file boundary. A short-lived, supervised process owns every
// directory descriptor. Renderer paths never become ambient filesystem access.
// macOS uses RENAME_SWAP and retains the displaced inode; there is NO rollback.
#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <ImageIO/ImageIO.h>
#import <CoreText/CoreText.h>
#include <CommonCrypto/CommonDigest.h>
#include <sys/stat.h>
#include <sys/mount.h>
#include <sys/acl.h>
#include <sys/xattr.h>
#include <copyfile.h>
#include <dirent.h>
#include <fcntl.h>
#include <unistd.h>
#include <signal.h>
#include <cerrno>
#include <cstring>
#include <string>
#include <vector>
#include <set>
#include <algorithm>
#include <cmath>

struct Failure { std::string code, message; };
static void emit(NSDictionary *value);
[[noreturn]] static void fail(const char *code, const std::string &message) { throw Failure{code, message}; }
static void require(bool value, const char *code, const char *message) { if (!value) fail(code, message); }
static void checked(int result, const char *operation) {
  if (result >= 0) return;
  const char *code = errno == ENOENT ? "MISSING" : errno == EACCES || errno == EPERM ? "PERMISSION" : errno == ELOOP ? "OUTSIDE_ROOT" : "IO";
  fail(code, std::string(operation) + ": " + strerror(errno));
}
struct FD {
  int value;
  explicit FD(int v = -1): value(v) {}
  ~FD() { if (value >= 0) close(value); }
  FD(const FD &) = delete;
  FD &operator=(const FD &) = delete;
  FD(FD &&other): value(other.value) { other.value = -1; }
  FD &operator=(FD &&other) { if (value >= 0) close(value); value = other.value; other.value = -1; return *this; }
};
static std::string str(id value) {
  require([value isKindOfClass:NSString.class], "INVALID_INPUT", "Expected a string");
  NSData *bytes = [value dataUsingEncoding:NSUTF8StringEncoding];
  require(bytes != nil, "INVALID_INPUT", "Invalid Unicode");
  std::string result((const char *)bytes.bytes, bytes.length);
  require(result.find('\0') == std::string::npos, "INVALID_INPUT", "NUL in path or identifier");
  return result;
}
static NSString *ns(const std::string &value) {
  NSString *result = [[NSString alloc] initWithBytes:value.data() length:value.size() encoding:NSUTF8StringEncoding];
  require(result != nil, "UNSUPPORTED", "File name is not valid UTF-8");
  return result;
}
static struct stat info(int fd) { struct stat s; checked(fstat(fd, &s), "fstat"); return s; }
static NSDictionary *identity(const struct stat &s) {
  return @{ @"device": [NSString stringWithFormat:@"%llu", (unsigned long long)s.st_dev], @"inode": [NSString stringWithFormat:@"%llu", (unsigned long long)s.st_ino] };
}
static bool sameIdentity(const struct stat &a, const struct stat &b) { return a.st_dev == b.st_dev && a.st_ino == b.st_ino; }
static bool matches(const struct stat &s, NSDictionary *expected) { return [identity(s) isEqual:expected]; }
static bool sameStamp(const struct stat &a, const struct stat &b) {
  return sameIdentity(a, b) && a.st_size == b.st_size && a.st_mtimespec.tv_sec == b.st_mtimespec.tv_sec && a.st_mtimespec.tv_nsec == b.st_mtimespec.tv_nsec && a.st_ctimespec.tv_sec == b.st_ctimespec.tv_sec && a.st_ctimespec.tv_nsec == b.st_ctimespec.tv_nsec;
}
static NSString *timeString(struct timespec t) { return [NSString stringWithFormat:@"%lld%09ld", (long long)t.tv_sec, t.tv_nsec]; }
static void regular(const struct stat &s, uint64_t limit) {
  require(S_ISREG(s.st_mode), "NOT_REGULAR", "Only regular files can be read");
  require(s.st_size >= 0 && (uint64_t)s.st_size <= limit, "TOO_LARGE", "File exceeds this operation's byte limit");
}
static void syncFile(int fd) {
  checked(fsync(fd), "fsync");
  // F_FULLFSYNC asks the local volume to flush its device cache. Some volumes
  // explicitly do not implement it; all other failures stop a pending commit.
  if (fcntl(fd, F_FULLFSYNC) < 0 && errno != EINVAL && errno != ENOTSUP) checked(-1, "full fsync");
}
static void writeAll(int fd, NSData *data) {
  const uint8_t *bytes = (const uint8_t *)data.bytes;
  for (size_t offset = 0; offset < data.length;) {
    ssize_t n = write(fd, bytes + offset, data.length - offset);
    if (n < 0 && errno == EINTR) continue;
    checked((int)n, "write"); require(n > 0, "IO", "Short write"); offset += n;
  }
}
static NSData *readBytes(int fd, uint64_t offset, uint64_t length, uint64_t limit) {
  struct stat before = info(fd); regular(before, limit);
  require(offset <= (uint64_t)before.st_size, "INVALID_INPUT", "Read offset is past end of file");
  length = std::min(length, (uint64_t)before.st_size - offset);
  NSMutableData *data = [NSMutableData dataWithLength:length];
  for (uint64_t done = 0; done < length;) {
    ssize_t n = pread(fd, (uint8_t *)data.mutableBytes + done, std::min<uint64_t>(1024 * 1024, length - done), offset + done);
    if (n < 0 && errno == EINTR) continue;
    checked((int)n, "pread"); require(n > 0, "CHANGED", "File shrank during read"); done += n;
  }
  require(sameStamp(before, info(fd)), "CHANGED", "File changed during read");
  return data;
}
static NSString *hashBytes(NSData *data) {
  unsigned char digest[CC_SHA256_DIGEST_LENGTH]; CC_SHA256(data.bytes, (CC_LONG)data.length, digest);
  char output[65]; for (int i = 0; i < 32; ++i) snprintf(output + i * 2, 3, "%02x", digest[i]); return @(output);
}
static NSString *hashFile(int fd, uint64_t limit) {
  struct stat before = info(fd); regular(before, limit);
  CC_SHA256_CTX ctx; CC_SHA256_Init(&ctx); unsigned char buffer[64 * 1024];
  for (off_t offset = 0; offset < before.st_size;) {
    ssize_t n = pread(fd, buffer, std::min<off_t>(sizeof(buffer), before.st_size - offset), offset);
    if (n < 0 && errno == EINTR) continue;
    checked((int)n, "hash read"); require(n > 0, "CHANGED", "File shrank during hashing"); CC_SHA256_Update(&ctx, buffer, (CC_LONG)n); offset += n;
  }
  require(sameStamp(before, info(fd)), "CHANGED", "File changed during hashing");
  unsigned char digest[32]; CC_SHA256_Final(digest, &ctx); char output[65];
  for (int i = 0; i < 32; ++i) snprintf(output + i * 2, 3, "%02x", digest[i]); return @(output);
}
static NSDictionary *revision(int fd, uint64_t limit) {
  struct stat before = info(fd); NSString *hash = hashFile(fd, limit);
  require(sameStamp(before, info(fd)), "CHANGED", "File changed during revision check");
  NSMutableDictionary *value = [identity(before) mutableCopy];
  [value addEntriesFromDictionary:@{ @"size": @(before.st_size), @"modifiedNs": timeString(before.st_mtimespec), @"changedNs": timeString(before.st_ctimespec), @"hash": hash }];
  return value;
}
static bool matchesRevisionMetadata(const struct stat &s, NSDictionary *value) {
  return [identity(s)[@"device"] isEqual:value[@"device"]] && [identity(s)[@"inode"] isEqual:value[@"inode"]] && s.st_size == [value[@"size"] longLongValue] && [timeString(s.st_mtimespec) isEqual:value[@"modifiedNs"]] && [timeString(s.st_ctimespec) isEqual:value[@"changedNs"]];
}
static std::vector<std::string> parts(const std::string &path, bool allowParent = false) {
  require(path.empty() || path.front() != '/', "OUTSIDE_ROOT", "Expected a relative path");
  std::vector<std::string> result;
  size_t offset = 0;
  while (offset < path.size()) {
    size_t end = path.find('/', offset); if (end == std::string::npos) end = path.size();
    std::string part = path.substr(offset, end - offset); offset = end + 1;
    if (part.empty() || part == ".") { require(allowParent, "INVALID_INPUT", "Empty path component"); continue; }
    if (part == "..") {
      require(allowParent && !result.empty(), "OUTSIDE_ROOT", "Path escapes its root"); result.pop_back();
    } else result.push_back(part);
  }
  return result;
}
static std::string joined(const std::vector<std::string> &items) {
  std::string output; for (const auto &item : items) { if (!output.empty()) output += '/'; output += item; } return output;
}
struct Root {
  std::string path, sourcePath; FD fd; struct stat initial; bool privateObjects;
  explicit Root(NSDictionary *input): path(str(input[@"path"])), sourcePath(input[@"sourcePath"] ? str(input[@"sourcePath"]) : path), fd(), privateObjects([input[@"privateObjects"] boolValue]) {
    require(!path.empty() && path.front() == '/' && path.rfind("//", 0) != 0, "UNTRUSTED", "Root must be an absolute local path");
    fd = FD(open(path.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC));
    checked(fd.value, "open root"); initial = info(fd.value);
    require(matches(initial, input[@"identity"]), "STALE_ROOT", "Root identity changed");
    require(!privateObjects || (initial.st_uid == geteuid() && (initial.st_mode & 0777) == 0700), "UNTRUSTED", "Recovery root permissions changed");
    struct statfs volume; checked(fstatfs(fd.value, &volume), "root volume");
    require(volume.f_flags & MNT_LOCAL, "UNSUPPORTED", "Remote filesystem roots are not supported");
    verify();
  }
  void verify() const {
    FD current(open(path.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC));
    require(current.value >= 0 && sameIdentity(initial, info(current.value)), "STALE_ROOT", "Root moved or was replaced");
    require(!sourcePath.empty() && sourcePath.front() == '/' && sourcePath.rfind("//", 0) != 0, "UNTRUSTED", "Root source must be local");
    FD source(open(sourcePath.c_str(), O_RDONLY | O_DIRECTORY | O_NONBLOCK | O_CLOEXEC));
    require(source.value >= 0 && sameIdentity(initial, info(source.value)), "STALE_ROOT", "Registered directory symlink changed");
  }
};
struct Opened { FD fd; FD parent; std::string leaf, relative; struct stat initial; };
static std::string canonicalRelative(const Root &root, int fd) {
  char path[PATH_MAX]; checked(fcntl(fd, F_GETPATH, path), "resolve open file path");
  std::string full(path), prefix = root.path == "/" ? "/" : root.path + '/';
  if (full == root.path) return "";
  require(full.rfind(prefix, 0) == 0, "OUTSIDE_ROOT", "Opened object moved outside its root");
  return full.substr(prefix.size());
}
// Resolve symlinks inside the root, then walk the resulting path again with
// O_NOFOLLOW. Every ancestor is held and revalidated before returning bytes.
static Opened openPath(const Root &root, const std::string &relative, bool directory = false, bool followLinks = true) {
  std::vector<std::string> components = parts(relative);
  for (unsigned links = 0; links <= 40; ++links) {
    FD parent(dup(root.fd.value)); checked(parent.value, "dup root"); bool restart = false;
    if (components.empty()) {
      require(directory, "NOT_REGULAR", "Root is a directory");
      FD handle(dup(parent.value)); checked(handle.value, "dup directory");
      return { std::move(handle), std::move(parent), "", "", root.initial };
    }
    for (size_t i = 0; i < components.size(); ++i) {
      const std::string &part = components[i]; struct stat s;
      checked(fstatat(parent.value, part.c_str(), &s, AT_SYMLINK_NOFOLLOW), "stat component");
      if (S_ISLNK(s.st_mode)) {
        require(followLinks, "OUTSIDE_ROOT", "Search does not follow symbolic links");
        require(!root.privateObjects, "UNTRUSTED", "Symlinks are forbidden in recovery storage");
        char buffer[32769]; ssize_t size = readlinkat(parent.value, part.c_str(), buffer, sizeof(buffer) - 1);
        checked((int)size, "read symlink"); require(size < (ssize_t)sizeof(buffer) - 1, "TOO_LARGE", "Symlink path is too long");
        std::string target(buffer, size), expanded;
        if (!target.empty() && target.front() == '/') {
          if (target == root.path) expanded = "";
          else { std::string prefix = root.path == "/" ? "/" : root.path + "/"; require(target.rfind(prefix, 0) == 0, "OUTSIDE_ROOT", "Symlink escapes its root"); expanded = target.substr(prefix.size()); }
        } else { std::vector<std::string> ancestors(components.begin(), components.begin() + i); expanded = joined(ancestors); if (!expanded.empty()) expanded += '/'; expanded += target; }
        for (size_t j = i + 1; j < components.size(); ++j) { expanded += '/'; expanded += components[j]; }
        components = parts(expanded, true); restart = true; break;
      }
      bool isDir = i + 1 < components.size() || directory;
      FD handle(openat(parent.value, part.c_str(), O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC | (isDir ? O_DIRECTORY : 0)));
      checked(handle.value, "open component");
      require(sameIdentity(s, info(handle.value)), "CHANGED", "Path changed during resolution");
      require(!root.privateObjects || (s.st_uid == geteuid() && (s.st_mode & 0777) == (S_ISDIR(s.st_mode) ? 0700 : 0600)), "UNTRUSTED", "Recovery object permissions changed");
      if (i + 1 == components.size()) {
        std::string canonical = canonicalRelative(root, handle.value);
        return { std::move(handle), std::move(parent), part, canonical, s };
      }
      parent = std::move(handle);
    }
    if (!restart) break;
  }
  fail("OUTSIDE_ROOT", "Too many symbolic links");
}
static void verifyPath(const Root &root, const Opened &opened, bool directory = false) {
  root.verify(); Opened current = openPath(root, opened.relative, directory);
  require(sameIdentity(info(opened.fd.value), info(current.fd.value)) && sameIdentity(info(opened.parent.value), info(current.parent.value)), "CHANGED", "File or parent moved during operation");
}
static bool protectedObject(const struct stat &s, NSArray *protectedIds) {
  for (NSDictionary *id in protectedIds) if (matches(s, id)) return true;
  return false;
}
static void checkProtected(const Root &root, const std::string &relative, NSArray *protectedIds, bool checkRootAncestors = true) {
  require(!protectedObject(root.initial, protectedIds), "INTERNAL_OBJECT", "Application recovery objects are private");
  // A user may have registered a root *inside* the private recovery subtree.
  // Match its real ancestors by identity too, never by a .willyou-* prefix.
  if (checkRootAncestors) {
    for (std::string ancestor = root.path; !ancestor.empty();) {
      FD dir(open(ancestor.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)); checked(dir.value, "check root ancestor");
      require(!protectedObject(info(dir.value), protectedIds), "INTERNAL_OBJECT", "Root is inside application recovery storage");
      if (ancestor == "/") break;
      auto slash = ancestor.rfind('/'); ancestor = slash == 0 ? "/" : ancestor.substr(0, slash);
    }
  }
  std::vector<std::string> path = parts(relative);
  for (size_t i = 1; i <= path.size(); ++i) {
    std::vector<std::string> prefix(path.begin(), path.begin() + i);
    Opened item = openPath(root, joined(prefix), i < path.size());
    require(!protectedObject(info(item.fd.value), protectedIds), "INTERNAL_OBJECT", "Application recovery objects are private");
  }
}
static void testPoint(NSString *phase, NSDictionary *request);
static NSDictionary *readOperation(NSDictionary *request) {
  Root root(request[@"root"]); std::string relative = str(request[@"relativePath"]), operation = str(request[@"operation"]);
  checkProtected(root, relative, request[@"protected"] ?: @[]);
  bool listing = operation == "list"; Opened item = openPath(root, relative, listing);
  if (listing) {
    // An alias may land below a protected canonical ancestor even when none
    // of its textual prefixes is itself protected. Validate the real parent.
    if (item.relative != relative) checkProtected(root, item.relative, request[@"protected"] ?: @[]);
    int copy = dup(item.fd.value); checked(copy, "dup list directory"); DIR *dir = fdopendir(copy);
    if (!dir) { close(copy); checked(-1, "fdopendir"); }
    NSMutableArray *entries = [NSMutableArray array];
    try {
      for (;;) {
        errno = 0; dirent *entry = readdir(dir); if (!entry) { checked(errno ? -1 : 0, "readdir"); break; }
        std::string name = entry->d_name; if (name == "." || name == "..") continue;
        std::string child = item.relative.empty() ? name : item.relative + '/' + name;
        struct stat linkInfo; if (fstatat(item.fd.value, name.c_str(), &linkInfo, AT_SYMLINK_NOFOLLOW) < 0) continue;
        if (protectedObject(linkInfo, request[@"protected"] ?: @[])) continue;
        NSString *entryName = [[NSString alloc] initWithBytes:name.data() length:name.size() encoding:NSUTF8StringEncoding];
        if (!entryName) continue; // Invalid byte names cannot be represented by the renderer's Unicode protocol.
        NSMutableDictionary *value = [@{ @"name": entryName, @"relativePath": ns(child), @"symbolicLink": @(S_ISLNK(linkInfo.st_mode)), @"size": @(linkInfo.st_size), @"identity": identity(linkInfo) } mutableCopy];
        try {
          Opened target = openPath(root, child); struct stat s = info(target.fd.value);
          // The root ancestry is checked at both ends of this whole list.
          // Keep every target's complete canonical prefix walk and fd checks;
          // do not repeat the identical absolute root-ancestor walk per child.
          checkProtected(root, target.relative, request[@"protected"] ?: @[], false);
          value[@"kind"] = S_ISDIR(s.st_mode) ? @"directory" : S_ISREG(s.st_mode) ? @"file" : @"unavailable";
          value[@"identity"] = identity(s); value[@"size"] = @(s.st_size);
        } catch (const Failure &e) {
          if (e.code == "INTERNAL_OBJECT") continue;
          value[@"kind"] = @"unavailable"; value[@"reason"] = ns(e.message);
        }
        [entries addObject:value];
        require(entries.count <= 100000, "TOO_LARGE", "Directory has more than 100000 entries");
      }
    } catch (...) { closedir(dir); throw; }
    closedir(dir); testPoint(@"list-entries-ready", request); verifyPath(root, item, true);
    checkProtected(root, item.relative, request[@"protected"] ?: @[]);
    return @{ @"entries": entries, @"identity": identity(info(item.fd.value)), @"relativePath": ns(item.relative) };
  }
  if (request[@"expectedParentIdentity"]) require(matches(info(item.parent.value), request[@"expectedParentIdentity"]), "UNTRUSTED", "Recovery material directory changed");
  constexpr uint64_t assetLimit = 256ull * 1024 * 1024;
  uint64_t resourceLimit = request[@"resourceLimit"] ? [request[@"resourceLimit"] unsignedLongLongValue] : assetLimit;
  require(resourceLimit > 0 && resourceLimit <= assetLimit, "TOO_LARGE", "Invalid resource budget");
  if (operation == "chunk") regular(info(item.fd.value), resourceLimit);
  if (operation == "metadata") {
    struct stat s = info(item.fd.value); require(S_ISREG(s.st_mode), "NOT_REGULAR", "Expected a regular file");
    verifyPath(root, item);
    return @{ @"identity": identity(s), @"size": @(s.st_size), @"modifiedNs": ns(std::to_string((int64_t)s.st_mtimespec.tv_sec * 1000000000ll + s.st_mtimespec.tv_nsec)), @"changedNs": ns(std::to_string((int64_t)s.st_ctimespec.tv_sec * 1000000000ll + s.st_ctimespec.tv_nsec)) };
  }
  if (operation == "read") regular(info(item.fd.value), request[@"byteLimit"] ? [request[@"byteLimit"] unsignedLongLongValue] : 20ull * 1024 * 1024);
  bool cachedChunk = operation == "chunk" && [request[@"expectedRevision"] isKindOfClass:NSDictionary.class];
  if (cachedChunk) require(matchesRevisionMetadata(info(item.fd.value), request[@"expectedRevision"]), "CHANGED", "Resource revision changed");
  NSDictionary *rev = cachedChunk ? request[@"expectedRevision"] : revision(item.fd.value, assetLimit);
  NSMutableDictionary *result = [@{ @"revision": rev, @"relativePath": ns(item.relative), @"writable": @((info(item.fd.value).st_mode & 0222) != 0 && faccessat(item.parent.value, item.leaf.c_str(), W_OK, 0) == 0) } mutableCopy];
  if (operation == "stat") {
    NSData *sample = readBytes(item.fd.value, 0, 4096, assetLimit);
    require(matchesRevisionMetadata(info(item.fd.value), rev), "CHANGED", "File changed during type sampling");
    result[@"sampleBase64"] = [sample base64EncodedStringWithOptions:0];
  }
  if (operation == "read" || operation == "chunk") {
    bool chunk = operation == "chunk";
    uint64_t readLimit = request[@"byteLimit"] ? [request[@"byteLimit"] unsignedLongLongValue] : 20ull * 1024 * 1024;
    require(readLimit <= 20ull * 1024 * 1024, "TOO_LARGE", "Read budget exceeds text limit");
    uint64_t length = chunk ? [request[@"length"] unsignedLongLongValue] : readLimit;
    uint64_t offset = chunk ? [request[@"offset"] unsignedLongLongValue] : 0;
    require(!chunk || length <= 1024 * 1024, "TOO_LARGE", "Resource chunk exceeds 1 MiB");
    if (request[@"expectedHash"]) require([rev[@"hash"] isEqual:request[@"expectedHash"]], "CHANGED", "Resource revision changed");
    NSData *bytes = readBytes(item.fd.value, offset, length, chunk ? resourceLimit : readLimit);
    require(cachedChunk ? matchesRevisionMetadata(info(item.fd.value), rev) : [revision(item.fd.value, assetLimit) isEqual:rev], "CHANGED", "File changed during read");
    result[@"base64"] = [bytes base64EncodedStringWithOptions:0];
  }
  verifyPath(root, item); return result;
}
static bool searchExcluded(const std::string &path) {
  static const std::set<std::string> excluded = { ".git", ".hg", ".next", ".pnpm-store", ".svn", ".turbo", ".yarn", "build", "coverage", "dist", "node_modules" };
  for (const auto &part : parts(path)) if (excluded.count(part)) return true;
  return false;
}
static void searchIssue(NSMutableArray *issues, NSUInteger &count, NSString *path, const std::string &reason) {
  count++; if (issues.count < 100) [issues addObject:@{ @"path": path, @"reason": ns(reason) }];
}
static NSDictionary *walkOperation(NSDictionary *request) {
  Root root(request[@"root"]); NSArray *protectedIds = request[@"protected"] ?: @[];
  checkProtected(root, "", protectedIds);
  std::vector<std::string> pending = { "" }; NSMutableArray *files = [NSMutableArray array], *issues = [NSMutableArray array];
  NSUInteger skipped = 0, visited = 0;
  while (!pending.empty()) {
    std::string relative = pending.back(); pending.pop_back();
    @autoreleasepool { try {
      checkProtected(root, relative, protectedIds);
      Opened directory = openPath(root, relative, true, false);
      int copy = dup(directory.fd.value); checked(copy, "dup search directory"); DIR *dir = fdopendir(copy);
      if (!dir) { close(copy); checked(-1, "fdopendir search"); }
      try {
        for (;;) {
          errno = 0; dirent *entry = readdir(dir); if (!entry) { checked(errno ? -1 : 0, "readdir search"); break; }
          std::string name = entry->d_name; if (name == "." || name == "..") continue;
          std::string child = relative.empty() ? name : relative + '/' + name;
          if (searchExcluded(child)) continue;
          NSString *path = [[NSString alloc] initWithBytes:child.data() length:child.size() encoding:NSUTF8StringEncoding];
          if (!path) { searchIssue(issues, skipped, ns(relative), "File name is not valid UTF-8"); continue; }
          struct stat s;
          if (fstatat(directory.fd.value, name.c_str(), &s, AT_SYMLINK_NOFOLLOW) < 0) { searchIssue(issues, skipped, path, strerror(errno)); continue; }
          if (protectedObject(s, protectedIds)) continue;
          if (S_ISLNK(s.st_mode)) continue; // Search never recursively follows aliases.
          require(++visited <= 200000, "TOO_LARGE", "Search enumeration exceeds 200000 entries");
          if (S_ISDIR(s.st_mode)) {
            if (parts(child).size() >= 256) { searchIssue(issues, skipped, path, "Search directory depth exceeds 255"); continue; }
            pending.push_back(child);
          } else if (S_ISREG(s.st_mode)) [files addObject:path];
          else searchIssue(issues, skipped, path, "Not a regular file");
        }
      } catch (...) { closedir(dir); throw; }
      closedir(dir); verifyPath(root, directory, true);
    } catch (const Failure &error) {
      if (relative.empty() || error.code == "TOO_LARGE" || error.code == "STALE_ROOT") throw;
      searchIssue(issues, skipped, ns(relative), error.message);
    } }
  }
  root.verify(); return @{ @"paths": files, @"skipped": @(skipped), @"issues": issues };
}
static NSDictionary *searchOperation(NSDictionary *request) {
  Root root(request[@"root"]); NSArray *protectedIds = request[@"protected"] ?: @[], *paths = request[@"paths"];
  NSString *query = request[@"query"];
  require([paths isKindOfClass:NSArray.class] && paths.count <= 200000 && [query isKindOfClass:NSString.class] && query.length > 0 && query.length <= 256 && [query rangeOfCharacterFromSet:NSCharacterSet.newlineCharacterSet].location == NSNotFound, "INVALID_INPUT", "Invalid literal search input");
  NSMutableArray *rows = [NSMutableArray array], *issues = [NSMutableArray array]; NSUInteger skipped = 0, searched = 0;
  for (NSString *path in paths) {
    @autoreleasepool { try {
      std::string relative = str(path); require(!relative.empty() && !searchExcluded(relative), "UNTRUSTED", "Search path is excluded");
      checkProtected(root, relative, protectedIds);
      // Refuse a path that became a symlink after enumeration, including any
      // parent component. Ordinary explicit file opening still permits aliases.
      Opened file = openPath(root, relative, false, false); struct stat before = info(file.fd.value);
      NSData *bytes = readBytes(file.fd.value, 0, 20ull * 1024 * 1024, 20ull * 1024 * 1024);
      NSString *text = [[NSString alloc] initWithData:bytes encoding:NSUTF8StringEncoding];
      require(text != nil, "UNSUPPORTED", "Invalid UTF-8 text");
      require(memchr(bytes.bytes, 0, bytes.length) == nullptr, "UNSUPPORTED", "Binary data is not searched");
      if (text.length && [text characterAtIndex:0] == 0xfeff) text = [text substringFromIndex:1];
      NSMutableDictionary *rev = [identity(before) mutableCopy];
      [rev addEntriesFromDictionary:@{ @"size": @(before.st_size), @"modifiedNs": timeString(before.st_mtimespec), @"changedNs": timeString(before.st_ctimespec), @"hash": hashBytes(bytes) }];
      verifyPath(root, file); require(sameStamp(before, info(file.fd.value)), "CHANGED", "Search file changed while reading"); searched++;
      NSUInteger start = 0, line = 1;
      while (start < text.length) {
        NSUInteger end = start; while (end < text.length && [text characterAtIndex:end] != '\n' && [text characterAtIndex:end] != '\r') end++;
        NSRange found = [text rangeOfString:query options:NSLiteralSearch range:NSMakeRange(start, end - start)];
        if (found.location != NSNotFound) {
          // A real extra matching line is a sentinel, never a streamed row.
          if (rows.count >= 100) { root.verify(); return @{ @"rows": rows, @"limited": @YES, @"searched": @(searched), @"skipped": @(skipped), @"issues": issues }; }
          NSString *snippet = [text substringWithRange:NSMakeRange(start, end - start)];
          require([snippet lengthOfBytesUsingEncoding:NSUTF8StringEncoding] < 2 * 1024 * 1024 - 4096, "TOO_LARGE", "Search result line exceeds 2 MiB protocol budget");
          NSMutableArray *ranges = [NSMutableArray array];
          while (found.location != NSNotFound && ranges.count < 1000) {
            [ranges addObject:@{ @"from": @(found.location - start), @"to": @(NSMaxRange(found) - start) }];
            NSUInteger next = NSMaxRange(found); found = [text rangeOfString:query options:NSLiteralSearch range:NSMakeRange(next, end - next)];
          }
          NSDictionary *row = @{ @"relativePath": path, @"revision": rev, @"line": @(line), @"rawOffset": @(start), @"text": snippet, @"ranges": ranges, @"rangesTruncated": @(found.location != NSNotFound) };
          [rows addObject:row]; emit(@{ @"event": @"search-row", @"row": row });
        }
        if (end < text.length && [text characterAtIndex:end] == '\r' && end + 1 < text.length && [text characterAtIndex:end + 1] == '\n') end++;
        start = end + 1; line++;
      }
    } catch (const Failure &error) {
      if (error.code == "STALE_ROOT" || error.code == "TOO_LARGE" && error.message.find("protocol") != std::string::npos) throw;
      searchIssue(issues, skipped, path, error.message);
    } }
  }
  root.verify(); return @{ @"rows": rows, @"limited": @NO, @"searched": @(searched), @"skipped": @(skipped), @"issues": issues };
}
static bool internalId(const std::string &value) {
  return !value.empty() && value.size() <= 128 && std::all_of(value.begin(), value.end(), [](unsigned char c) { return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-'; });
}
static FD privateDirectory(int parent, const std::string &name, bool exclusive) {
  require(internalId(name), "INVALID_INPUT", "Invalid internal directory identifier");
  int created = mkdirat(parent, name.c_str(), 0700);
  if (created < 0 && (exclusive || errno != EEXIST)) checked(-1, "mkdir recovery directory");
  FD fd(openat(parent, name.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)); checked(fd.value, "open recovery directory");
  struct stat s = info(fd.value); require(s.st_uid == geteuid() && (s.st_mode & 0777) == 0700, "UNTRUSTED", "Recovery directory owner or mode changed");
  checked(fsync(parent), "sync parent directory"); return fd;
}
static FD newFile(int parent, const char *name, NSData *data) {
  FD fd(openat(parent, name, O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC, 0600)); checked(fd.value, "create private file");
  writeAll(fd.value, data); syncFile(fd.value); return fd;
}
static void writeJournal(int directory, NSDictionary *record) {
  NSError *error = nil; NSData *data = [NSJSONSerialization dataWithJSONObject:record options:NSJSONWritingSortedKeys error:&error];
  require(data != nil && data.length <= 64 * 1024, "IO", "Recovery journal is not serializable or exceeds its budget");
  std::string leaf = "journal-" + str(NSUUID.UUID.UUIDString.lowercaseString);
  FD fd = newFile(directory, leaf.c_str(), data);
  checked(renameat(directory, leaf.c_str(), directory, "journal.json"), "install journal"); checked(fsync(directory), "sync journal directory");
}
static void emit(NSDictionary *message) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:message options:0 error:nil];
  writeAll(STDOUT_FILENO, data); writeAll(STDOUT_FILENO, [@"\n" dataUsingEncoding:NSUTF8StringEncoding]);
}
static void testPoint(NSString *phase, NSDictionary *request) {
#ifdef WILLYOU_FILE_BROKER_TEST
  if ([request[@"testStopAt"] isEqual:phase]) { emit(@{ @"event": @"test-stop", @"phase": phase }); raise(SIGSTOP); }
  if ([request[@"testFailAt"] isEqual:phase]) fail("IO", "Injected I/O failure");
#endif
}
static NSDictionary *xattrs(int fd) {
  ssize_t size = flistxattr(fd, nullptr, 0, 0); checked((int)size, "list metadata");
  require(size <= 1024 * 1024, "TOO_LARGE", "Metadata name list is too large");
  std::vector<char> names(size); if (size) checked((int)flistxattr(fd, names.data(), names.size(), 0), "read metadata names");
  NSMutableDictionary *values = [NSMutableDictionary dictionary];
  for (size_t at = 0; at < names.size();) {
    size_t end = at; while (end < names.size() && names[end]) ++end;
    require(end < names.size(), "CHANGED", "Metadata list changed"); std::string name(names.data() + at, end - at); at = end + 1;
    ssize_t length = fgetxattr(fd, name.c_str(), nullptr, 0, 0, 0); checked((int)length, "size metadata");
    require(length <= 64 * 1024 * 1024, "TOO_LARGE", "Metadata value is too large to verify safely");
    NSMutableData *data = [NSMutableData dataWithLength:length];
    ssize_t actual = fgetxattr(fd, name.c_str(), data.mutableBytes, data.length, 0, 0); checked((int)actual, "read metadata");
    require(actual == length, "CHANGED", "Metadata changed"); values[ns(name)] = hashBytes(data);
  }
  return values;
}
static NSString *aclText(int fd) {
  acl_t acl = acl_get_fd_np(fd, ACL_TYPE_EXTENDED);
  if (!acl) { if (errno == ENOENT) return @""; checked(-1, "read ACL"); }
  ssize_t length = 0; char *text = acl_to_text(acl, &length);
  if (!text) { acl_free(acl); checked(-1, "serialize ACL"); }
  NSString *result = [[NSString alloc] initWithBytes:text length:length encoding:NSUTF8StringEncoding]; acl_free(text); acl_free(acl);
  return result ?: @"";
}
static void copyMetadata(int source, int candidate) {
  struct stat before = info(source); NSDictionary *attributes = xattrs(source); NSString *acl = aclText(source);
  checked(fcopyfile(source, candidate, nullptr, COPYFILE_METADATA), "preserve metadata");
  struct stat after = info(candidate);
  require((before.st_mode & 07777) == (after.st_mode & 07777) && before.st_uid == after.st_uid && before.st_gid == after.st_gid && before.st_flags == after.st_flags, "IO", "Permission, ownership or flags could not be preserved");
  require([attributes isEqual:xattrs(candidate)] && [acl isEqual:aclText(candidate)], "IO", "Extended metadata or ACL could not be preserved");
  require(sameStamp(before, info(source)) && [attributes isEqual:xattrs(source)], "CHANGED", "Source metadata changed during preparation");
  struct timespec times[2] = { {0, UTIME_OMIT}, {0, UTIME_NOW} }; checked(futimens(candidate, times), "set saved mtime"); syncFile(candidate);
}
static void checkSpace(int fd, uint64_t bytes) {
  struct statfs volume; checked(fstatfs(fd, &volume), "check free space");
  require((uint64_t)volume.f_bavail * volume.f_bsize >= bytes + 64 * 1024, "QUOTA", "Insufficient free space for recovery materials");
}
static NSDictionary *loadJournal(const Root &recovery, const std::string &project, const std::string &recordId) {
  Opened file = openPath(recovery, project + '/' + recordId + "/journal.json");
  NSData *data = readBytes(file.fd.value, 0, 64 * 1024, 64 * 1024);
  id record = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  require([record isKindOfClass:NSDictionary.class] && [record[@"opId"] isEqual:ns(recordId)], "UNTRUSTED", "Invalid recovery journal");
  verifyPath(recovery, file); return record;
}
static uint64_t checkpointLimit(NSDictionary *record) {
  NSString *encoding = record[@"encoding"] ?: @"utf-8";
  require([encoding isEqual:@"utf-8"] || [encoding isEqual:@"ooxml-draft"], "INVALID_INPUT", "Unknown draft encoding");
  return [encoding isEqual:@"ooxml-draft"] ? 41ull * 1024 * 1024 : 20ull * 1024 * 1024;
}
static NSDictionary *checkpointOperation(NSDictionary *request) {
  Root recovery(request[@"recoveryRoot"]); recovery.privateObjects = true;
  require(recovery.initial.st_uid == geteuid() && (recovery.initial.st_mode & 0777) == 0700, "UNTRUSTED", "Recovery root permissions changed");
  std::string project = str(request[@"projectKey"]), draftId = str(request[@"draftId"]), relative = str(request[@"relativePath"]);
  require(internalId(project) && internalId(draftId) && !parts(relative).empty(), "INVALID_INPUT", "Invalid draft reference");
  NSData *bytes = [[NSData alloc] initWithBase64EncodedString:request[@"base64"] options:0];
  require(bytes != nil && bytes.length <= checkpointLimit(request), "TOO_LARGE", "Draft exceeds its format budget");
  NSString *hash = hashBytes(bytes);
  NSDictionary *previous = nil;
  try { previous = loadJournal(recovery, project, draftId); }
  catch (const Failure &e) { if (e.code != "MISSING") throw; }
  if (previous) {
    require([previous[@"kind"] isEqual:@"checkpoint"] && [previous[@"fingerprint"] isEqual:request[@"fingerprint"]], "IDEMPOTENCY", "Draft id belongs to another document");
    require([previous[@"bufferVersion"] longLongValue] <= [request[@"bufferVersion"] longLongValue], "CHANGED", "A newer draft is already durable");
    if ([previous[@"bufferVersion"] isEqual:request[@"bufferVersion"]]) {
      require([previous[@"draftHash"] isEqual:hash] && [previous[@"baseHash"] isEqual:request[@"baseHash"]] && checkpointLimit(previous) == checkpointLimit(request), "IDEMPOTENCY", "Draft version was reused with different content");
      require([previous[@"state"] isEqual:@"dirty"] || [previous[@"state"] isEqual:@"resolved"], "IO", "Previous checkpoint has not been confirmed durable");
      std::string priorLeaf = str(previous[@"draftLeaf"]); require(internalId(priorLeaf), "UNTRUSTED", "Invalid draft leaf");
      Opened prior = openPath(recovery, project + '/' + draftId + '/' + priorLeaf);
      require(matches(info(prior.fd.value), previous[@"draftIdentity"]) && [hashFile(prior.fd.value, checkpointLimit(previous)) isEqual:hash], "CONFLICT", "Previously recorded draft changed");
      return @{ @"draftId": ns(draftId), @"bufferVersion": previous[@"bufferVersion"], @"hash": previous[@"draftHash"] };
    }
  }
  checkSpace(recovery.fd.value, bytes.length + 64 * 1024);
  FD projectDir = privateDirectory(recovery.fd.value, project, false);
  FD recordDir = privateDirectory(projectDir.value, draftId, previous == nil);
  if (previous) require(matches(info(recordDir.value), previous[@"recordIdentity"]), "UNTRUSTED", "Draft record directory was replaced");
  std::string leaf = "draft-" + str(NSUUID.UUID.UUIDString.lowercaseString);
  NSMutableDictionary *record = [@{
    @"schemaVersion": @1, @"kind": @"checkpoint", @"opId": ns(draftId), @"projectKey": ns(project), @"fingerprint": request[@"fingerprint"], @"root": request[@"root"], @"relativePath": ns(relative), @"source": request[@"source"],
    @"baseHash": request[@"baseHash"], @"draftHash": hash, @"bufferVersion": request[@"bufferVersion"], @"encoding": request[@"encoding"], @"bom": request[@"bom"], @"draftLeaf": ns(leaf), @"state": @"preparing", @"recordIdentity": identity(info(recordDir.value)),
    @"createdAt": previous[@"createdAt"] ?: @((long long)(NSDate.date.timeIntervalSince1970 * 1000)), @"updatedAt": @((long long)(NSDate.date.timeIntervalSince1970 * 1000)),
    @"bytes": @(std::max<uint64_t>([previous[@"bytes"] unsignedLongLongValue], bytes.length * 3 + 64 * 1024))
  } mutableCopy];
  if (!previous) writeJournal(recordDir.value, record);
  // A previous snapshot is immutable. If someone changed it, preserve all
  // versions and stop automatic draft cleanup instead of accepting that file.
  FD previousFile, obsoleteFile; NSDictionary *obsolete = previous[@"previousDraft"];
  if (previous) {
    std::string oldLeaf = str(previous[@"draftLeaf"]); require(internalId(oldLeaf), "UNTRUSTED", "Invalid draft leaf");
    previousFile = FD(openat(recordDir.value, oldLeaf.c_str(), O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)); checked(previousFile.value, "open previous draft");
    require(matches(info(previousFile.value), previous[@"draftIdentity"]) && [hashFile(previousFile.value, checkpointLimit(previous)) isEqual:previous[@"draftHash"]], "CONFLICT", "Previous draft changed");
    record[@"previousDraft"] = @{ @"leaf": previous[@"draftLeaf"], @"identity": previous[@"draftIdentity"], @"hash": previous[@"draftHash"] };
    if (obsolete) {
      std::string old = str(obsolete[@"leaf"]); require(internalId(old), "UNTRUSTED", "Invalid previous draft leaf");
      obsoleteFile = FD(openat(recordDir.value, old.c_str(), O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)); checked(obsoleteFile.value, "open superseded draft");
      require(matches(info(obsoleteFile.value), obsolete[@"identity"]) && [hashFile(obsoleteFile.value, 41ull * 1024 * 1024) isEqual:obsolete[@"hash"]], "CONFLICT", "Superseded draft changed; cleanup stopped");
    }
  }
  FD draft = newFile(recordDir.value, leaf.c_str(), bytes); record[@"draftIdentity"] = identity(info(draft.value));
  checked(fsync(recordDir.value), "sync draft directory");
  testPoint(@"checkpoint-written", request);
  record[@"state"] = @"dirty"; recovery.verify(); writeJournal(recordDir.value, record);
  testPoint(@"checkpoint-recorded", request);
  if (obsolete) {
    // Only a superseded checkpoint of this same buffer is eligible here.
    // Save/conflict/displaced history is never cleaned by this operation.
    std::string old = str(obsolete[@"leaf"]); struct stat current;
    if (fstatat(recordDir.value, old.c_str(), &current, AT_SYMLINK_NOFOLLOW) == 0 && sameIdentity(current, info(obsoleteFile.value)) && [hashFile(obsoleteFile.value, 41ull * 1024 * 1024) isEqual:obsolete[@"hash"]]) {
      checked(unlinkat(recordDir.value, old.c_str(), 0), "remove superseded checkpoint"); checked(fsync(recordDir.value), "sync checkpoint cleanup");
    }
  }
  return @{ @"draftId": ns(draftId), @"bufferVersion": request[@"bufferVersion"], @"hash": hash };
}
static NSDictionary *resolveCheckpoint(NSDictionary *request) {
  Root recovery(request[@"recoveryRoot"]); recovery.privateObjects = true;
  std::string project = str(request[@"projectKey"]), draftId = str(request[@"draftId"]);
  require(internalId(project) && internalId(draftId), "INVALID_INPUT", "Invalid draft reference");
  NSDictionary *old = loadJournal(recovery, project, draftId);
  require([old[@"kind"] isEqual:@"checkpoint"] && [old[@"fingerprint"] isEqual:request[@"fingerprint"]], "UNTRUSTED", "Draft reference does not match this document");
  if (![old[@"bufferVersion"] isEqual:request[@"bufferVersion"]] || ![old[@"draftHash"] isEqual:request[@"hash"]]) return @{ @"resolved": @NO };
  std::string leaf = str(old[@"draftLeaf"]); require(internalId(leaf), "UNTRUSTED", "Invalid draft leaf");
  Opened content = openPath(recovery, project + '/' + draftId + '/' + leaf);
  require(matches(info(content.fd.value), old[@"draftIdentity"]) && [hashFile(content.fd.value, checkpointLimit(old)) isEqual:old[@"draftHash"]], "CONFLICT", "Draft changed before acknowledgement");
  Opened directory = openPath(recovery, project + '/' + draftId, true);
  require(matches(info(directory.fd.value), old[@"recordIdentity"]), "UNTRUSTED", "Draft directory changed");
  NSMutableDictionary *record = [old mutableCopy]; record[@"state"] = @"resolved"; record[@"resolvedAt"] = @((long long)(NSDate.date.timeIntervalSince1970 * 1000));
  writeJournal(directory.fd.value, record); return @{ @"resolved": @YES };
}
static NSDictionary *saveOperation(NSDictionary *request) {
  constexpr uint64_t limit = 256ull * 1024 * 1024;
  Root root(request[@"root"]), recovery(request[@"recoveryRoot"]);
  std::string relative = str(request[@"relativePath"]), opId = str(request[@"opId"]), project = str(request[@"projectKey"]);
  require(internalId(opId) && internalId(project), "INVALID_INPUT", "Invalid recovery identifier");
  recovery.privateObjects = true;
  require(recovery.initial.st_uid == geteuid() && (recovery.initial.st_mode & 0777) == 0700, "UNTRUSTED", "Recovery root permissions changed");
  // A retry returns the old operation's receipt, even if an external writer has
  // since changed the target. Prepared/unknown operations are never reissued.
  try {
    Opened previous = openPath(recovery, project + '/' + opId + "/journal.json");
    NSData *data = readBytes(previous.fd.value, 0, 64 * 1024, 64 * 1024);
    id old = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    require([old isKindOfClass:NSDictionary.class] && [old[@"opId"] isEqual:request[@"opId"]], "UNTRUSTED", "Invalid existing recovery journal");
    require([old[@"fingerprint"] isEqual:request[@"fingerprint"]], "IDEMPOTENCY", "Operation id was already used with a different payload");
    verifyPath(recovery, previous);
    if ([old[@"receipt"] isKindOfClass:NSDictionary.class]) return old[@"receipt"];
    return @{ @"opId": ns(opId), @"bufferVersion": old[@"bufferVersion"] ?: @0, @"state": @"unknown", @"recoveryId": ns(opId), @"message": @"Existing operation requires recovery inspection" };
  } catch (const Failure &e) { if (e.code != "MISSING") throw; }
  bool swapped = false;
  std::string conflictKind;
  NSDictionary *receipt = nil;
  NSMutableDictionary *record = nil; FD recordDir;
  try {
  checkProtected(root, relative, request[@"protected"] ?: @[]);
  Opened target = openPath(root, relative, false, request[@"copySourceRoot"] == nil); NSDictionary *base = revision(target.fd.value, limit);
  // Copy carries expectedRevision for its source, and a separate destination
  // revision. Ordinary saves carry the main-process target preflight here.
  if (!request[@"copySourceRoot"] && request[@"expectedRevision"]) require([base isEqual:request[@"expectedRevision"]], "CONFLICT", "The file identity or revision changed after save preflight");
  if (request[@"copySourceRoot"]) require([base isEqual:request[@"expectedDestinationRevision"]], "CONFLICT", "The copy destination changed before preparation");
  checkProtected(root, target.relative, request[@"protected"] ?: @[]);
  require((info(target.fd.value).st_mode & 0222) != 0 && faccessat(target.parent.value, target.leaf.c_str(), W_OK, 0) == 0, "PERMISSION", "File is read-only");
  require([base[@"hash"] isEqual:request[@"baseHash"]], "CONFLICT", "The file changed on disk before save");
  NSData *bytes = [[NSData alloc] initWithBase64EncodedString:request[@"base64"] options:0];
  require(bytes != nil && bytes.length <= limit, "INVALID_INPUT", "Invalid or oversized save payload");
  NSString *draftHash = hashBytes(bytes);
  require([draftHash isEqual:request[@"draftHash"]], "INVALID_INPUT", "Save payload hash mismatch");
  checkSpace(recovery.fd.value, bytes.length + 64 * 1024); checkSpace(target.parent.value, bytes.length + 64 * 1024);
  FD projectDir = privateDirectory(recovery.fd.value, project, false);
  recordDir = privateDirectory(projectDir.value, opId, true);
  record = [@{
    @"schemaVersion": @1, @"opId": ns(opId), @"projectKey": ns(project), @"fingerprint": request[@"fingerprint"], @"root": request[@"root"], @"relativePath": ns(target.relative),
    @"source": request[@"source"], @"baseRevision": base, @"draftHash": draftHash, @"bufferVersion": request[@"bufferVersion"], @"draftLeaf": @"draft", @"state": @"preparing", @"createdAt": @((long long)(NSDate.date.timeIntervalSince1970 * 1000)),
    @"targetParentIdentity": identity(info(target.parent.value)), @"recordIdentity": identity(info(recordDir.value)), @"bytes": @(bytes.length + [base[@"size"] unsignedLongLongValue] + bytes.length + 64 * 1024)
  } mutableCopy];
  if (request[@"copySourceRoot"]) { record[@"kind"] = @"copy"; record[@"copySourceRoot"] = request[@"copySourceRoot"]; record[@"copySourcePath"] = request[@"copySourcePath"]; }
  writeJournal(recordDir.value, record);
  FD draft = newFile(recordDir.value, "draft", bytes); record[@"draftIdentity"] = identity(info(draft.value));
  std::string transaction = ".willyou-recovery-" + str(request[@"installationId"]) + "-" + opId;
  require(transaction.size() <= 240, "INVALID_INPUT", "Transaction name is too long");
  // mkdir is exclusive: a lookalike directory is never adopted or hidden.
  checked(mkdirat(target.parent.value, transaction.c_str(), 0700), "create volume transaction");
  FD transactionDir(openat(target.parent.value, transaction.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)); checked(transactionDir.value, "open volume transaction");
  struct stat transactionInfo = info(transactionDir.value);
  require(transactionInfo.st_uid == geteuid() && (transactionInfo.st_mode & 0777) == 0700 && transactionInfo.st_dev == info(target.parent.value).st_dev, "UNTRUSTED", "Transaction directory identity is invalid");
  record[@"transactionLeaf"] = ns(transaction); record[@"transactionIdentity"] = identity(transactionInfo); record[@"volumeId"] = identity(transactionInfo)[@"device"]; record[@"stagingLeaf"] = @"candidate";
  checked(fsync(target.parent.value), "sync transaction parent"); writeJournal(recordDir.value, record);
  emit(@{ @"event": @"transaction", @"identity": identity(transactionInfo), @"opId": ns(opId) });
  FD candidate = newFile(transactionDir.value, "candidate", bytes); copyMetadata(target.fd.value, candidate.value);
  // Retain this inode too: a concurrent editor may replace the newly saved
  // pathname after modifying it. A private hard link keeps those bytes visible.
  checked(linkat(transactionDir.value, "candidate", transactionDir.value, "materialized", 0), "retain materialized inode");
  record[@"materializedLeaf"] = @"materialized";
  record[@"candidateIdentity"] = identity(info(candidate.value)); record[@"candidateHash"] = hashFile(candidate.value, limit); record[@"state"] = @"prepared";
  checked(fsync(transactionDir.value), "sync candidate directory"); writeJournal(recordDir.value, record);
  testPoint(@"prepared", request);
    recovery.verify(); root.verify(); verifyPath(root, target);
    struct stat currentTransaction; checked(fstatat(target.parent.value, transaction.c_str(), &currentTransaction, AT_SYMLINK_NOFOLLOW), "verify transaction");
    require(sameIdentity(transactionInfo, currentTransaction), "CONFLICT", "Transaction directory changed");
    require([revision(target.fd.value, limit) isEqual:base], "CONFLICT", "The file changed during save preparation");
    require([hashFile(candidate.value, limit) isEqual:draftHash], "CONFLICT", "Prepared candidate changed");
    testPoint(@"before-swap", request);
    checked(renameatx_np(target.parent.value, target.leaf.c_str(), transactionDir.value, "candidate", RENAME_SWAP), "atomic exchange"); swapped = true;
    testPoint(@"swapped", request);
    checked(fsync(target.parent.value), "sync target parent"); checked(fsync(transactionDir.value), "sync displaced directory");
    root.verify(); recovery.verify(); Opened current = openPath(root, target.relative);
    require(sameIdentity(info(current.parent.value), info(target.parent.value)) && sameIdentity(info(current.fd.value), info(candidate.value)), "CONFLICT", "Target identity changed after exchange");
    FD displaced(openat(transactionDir.value, "candidate", O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)); checked(displaced.value, "open displaced file");
    require(sameIdentity(info(displaced.value), target.initial) && [hashFile(displaced.value, limit) isEqual:base[@"hash"]], "CONFLICT", "Displaced file contains a concurrent external edit");
    NSDictionary *saved = revision(current.fd.value, limit);
    if (![saved[@"hash"] isEqual:draftHash]) {
      conflictKind = "overwritten-after-commit";
      fail("CONFLICT", "Saved path changed after exchange");
    }
    receipt = @{ @"opId": ns(opId), @"bufferVersion": request[@"bufferVersion"], @"state": @"saved", @"revision": saved, @"recoveryId": ns(opId) };
    record[@"displacedIdentity"] = identity(info(displaced.value)); record[@"state"] = @"saved";
  } catch (const Failure &e) {
    // The candidate and displaced inode remain even when the visible file no
    // longer equals either. Replacing the target again would clobber a writer.
    NSString *state = e.code == "CONFLICT" || e.code == "CHANGED" ? @"conflict" : swapped ? @"unknown" : @"failed";
    NSMutableDictionary *failure = [@{ @"opId": ns(opId), @"bufferVersion": request[@"bufferVersion"], @"state": state, @"message": ns(e.message) } mutableCopy];
    if (!conflictKind.empty()) failure[@"kind"] = ns(conflictKind);
    if (swapped) failure[@"recoveryId"] = ns(opId);
    receipt = failure; record[@"state"] = state;
  }
  if (!record) return receipt;
  record[@"receipt"] = receipt; record[@"exchanged"] = @(swapped);
  try { writeJournal(recordDir.value, record); }
  catch (const Failure &e) { return @{ @"opId": ns(opId), @"bufferVersion": request[@"bufferVersion"], @"state": @"unknown", @"recoveryId": ns(opId), @"message": ns(e.message) }; }
  testPoint(@"recorded", request); return receipt;
}
static NSDictionary *inspectRoot(NSDictionary *request) {
  std::string input = str(request[@"path"]);
  require(!input.empty() && input.front() == '/' && input.rfind("//", 0) != 0, "UNTRUSTED", "Expected an absolute local root");
  char *canonical = realpath(input.c_str(), nullptr); if (!canonical) checked(-1, "resolve root");
  std::string path(canonical); free(canonical);
  FD fd(open(path.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)); checked(fd.value, "inspect root");
  NSDictionary *descriptor = @{ @"path": ns(path), @"identity": identity(info(fd.value)) }; Root validated(descriptor); validated.verify();
  if ([request[@"operation"] isEqual:@"initialize-recovery"]) {
    FD recovery = privateDirectory(validated.fd.value, "file-recovery", false);
    FD version = privateDirectory(recovery.value, "v1", false);
    return @{ @"path": ns(path + "/file-recovery/v1"), @"identity": identity(info(version.value)), @"parentIdentity": identity(info(recovery.value)) };
  }
  return descriptor;
}
// ImageIO creates a bounded thumbnail directly from compressed bytes. The
// renderer never asks an <img> to decode the original, potentially huge raster.
// No URL, filesystem path, project command or network input reaches this decoder.
static NSDictionary *rasterPreview(NSDictionary *request) {
  NSString *encoded = ns(str(request[@"base64"]));
  require(encoded.length <= ((40ull * 1024 * 1024 + 2) / 3) * 4, "TOO_LARGE", "Raster input exceeds 40 MiB");
  NSData *data = [[NSData alloc] initWithBase64EncodedString:encoded options:0];
  require(data != nil && data.length > 0 && data.length <= 40ull * 1024 * 1024, "INVALID_INPUT", "Invalid raster bytes");
  NSDictionary *options = @{ (id)kCGImageSourceShouldCache: @NO, (id)kCGImageSourceShouldCacheImmediately: @NO };
  CGImageSourceRef source = CGImageSourceCreateWithData((__bridge CFDataRef)data, (__bridge CFDictionaryRef)options);
  require(source != nullptr, "INVALID_INPUT", "Image cannot be decoded");
  @try {
    NSString *type = (__bridge NSString *)CGImageSourceGetType(source);
    NSString *expected = [request[@"mime"] isEqual:@"image/png"] ? @"public.png" : [request[@"mime"] isEqual:@"image/jpeg"] ? @"public.jpeg" : nil;
    require(expected != nil && [type isEqual:expected], "INVALID_INPUT", "Image MIME does not match its bytes");
    NSDictionary *properties = CFBridgingRelease(CGImageSourceCopyPropertiesAtIndex(source, 0, (__bridge CFDictionaryRef)options));
    double width = [properties[(id)kCGImagePropertyPixelWidth] doubleValue], height = [properties[(id)kCGImagePropertyPixelHeight] doubleValue];
    require(std::isfinite(width) && std::isfinite(height) && width > 0 && height > 0 && width <= 1e9 && height <= 1e9, "INVALID_INPUT", "Invalid image dimensions");
    const bool inspect = [request[@"operation"] isEqual:@"raster-inspect"];
    if (inspect) {
      require(data.length <= 20ull * 1024 * 1024 && width <= 8192 && height <= 8192 && width * height <= 16ull * 1024 * 1024, "TOO_LARGE", "Office image exceeds 20 MiB or 16 megapixels (maximum side 8192)");
      require(CGImageSourceGetCount(source) == 1, "UNSUPPORTED", "Animated or multi-image content is not supported for Office insertion");
      require(CGImageSourceGetStatus(source) == kCGImageStatusComplete && CGImageSourceGetStatusAtIndex(source, 0) == kCGImageStatusComplete, "INVALID_INPUT", "Image data is incomplete");
      NSNumber *orientation = properties[(id)kCGImagePropertyOrientation];
      require(orientation == nil || orientation.intValue == 1, "UNSUPPORTED", "Image orientation metadata is not yet supported for lossless Office insertion");
    }
    const double maxPixels = 4.0 * 1024 * 1024;
    double factor = std::min(1.0, std::min(std::sqrt(maxPixels / (width * height)), 4096.0 / std::max(width, height)));
    size_t side = std::max<size_t>(1, (size_t)std::floor(std::max(width, height) * factor));
    NSDictionary *thumbnailOptions = @{ (id)kCGImageSourceCreateThumbnailFromImageAlways: @YES, (id)kCGImageSourceCreateThumbnailWithTransform: @YES, (id)kCGImageSourceThumbnailMaxPixelSize: @(side), (id)kCGImageSourceShouldCache: @NO };
    CGImageRef thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, (__bridge CFDictionaryRef)thumbnailOptions);
    require(thumbnail != nullptr, "INVALID_INPUT", "Image thumbnail decoding failed");
    size_t outputWidth = CGImageGetWidth(thumbnail), outputHeight = CGImageGetHeight(thumbnail);
    if (!outputWidth || !outputHeight || outputWidth > 4096 || outputHeight > 4096 || outputWidth * outputHeight > maxPixels) { CGImageRelease(thumbnail); fail("TOO_LARGE", "Decoder exceeded the raster pixel budget"); }
    if (inspect) { CGImageRelease(thumbnail); return @{ @"width": @(width), @"height": @(height) }; }
    NSMutableData *png = [NSMutableData data];
    CGImageDestinationRef destination = CGImageDestinationCreateWithData((__bridge CFMutableDataRef)png, CFSTR("public.png"), 1, nullptr);
    if (!destination) { CGImageRelease(thumbnail); fail("IO", "Cannot encode raster preview"); }
    CGImageDestinationAddImage(destination, thumbnail, nullptr);
    bool written = CGImageDestinationFinalize(destination);
    CFRelease(destination); CGImageRelease(thumbnail);
    require(written && png.length <= 20ull * 1024 * 1024, "IO", "Raster preview encoding failed");
    return @{ @"base64": [png base64EncodedStringWithOptions:0], @"width": @(outputWidth), @"height": @(outputHeight), @"originalWidth": @(width), @"originalHeight": @(height), @"downscaled": @(factor < 1) };
  } @finally { CFRelease(source); }
}

#include "desktop-actions.inc.mm"
#include "git-metadata.inc.mm"
#include "engine-workspaces.inc.mm"
#include "tex-compile.inc.mm"
#include "office-calculate.inc.mm"
#include "office-render.inc.mm"
#include "office-measure.inc.mm"

int main() {
  @autoreleasepool {
    signal(SIGPIPE, SIG_IGN);
    @try { try {
      NSMutableData *input = [NSMutableData data]; char buffer[65536];
      for (;;) {
        ssize_t size = read(STDIN_FILENO, buffer, sizeof(buffer)); if (size < 0 && errno == EINTR) continue; checked((int)size, "read request"); if (!size) break;
        [input appendBytes:buffer length:size]; require(input.length <= 360ull * 1024 * 1024, "TOO_LARGE", "Request exceeds byte budget");
      }
      NSError *error = nil; id request = [NSJSONSerialization JSONObjectWithData:input options:0 error:&error];
      require([request isKindOfClass:NSDictionary.class], "INVALID_INPUT", "Request must be a JSON object");
      std::string operation = str(request[@"operation"]);
      if (operation == "office-measure") { emit(@{ @"result": officeMeasureOperation(request) }); return 0; }
      require(operation == "list" || operation == "stat" || operation == "metadata" || operation == "walk" || operation == "search" || operation == "read" || operation == "chunk" || operation == "save" || operation == "checkpoint" || operation == "resolve-checkpoint" || operation == "inspect-root" || operation == "initialize-recovery" || operation == "raster-preview" || operation == "raster-inspect" || operation == "applications" || operation == "open-external" || operation == "reveal" || operation == "inspect-copy-target" || operation == "copy" || operation == "git-status" || operation == "git-blame" || operation == "tex-compile" || operation == "tex-clean-job" || operation == "tex-recover-jobs" || operation == "office-calculate" || operation == "office-validate" || operation == "office-render" || operation == "office-clean-job" || operation == "office-recover-jobs", "INVALID_INPUT", "Unknown operation");
      if (operation == "tex-clean-job" || operation == "tex-recover-jobs") { emit(@{ @"result": engineWorkspaceOperation(request, operation == "tex-recover-jobs") }); return 0; }
      if (operation == "tex-compile") { emit(@{ @"result": texCompileOperation(request) }); return 0; }
      if (operation == "office-clean-job" || operation == "office-recover-jobs") { emit(@{ @"result": engineWorkspaceOperation(request, operation == "office-recover-jobs", true) }); return 0; }
      if (operation == "office-calculate" || operation == "office-validate") { emit(@{ @"result": officeCalculateOperation(request) }); return 0; }
      if (operation == "office-render") { emit(@{ @"result": officeRenderOperation(request) }); return 0; }
      NSDictionary *result = operation == "git-status" || operation == "git-blame" ? gitMetadataOperation(request) : operation == "applications" || operation == "open-external" || operation == "reveal" ? desktopOperation(request) : operation == "inspect-copy-target" ? inspectCopyTarget(request) : operation == "copy" ? copyOperation(request) : (operation == "raster-preview" || operation == "raster-inspect") ? rasterPreview(request) : operation == "walk" ? walkOperation(request) : operation == "search" ? searchOperation(request) : operation == "save" ? saveOperation(request) : operation == "checkpoint" ? checkpointOperation(request) : operation == "resolve-checkpoint" ? resolveCheckpoint(request) : operation == "inspect-root" || operation == "initialize-recovery" ? inspectRoot(request) : readOperation(request);
      emit(@{ @"result": result }); return 0;
    } catch (const Failure &e) { emit(@{ @"error": @{ @"code": ns(e.code), @"message": ns(e.message) } }); return 1; }
    catch (const std::exception &e) { emit(@{ @"error": @{ @"code": @"IO", @"message": @(e.what()) } }); return 1; }
    } @catch (NSException *exception) { emit(@{ @"error": @{ @"code": @"INVALID_INPUT", @"message": @"Malformed broker request" } }); return 1; }
  }
}
