#include <libproc.h>
#include <sys/proc_info.h>
#include <sys/wait.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <unistd.h>
#include <algorithm>
#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <stdexcept>
#include <string>
#include <vector>

// Research only: a match proves a current file reference. No match never proves exit.
static bool references(const std::string& path, pid_t child) {
  int minimum = proc_listpidspath(PROC_UID_ONLY, getuid(), path.c_str(), 0, nullptr, 0);
  if (minimum < 0) throw std::runtime_error("query-size");
  for (size_t capacity = std::max(65536, minimum + 65536); capacity <= 8 * 1024 * 1024; capacity *= 2) {
    std::vector<int> ids((capacity + sizeof(int) - 1) / sizeof(int));
    int bytes = proc_listpidspath(PROC_UID_ONLY, getuid(), path.c_str(), 0,
                                  ids.data(), static_cast<int>(ids.size() * sizeof(int)));
    if (bytes < 0 || bytes % sizeof(int) != 0) throw std::runtime_error("query-data");
    if (static_cast<size_t>(bytes) >= ids.size() * sizeof(int)) continue;
    return std::find(ids.begin(), ids.begin() + bytes / sizeof(int), child) !=
           ids.begin() + bytes / sizeof(int);
  }
  throw std::runtime_error("query-capacity");
}

static void receive(int fd, char expected) {
  pollfd event{fd, POLLIN, 0};
  int ready;
  do { ready = poll(&event, 1, 5000); } while (ready < 0 && errno == EINTR);
  char value = 0;
  if (ready <= 0 || read(fd, &value, 1) != 1 || value != expected)
    throw std::runtime_error("child-handshake");
}

int main() {
  char directory[] = "/private/tmp/m10-owner-file-probe-XXXXXX";
  if (!mkdtemp(directory)) return 2;
  const std::string path = std::string(directory) + "/private-marker";
  int file = open(path.c_str(), O_CREAT | O_EXCL | O_RDWR, 0600);
  if (file < 0) return 2;
  close(file);
  int control[2], receipt[2];
  if (pipe(control) || pipe(receipt)) return 2;
  const pid_t child = fork();
  if (child < 0) return 2;
  if (child == 0) {
    close(control[1]); close(receipt[0]);
    const int held = open(path.c_str(), O_RDONLY);
    if (held < 0 || write(receipt[1], "o", 1) != 1) _exit(3);
    pollfd event{control[0], POLLIN, 0};
    char command = 0;
    if (poll(&event, 1, 10000) <= 0 || read(control[0], &command, 1) != 1 || command != 'c') _exit(4);
    close(held);
    if (write(receipt[1], "c", 1) != 1) _exit(5);
    event.revents = 0;
    if (poll(&event, 1, 10000) <= 0) _exit(6);
    _exit(read(control[0], &command, 1) == 0 ? 0 : 7);
  }
  close(control[0]); close(receipt[1]);
  bool passed = false, childReaped = false;
  try {
    receive(receipt[0], 'o');
    const bool foundOpen = references(path, child);
    if (write(control[1], "c", 1) != 1) throw std::runtime_error("close-request");
    receive(receipt[0], 'c');
    const bool foundClosed = references(path, child);
    const bool stillAlive = kill(child, 0) == 0;
    close(control[1]); control[1] = -1;
    int status = 0;
    if (waitpid(child, &status, 0) != child) throw std::runtime_error("wait-own-child");
    childReaped = true;
    const bool cleanExit = WIFEXITED(status) && WEXITSTATUS(status) == 0;
    const bool foundExited = references(path, child);
    passed = foundOpen && !foundClosed && stillAlive && cleanExit && !foundExited;
    std::printf("{\"scope\":\"private-file-and-own-child-only\",\"foundWhileOpen\":%s,\"foundAfterCloseWhileAlive\":%s,\"childAliveAfterClose\":%s,\"ownChildCleanExit\":%s,\"foundAfterExit\":%s,\"passed\":%s,\"absenceProvesExit\":false}\n",
                foundOpen ? "true" : "false", foundClosed ? "true" : "false",
                stillAlive ? "true" : "false", cleanExit ? "true" : "false",
                foundExited ? "true" : "false", passed ? "true" : "false");
  } catch (const std::exception& error) {
    std::fprintf(stderr, "probe failed: %s errno=%d\n", error.what(), errno);
    // This PID is exclusively the child created by this invocation.
    if (!childReaped) { kill(child, SIGTERM); waitpid(child, nullptr, 0); }
  }
  if (control[1] >= 0) close(control[1]);
  close(receipt[0]); unlink(path.c_str()); rmdir(directory);
  return passed ? 0 : 1;
}
