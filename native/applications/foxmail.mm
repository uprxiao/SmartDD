// Fixed-query, short-lived macOS reader. Never opens Foxmail through a writable VFS.
#import <Foundation/Foundation.h>
#include <sqlite3.h>
#include <sys/stat.h>
#include <unistd.h>
#include <fcntl.h>
#include <string>
#include <vector>
#include <memory>
// Read-only snapshot VFS: SQLite rebuilds the WAL index in private heap memory.
// No SHM mappings/read marks are opened. A changed source invalidates the entire
// result below; this VFS is confined to this short-lived reader process.
struct ReadFile { sqlite3_file base; sqlite3_file *actual; };
static ReadFile *rf(sqlite3_file *p) { return reinterpret_cast<ReadFile *>(p); }
static int roClose(sqlite3_file *p) { auto f = rf(p); int r = f->actual->pMethods->xClose(f->actual); sqlite3_free(f->actual); return r; }
static int roRead(sqlite3_file *p, void *b, int n, sqlite3_int64 o) { auto f = rf(p); return f->actual->pMethods->xRead(f->actual,b,n,o); }
static int roWrite(sqlite3_file *, const void *, int, sqlite3_int64) { return SQLITE_READONLY; }
static int roTruncate(sqlite3_file *, sqlite3_int64) { return SQLITE_READONLY; }
static int roSync(sqlite3_file *, int) { return SQLITE_READONLY; }
static int roSize(sqlite3_file *p, sqlite3_int64 *n) { auto f = rf(p); return f->actual->pMethods->xFileSize(f->actual,n); }
static int roLock(sqlite3_file *p, int n) { auto f = rf(p); return f->actual->pMethods->xLock(f->actual,n); }
static int roUnlock(sqlite3_file *p, int n) { auto f = rf(p); return f->actual->pMethods->xUnlock(f->actual,n); }
static int roReserved(sqlite3_file *p, int *n) { auto f = rf(p); return f->actual->pMethods->xCheckReservedLock(f->actual,n); }
static int roControl(sqlite3_file *p, int op, void *arg) { auto f = rf(p); return f->actual->pMethods->xFileControl(f->actual,op,arg); }
static int roSector(sqlite3_file *p) { auto f = rf(p); return f->actual->pMethods->xSectorSize(f->actual); }
static int roDevice(sqlite3_file *p) { auto f = rf(p); return f->actual->pMethods->xDeviceCharacteristics(f->actual) & ~SQLITE_IOCAP_IMMUTABLE; }
static int roMap(sqlite3_file *, int, int, int, void volatile **out) { *out = nullptr; return SQLITE_READONLY_CANTINIT; }
// Heap WAL-index mode owns no shared index and SQLite does not require SHM locks.
static int roShmLock(sqlite3_file *, int, int, int) { return SQLITE_OK; }
static void roBarrier(sqlite3_file *) {}
static int roUnmap(sqlite3_file *, int) { return SQLITE_OK; }
static const sqlite3_io_methods roMethods = {2,roClose,roRead,roWrite,roTruncate,roSync,roSize,roLock,roUnlock,roReserved,roControl,roSector,roDevice,roMap,roShmLock,roBarrier,roUnmap,nullptr,nullptr};
static sqlite3_vfs *baseVfs;
static int roOpen(sqlite3_vfs *, const char *name, sqlite3_file *p, int flags, int *out) {
  if (!name || !(flags & SQLITE_OPEN_READONLY) || (flags & (SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_DELETEONCLOSE))) return SQLITE_READONLY;
  auto f = rf(p); f->actual = (sqlite3_file *)sqlite3_malloc(baseVfs->szOsFile); if (!f->actual) return SQLITE_NOMEM;
  memset(f->actual,0,baseVfs->szOsFile); int r = baseVfs->xOpen(baseVfs,name,f->actual,flags,out);
  if (r != SQLITE_OK) { sqlite3_free(f->actual); f->actual = nullptr; return r; } f->base.pMethods = &roMethods; return SQLITE_OK;
}
static int roDelete(sqlite3_vfs *, const char *, int) { return SQLITE_READONLY; }
static int roAccess(sqlite3_vfs *, const char *name, int flags, int *out) { return baseVfs->xAccess(baseVfs,name,flags,out); }
static int roPath(sqlite3_vfs *, const char *name, int n, char *out) { return baseVfs->xFullPathname(baseVfs,name,n,out); }
static void installReadVfs() {
  baseVfs = sqlite3_vfs_find(nullptr); static sqlite3_vfs vfs = *baseVfs;
  vfs.zName = "willyou-mail-readonly"; vfs.szOsFile = sizeof(ReadFile); vfs.xOpen = roOpen; vfs.xDelete = roDelete; vfs.xAccess = roAccess; vfs.xFullPathname = roPath;
  sqlite3_vfs_register(&vfs,0);
}

struct Failure { const char *code; const char *message; };
static void need(bool ok, const char *code, const char *message) { if (!ok) throw Failure{code, message}; }
struct Stamp { bool exists; struct stat s; };
static Stamp stamp(const std::string &path) {
  struct stat s{}; int r = lstat(path.c_str(), &s);
  if (r < 0 && errno == ENOENT) return {false, s};
  need(r == 0 && S_ISREG(s.st_mode), "SOURCE_UNAVAILABLE", "Mail database component is unavailable or not a regular file");
  return {true, s};
}
// Foxmail keeps a PERSIST-mode rollback journal: the file stays after every commit with an all-zero header, which SQLite
// itself treats as "not hot". Only a journal whose header carries data means a transaction is still in progress.
static bool journalHeaderClean(const std::string &path, off_t size) {
  if (size == 0) return true;
  int fd = open(path.c_str(), O_RDONLY | O_CLOEXEC);
  if (fd < 0) return false;
  unsigned char header[28] = {0}; ssize_t want = size < (off_t)sizeof(header) ? (ssize_t)size : (ssize_t)sizeof(header);
  ssize_t got = pread(fd, header, (size_t)want, 0); close(fd);
  if (got != want || size < (off_t)sizeof(header)) return false;
  for (size_t i = 0; i < sizeof(header); i++) if (header[i] != 0) return false;
  return true;
}
static bool same(Stamp a, Stamp b) {
  return a.exists == b.exists && (!a.exists || (a.s.st_dev == b.s.st_dev && a.s.st_ino == b.s.st_ino && a.s.st_size == b.s.st_size &&
    a.s.st_mtimespec.tv_sec == b.s.st_mtimespec.tv_sec && a.s.st_mtimespec.tv_nsec == b.s.st_mtimespec.tv_nsec &&
    a.s.st_ctimespec.tv_sec == b.s.st_ctimespec.tv_sec && a.s.st_ctimespec.tv_nsec == b.s.st_ctimespec.tv_nsec));
}
static NSString *text(sqlite3_stmt *stmt, int i) {
  if (sqlite3_column_type(stmt, i) == SQLITE_NULL) return nil;
  int length = sqlite3_column_bytes(stmt, i); need(length <= 65536, "INCOMPLETE_RESULT", "Mail metadata exceeds the per-field budget");
  const void *bytes = sqlite3_column_text(stmt, i);
  NSString *value = [[NSString alloc] initWithBytes:bytes length:length encoding:NSUTF8StringEncoding];
  need(value != nil, "UNSUPPORTED_FORMAT", "Mail metadata is not valid UTF-8"); return value;
}
static NSArray *query(sqlite3 *db, const char *sql, int maxRows) {
  sqlite3_stmt *raw = nullptr;
  need(sqlite3_prepare_v2(db, sql, -1, &raw, nullptr) == SQLITE_OK, "UNSUPPORTED_FORMAT", "Foxmail metadata schema is unsupported");
  std::unique_ptr<sqlite3_stmt, decltype(&sqlite3_finalize)> stmt(raw, sqlite3_finalize);
  NSMutableArray *rows = [NSMutableArray array]; int result;
  while ((result = sqlite3_step(raw)) == SQLITE_ROW) {
    need(rows.count < (NSUInteger)maxRows, "INCOMPLETE_RESULT", "Mail metadata exceeds the row budget");
    NSMutableDictionary *row = [NSMutableDictionary dictionary];
    for (int i = 0; i < sqlite3_column_count(raw); i++) {
      NSString *key = [NSString stringWithUTF8String:sqlite3_column_name(raw, i)]; row[key] = text(raw, i) ?: NSNull.null;
    }
    [rows addObject:row];
  }
  need(result == SQLITE_DONE, "SOURCE_UNAVAILABLE", "Mail metadata read did not complete"); return rows;
}
int main(int argc, const char **argv) { @autoreleasepool {
  NSDictionary *output;
  try {
    need(argc == 2, "INVALID_INPUT", "A single selected account database is required");
    NSString *path = [NSString stringWithUTF8String:argv[1]];
    need(path != nil && path.isAbsolutePath && [path.lastPathComponent isEqualToString:@"messages.db"], "INVALID_INPUT", "Invalid selected account database");
    std::string file(argv[1]); std::vector<std::string> parts = {file, file + "-wal", file + "-shm", file + "-journal"}; std::vector<Stamp> before;
    for (const auto &part: parts) before.push_back(stamp(part));
    need(before[0].exists && before[0].s.st_size > 0 && before[0].s.st_size <= 4096LL * 1024 * 1024, "SOURCE_UNAVAILABLE", "Mail database is absent or exceeds the read budget");
    need(!before[1].exists || before[1].s.st_size <= 64LL * 1024 * 1024, "INCOMPLETE_RESULT", "Mail WAL exceeds the read budget");
    need(!before[3].exists || journalHeaderClean(parts[3], before[3].s.st_size), "RESOURCE_BUSY", "Foxmail has an unfinished rollback journal");
    // The private WAL index includes committed WAL frames without source writes.
    // Every source component is checked again before returning the observed snapshot.
    installReadVfs();
    NSString *uri = [[[NSURL fileURLWithPath:path] absoluteString] stringByAppendingString:@"?mode=ro"];
    sqlite3 *raw = nullptr; int opened = sqlite3_open_v2(uri.UTF8String, &raw, SQLITE_OPEN_READONLY | SQLITE_OPEN_URI | SQLITE_OPEN_NOMUTEX, "willyou-mail-readonly");
    std::unique_ptr<sqlite3, decltype(&sqlite3_close)> db(raw, sqlite3_close);
    need(opened == SQLITE_OK && sqlite3_db_readonly(raw, "main") == 1, "SOURCE_UNAVAILABLE", "Cannot open selected mail database read-only");
    // The system SQLite build does not expose load-extension; no caller SQL is accepted.
    sqlite3_busy_timeout(raw, 1000);
    sqlite3_limit(raw, SQLITE_LIMIT_LENGTH, 1024 * 1024); sqlite3_limit(raw, SQLITE_LIMIT_SQL_LENGTH, 4096);
    need(sqlite3_exec(raw, "PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;", nullptr, nullptr, nullptr) == SQLITE_OK, "SOURCE_UNAVAILABLE", "Cannot restrict mail database reader");
    NSArray *schema = query(raw, "SELECT name, sql FROM sqlite_schema WHERE type='table' AND name IN ('mailinfo','attachmentinfo','mail_box_info') ORDER BY name", 3);
    NSArray *rows = query(raw, "SELECT CAST(mailid AS TEXT) AS id, subject, from_ AS sender, to_ AS recipients, messageid, CAST(date AS TEXT) AS sourceDate, CAST(mail_receivedate AS TEXT) AS receivedDate, CAST(fileexist AS TEXT) AS fileexist, CAST(attachment AS TEXT) AS attachmentCount FROM mailinfo ORDER BY mailid", 100000);
    db.reset();
    for (size_t i = 0; i < parts.size(); i++) need(same(before[i], stamp(parts[i])), "RESOURCE_STATE_CHANGED", "Foxmail changed while reading; retry after it settles");
    output = @{ @"schema": schema, @"rows": rows, @"databaseIdentity": [NSString stringWithFormat:@"%llu:%llu:%lld:%ld", (unsigned long long)before[0].s.st_dev, (unsigned long long)before[0].s.st_ino, (long long)before[0].s.st_birthtimespec.tv_sec, before[0].s.st_birthtimespec.tv_nsec] };
  } catch (const Failure &e) { output = @{ @"error": @{ @"code": @(e.code), @"message": @(e.message) } }; }
  NSData *bytes = [NSJSONSerialization dataWithJSONObject:output options:0 error:nil];
  if (!bytes || bytes.length > 32 * 1024 * 1024) bytes = [NSJSONSerialization dataWithJSONObject:@{ @"error": @{ @"code": @"INCOMPLETE_RESULT", @"message": @"Mail metadata exceeds the response budget" } } options:0 error:nil];
  const uint8_t *p = (const uint8_t *)bytes.bytes; size_t done = 0;
  while (done < bytes.length) { ssize_t n = write(STDOUT_FILENO, p + done, bytes.length - done); if (n <= 0) return 1; done += n; }
  return 0;
} }
