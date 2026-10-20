// Read-only identity probe for an explicitly supplied, host-owned process PID.
// No process enumeration, signals, command line or environment inspection.
#include <libproc.h>
#include <sys/proc.h>
#include <cerrno>
#include <climits>
#include <cstdio>
#include <cstdlib>
int main(int argc, char **argv) {
  char *end = nullptr; errno = 0;
  long requested = argc == 2 ? std::strtol(argv[1], &end, 10) : 0;
  if (argc != 2 || errno || !end || *end || requested < 1 || requested > INT_MAX) {
    std::puts("{\"schema\":1,\"state\":\"unknown\"}"); return 0;
  }
  proc_bsdinfo info = {}; errno = 0;
  int n = proc_pidinfo(static_cast<int>(requested), PROC_PIDTBSDINFO, 0, &info, sizeof(info));
  if (n != sizeof(info)) {
    std::puts(errno == ESRCH ? "{\"schema\":1,\"state\":\"stopped\"}" : "{\"schema\":1,\"state\":\"unknown\"}"); return 0;
  }
  if (info.pbi_pid != requested || info.pbi_start_tvsec == 0) {
    std::puts("{\"schema\":1,\"state\":\"unknown\"}"); return 0;
  }
  if (info.pbi_status == SZOMB) { std::puts("{\"schema\":1,\"state\":\"stopped\"}"); return 0; }
  std::printf("{\"schema\":1,\"state\":\"running\",\"pid\":%u,\"startedAt\":\"darwin-proc-v1:%llu:%llu\"}\n",info.pbi_pid,static_cast<unsigned long long>(info.pbi_start_tvsec),static_cast<unsigned long long>(info.pbi_start_tvusec));
  return 0;
}
