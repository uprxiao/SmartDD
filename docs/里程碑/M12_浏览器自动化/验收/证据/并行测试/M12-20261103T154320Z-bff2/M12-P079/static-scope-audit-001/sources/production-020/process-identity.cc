// Read-only identity probe for an explicit owned PID, or the kernel peer of an
// inherited host-owned Unix socket. Never enumerates processes, argv or env.
// Explicit restore-owned-directory mode anchors a private store and atomically
// moves its original owned directory only if the target does not exist.
#include <libproc.h>
#include <sys/proc.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/stat.h>
#include <fcntl.h>
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
static bool components(const std::string &path,std::vector<std::string> &parts,bool absolute) {
  if(path.empty() || (path.front()=='/')!=absolute)return false;
  size_t at=absolute?1:0;
  while(at<path.size()){const auto end=path.find('/',at);const auto part=path.substr(at,end==std::string::npos?end:end-at);if(part.empty()||part=="."||part=="..")return false;parts.push_back(part);if(end==std::string::npos)return true;at=end+1;}
  return false;
}
static int walk(int anchor,const std::vector<std::string> &parts,size_t count,bool owned,bool privateMode=true) {
  int fd=dup(anchor);if(fd<0)return -1;
  for(size_t n=0;n<count;n++){int next=openat(fd,parts[n].c_str(),O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);close(fd);fd=next;if(fd<0)return -1;struct stat st={};if(fstat(fd,&st)!=0 || (owned&&(st.st_uid!=getuid()||(st.st_mode&(privateMode?0077:0022))))){close(fd);return -1;}}
  return fd;
}
static bool numeric(const char *value,unsigned long long &out){if(!value||!*value)return false;for(const char*p=value;*p;p++)if(*p<'0'||*p>'9')return false;char*end=nullptr;errno=0;out=strtoull(value,&end,10);return !errno&&end&&!*end;}
static bool discovery_route(const std::vector<std::string> &skill,const std::vector<std::string> &trash){
  if(skill.size()!=3||skill[0]!=".agents"||skill[1]!="skills"||skill[2].rfind("smartdd-",0)!=0||skill[2].size()>128||trash.size()!=6||trash[0]!=".agents"||trash[1]!="smartdd-runtime"||trash[2]!="trash"||trash[3].size()!=36||trash[4].size()!=64||trash[5]!="payload")return false;
  for(char c:skill[2])if(!((c>='a'&&c<='z')||(c>='0'&&c<='9')||c=='-'))return false;
  for(char c:trash[3])if(!((c>='a'&&c<='f')||(c>='0'&&c<='9')||c=='-'))return false;
  for(char c:trash[4])if(!((c>='a'&&c<='f')||(c>='0'&&c<='9')))return false;
  return true;
}
static int restore_owned(int argc,char **argv,bool discovery=false){
  const auto failed=[](const char*error){std::printf("{\"schema\":1,\"restored\":false,\"error\":\"%s\"}\n",error);return 0;};
  if(argc!=9)return failed("OWNERSHIP");std::vector<std::string> root,from,to;unsigned long long rootDev=0,rootIno=0,dev=0,ino=0;
  if(!components(argv[2],root,true)||!components(argv[3],from,false)||!components(argv[4],to,false)||!numeric(argv[5],rootDev)||!numeric(argv[6],rootIno)||!numeric(argv[7],dev)||!numeric(argv[8],ino))return failed("OWNERSHIP");
  if(discovery&&!discovery_route(from,to)&&!discovery_route(to,from))return failed("OWNERSHIP");
  int slash=open("/",O_RDONLY|O_DIRECTORY|O_CLOEXEC),base=slash<0?-1:walk(slash,root,root.size(),false);if(slash>=0)close(slash);if(base<0)return failed("OWNERSHIP");
  struct stat rs={};if(fstat(base,&rs)!=0||rs.st_uid!=getuid()||(rs.st_mode&(discovery?0022:0077))||static_cast<unsigned long long>(rs.st_dev)!=rootDev||rs.st_ino!=rootIno){close(base);return failed("OWNERSHIP");}
  int src=walk(base,from,from.size()-1,true,!discovery),dst=walk(base,to,to.size()-1,true,!discovery);close(base);if(src<0||dst<0){if(src>=0)close(src);if(dst>=0)close(dst);return failed("OWNERSHIP");}
  struct stat ss={};if(fstatat(src,from.back().c_str(),&ss,AT_SYMLINK_NOFOLLOW)!=0||!S_ISDIR(ss.st_mode)||ss.st_uid!=getuid()||static_cast<unsigned long long>(ss.st_dev)!=dev||ss.st_ino!=ino){close(src);close(dst);return failed("OWNERSHIP");}
  int status=renameatx_np(src,from.back().c_str(),dst,to.back().c_str(),RENAME_EXCL),error=errno;
  if(status==0&&(fsync(src)!=0||fsync(dst)!=0)){status=-1;error=EIO;}close(src);close(dst);
  if(status!=0)return failed(error==EEXIST||error==ENOTEMPTY?"EEXIST":error==EXDEV?"EXDEV":"OWNERSHIP");std::puts("{\"schema\":1,\"restored\":true}");return 0;
}
int main(int argc, char **argv) {
  if(argc>=2&&std::strcmp(argv[1],"--restore-owned-directory")==0)return restore_owned(argc,argv);
  if(argc>=2&&std::strcmp(argv[1],"--move-discovery-directory")==0)return restore_owned(argc,argv,true);
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
