// Read-only identity probe for an explicit owned PID, or the kernel peer of an
// inherited host-owned Unix socket. Never enumerates processes, argv or env.
#include <libproc.h>
#include <sys/proc.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <cerrno>
#include <climits>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
static bool inspect(pid_t pid, proc_bsdinfo &info) {
  info = {}; errno = 0;
  return proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info)) == sizeof(info)
    && info.pbi_pid == static_cast<unsigned>(pid) && info.pbi_start_tvsec != 0 && info.pbi_status != SZOMB;
}
static bool same(const proc_bsdinfo &a,const proc_bsdinfo &b) {
  return a.pbi_pid==b.pbi_pid && a.pbi_ppid==b.pbi_ppid && a.pbi_start_tvsec==b.pbi_start_tvsec && a.pbi_start_tvusec==b.pbi_start_tvusec;
}
static void birth(const proc_bsdinfo &info) {
  std::printf("\"darwin-proc-v1:%llu:%llu\"",static_cast<unsigned long long>(info.pbi_start_tvsec),static_cast<unsigned long long>(info.pbi_start_tvusec));
}
static std::string escaped(const char *value) {
  std::string out="\"";
  for(const unsigned char *p=reinterpret_cast<const unsigned char *>(value);*p;p++) {
    if(*p=='"'||*p=='\\') {out+='\\';out+=static_cast<char>(*p);} else if(*p<32) {char code[7];std::snprintf(code,sizeof(code),"\\u%04x",*p);out+=code;} else out+=static_cast<char>(*p);
  }
  return out+'"';
}
static int peer(int fd) {
  const char *unknown="{\"schema\":2,\"state\":\"unknown\"}";
  pid_t pid=0; socklen_t length=sizeof(pid); uid_t uid=0;gid_t gid=0;
  if(getsockopt(fd,SOL_LOCAL,LOCAL_PEERPID,&pid,&length)!=0 || length!=sizeof(pid) || pid<=0
    || getpeereid(fd,&uid,&gid)!=0 || uid!=getuid()) {std::puts(unknown);return 0;}
  std::vector<proc_bsdinfo> chain;
  for(pid_t next=pid;next>0&&chain.size()<64;) {
    proc_bsdinfo info={}; if(!inspect(next,info))break;
    for(const auto &old:chain)if(old.pbi_pid==info.pbi_pid){std::puts(unknown);return 0;}
    chain.push_back(info);next=static_cast<pid_t>(info.pbi_ppid);
  }
  char image[PROC_PIDPATHINFO_MAXSIZE]={},again[PROC_PIDPATHINFO_MAXSIZE]={};
  if(chain.empty()||proc_pidpath(pid,image,sizeof(image))<=0){std::puts(unknown);return 0;}
  for(const auto &old:chain){proc_bsdinfo current={};if(!inspect(old.pbi_pid,current)||!same(old,current)){std::puts(unknown);return 0;}}
  pid_t last=0;length=sizeof(last);
  if(getsockopt(fd,SOL_LOCAL,LOCAL_PEERPID,&last,&length)!=0 || last!=pid || proc_pidpath(pid,again,sizeof(again))<=0 || std::strcmp(image,again)!=0){std::puts(unknown);return 0;}
  std::printf("{\"schema\":2,\"state\":\"running\",\"uid\":%u,\"peer\":{\"pid\":%u,\"startedAt\":",uid,chain.front().pbi_pid);birth(chain.front());
  std::printf(",\"executable\":%s},\"ancestors\":[",escaped(image).c_str());
  for(size_t i=0;i<chain.size();i++){const auto &info=chain[i];std::printf("%s{\"pid\":%u,\"ppid\":%u,\"startedAt\":",i?",":"",info.pbi_pid,info.pbi_ppid);birth(info);std::printf("}");}
  std::puts("]}");return 0;
}
int main(int argc, char **argv) {
  char *end = nullptr; errno = 0;
  if(argc==3 && std::strcmp(argv[1],"--peer-fd")==0) {
    long fd=std::strtol(argv[2],&end,10);
    if(errno||!end||*end||fd<3||fd>INT_MAX){std::puts("{\"schema\":2,\"state\":\"unknown\"}");return 0;}
    return peer(static_cast<int>(fd));
  }
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
  std::printf("{\"schema\":1,\"state\":\"running\",\"pid\":%u,\"startedAt\":",info.pbi_pid);birth(info);std::puts("}");
  return 0;
}
