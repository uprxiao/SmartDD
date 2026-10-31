/* Linux read-authority and private-bootstrap candidate. Not wired into the public platform dispatch.
 * C Node-API only (NAPI8); no V8 ABI, source writable open, caller fd or fs fallback.
 * openat2 semantics: https://man7.org/linux/man-pages/man2/openat2.2.html
 * Node-API: https://nodejs.org/api/n-api.html
 */
#define _GNU_SOURCE
#define NAPI_VERSION 8
#include <node_api.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <limits.h>
#include <linux/openat2.h>
#include <math.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/file.h>
#include <sys/statvfs.h>
#include <sys/statfs.h>
#include <sys/syscall.h>
#include <unistd.h>
#ifndef __linux__
#error This addon must be compiled and tested on the actual target Linux.
#endif

#define MAX_BYTES (256U * 1024U * 1024U)
#define MAX_READ (20U * 1024U * 1024U)
#define RESOLVE_SAFE (RESOLVE_BENEATH | RESOLVE_NO_MAGICLINKS | RESOLVE_NO_SYMLINKS | RESOLVE_NO_XDEV)
typedef struct state state;
typedef struct handle handle;
struct state { unsigned refs; handle *head; };
struct handle {
  state *owner; handle *next; int fd; bool root, private_objects, private_writer;
  handle *parent; napi_ref parent_ref;
  char path[PATH_MAX], source[PATH_MAX], relative[PATH_MAX];
  struct stat initial, immediate_parent;
};

static napi_value fail(napi_env env, const char *code, const char *message) {
  napi_throw_error(env, code, message); return NULL;
}
static const char *error_code(int e) {
  switch(e) {
    case ENOSYS: case EINVAL: case EOPNOTSUPP: return "UNSUPPORTED";
    case ENOENT: case ENOTDIR: return "MISSING";
    case EACCES: case EPERM: return "PERMISSION";
    case ENOSPC: case EDQUOT: return "QUOTA";
    case EEXIST: return "CONFLICT";
    case ELOOP: case EXDEV: return "UNTRUSTED";
    case EAGAIN: return "CHANGED";
    case ENAMETOOLONG: return "INVALID_INPUT";
    default: return "IO";
  }
}
static napi_value io_error(napi_env env, const char *message) {
  return fail(env, error_code(errno), message);
}
static bool same_id(const struct stat *a, const struct stat *b) {
  return a->st_dev == b->st_dev && a->st_ino == b->st_ino && (a->st_mode&S_IFMT)==(b->st_mode&S_IFMT);
}
static bool same_revision(const struct stat *a, const struct stat *b) {
  return same_id(a,b) && a->st_size==b->st_size && a->st_mode==b->st_mode && a->st_uid==b->st_uid && a->st_gid==b->st_gid && a->st_nlink==b->st_nlink
    && a->st_mtim.tv_sec==b->st_mtim.tv_sec && a->st_mtim.tv_nsec==b->st_mtim.tv_nsec
    && a->st_ctim.tv_sec==b->st_ctim.tv_sec && a->st_ctim.tv_nsec==b->st_ctim.tv_nsec;
}
static int safe_open(int dirfd, const char *path, int flags, uint64_t resolve) {
  struct open_how how = { .flags=(uint64_t)flags, .resolve=resolve };
  return (int)syscall(SYS_openat2,dirfd,path,&how,sizeof(how));
}
static bool utf8(const unsigned char *s) {
  while(*s) {
    if(*s<0x80) {s++;continue;}
    unsigned n; uint32_t c, minimum;
    if((*s&0xe0)==0xc0) {n=1;c=*s&31;minimum=0x80;}
    else if((*s&0xf0)==0xe0) {n=2;c=*s&15;minimum=0x800;}
    else if((*s&0xf8)==0xf0) {n=3;c=*s&7;minimum=0x10000;}
    else return false;
    s++; for(unsigned i=0;i<n;i++,s++) {if(!*s||(*s&0xc0)!=0x80)return false;c=(c<<6)|(*s&63);}
    if(c<minimum||c>0x10ffff||(c>=0xd800&&c<=0xdfff))return false;
  } return true;
}
static bool string_arg(napi_env env,napi_value v,char out[PATH_MAX]) {
  napi_valuetype type; size_t size=0,read=0;
  if(napi_typeof(env,v,&type)!=napi_ok||type!=napi_string||napi_get_value_string_utf8(env,v,NULL,0,&size)!=napi_ok||size>=PATH_MAX) {
    fail(env,"INVALID_INPUT","Expected a bounded UTF-8 path string");return false;
  }
  if(napi_get_value_string_utf8(env,v,out,PATH_MAX,&read)!=napi_ok||read!=size||strlen(out)!=size||!utf8((unsigned char*)out)) {
    fail(env,"INVALID_INPUT","Invalid path encoding or embedded NUL");return false;
  } return true;
}
static bool arguments(napi_env env,napi_callback_info info,size_t expected,napi_value *argv,state **s) {
  size_t count=expected+1; void *data=NULL;
  if(napi_get_cb_info(env,info,&count,argv,NULL,&data)!=napi_ok||count!=expected) {
    fail(env,"INVALID_INPUT","Incorrect native authority arguments");return false;
  } *s=data;return true;
}
static handle *unwrap(napi_env env,napi_value v,state *s) {
  void *p=NULL;
  if(napi_get_value_external(env,v,&p)!=napi_ok) {fail(env,"INVALID_INPUT","Expected an opaque native authority");return NULL;}
  for(handle *h=s->head;h;h=h->next) if(h==p) {
    if(h->fd<0) {fail(env,"CHANGED","Native authority is already closed");return NULL;}
    return h;
  }
  fail(env,"UNTRUSTED","Unknown native authority");return NULL;
}
static void close_handle(napi_env env,handle *h) {
  if(h->fd>=0) {close(h->fd);h->fd=-1;}
  if(h->parent_ref&&env) {napi_delete_reference(env,h->parent_ref);h->parent_ref=NULL;}
}
static void drop_state(state *s) {if(--s->refs==0)free(s);}
static void finalize_handle(napi_env env,void *data,void *hint) {
  (void)hint; handle *h=data;state *s=h->owner;close_handle(env,h);
  handle **at=&s->head;while(*at&&*at!=h)at=&(*at)->next;if(*at)*at=h->next;
  free(h);drop_state(s);
}
static void finalize_state(napi_env env,void *data,void *hint) {(void)env;(void)hint;drop_state(data);}
static napi_value new_handle(napi_env env,state *s,int fd,bool root,handle **out) {
  handle *h=calloc(1,sizeof(*h));if(!h) {close(fd);return fail(env,"IO","Native authority allocation failed");}
  h->fd=fd;h->root=root;h->owner=s;h->next=s->head;s->head=h;s->refs++;
  napi_value v;if(napi_create_external(env,h,finalize_handle,NULL,&v)!=napi_ok) {finalize_handle(env,h,NULL);return NULL;}
  *out=h;return v;
}
static bool private_info(napi_env env,handle *root,const struct stat *st) {
  if(!root->private_objects)return true;
  mode_t expected=S_ISDIR(st->st_mode)?0700:0600;
  if(st->st_uid!=geteuid()||(st->st_mode&0777)!=expected) {
    fail(env,"UNTRUSTED","Recovery object owner or mode changed");return false;
  }
  return true;
}
static bool verify_root(napi_env env,handle *r) {
  if(!r||!r->root||r->fd<0) {fail(env,"STALE_ROOT","Root authority is closed");return false;}
  char *canonical=realpath(r->source,NULL);
  if(!canonical) {fail(env,"STALE_ROOT","Registered root source no longer resolves");return false;}
  bool equal=strcmp(canonical,r->path)==0;free(canonical);
  int current=equal?safe_open(AT_FDCWD,r->path,O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW,RESOLVE_NO_SYMLINKS|RESOLVE_NO_MAGICLINKS):-1;
  struct stat st;bool valid=current>=0&&fstat(current,&st)==0&&same_id(&r->initial,&st);if(current>=0)close(current);
  if(!valid) {fail(env,"STALE_ROOT","Registered root identity or current namespace changed");return false;}
  return private_info(env,r,&st);
}
static bool combine(char out[PATH_MAX],const char *prefix,const char *target,const char *tail) {
  int n=snprintf(out,PATH_MAX,"%s%s%s%s%s",prefix,*prefix?"/":"",target,*tail?"/":"",tail);return n>=0&&n<PATH_MAX;
}
/* Follow aliases deliberately, using an O_PATH handle for the exact symlink.
 * Absolute contained aliases rebase to the root and are then rewalked with
 * openat2. A prefix alone is never an authority; magic mounts cannot cross it.
 * Process '..' only after preceding symlinks, preserving real path semantics.
 */
static int resolve_file(napi_env env,handle *r,const char *relative,char canonical[PATH_MAX],struct stat *st,struct stat *parent_st) {
  if(!verify_root(env,r))return -1;
  if(*relative=='/') {fail(env,"UNTRUSTED","Relative path required");return -1;}
  char check[PATH_MAX];strcpy(check,relative);char *save=NULL;
  for(char *p=strtok_r(check,"/",&save);p;p=strtok_r(NULL,"/",&save))if(!strcmp(p,"..")) {fail(env,"UNTRUSTED","Parent traversal in request");return -1;}
  char todo[PATH_MAX];strcpy(todo,*relative?relative:".");unsigned links=0,steps=0;
restart:;
  int current=fcntl(r->fd,F_DUPFD_CLOEXEC,3);if(current<0) {io_error(env,"Cannot duplicate root authority");return -1;}
  char prefix[PATH_MAX]="";char *cursor=todo;
  while(*cursor) {
    while(*cursor=='/')cursor++;
    if(!*cursor)break;
    char *end=strchr(cursor,'/');if(end)*end='\0';char *tail=end?end+1:cursor+strlen(cursor);
    if(++steps>1024) {close(current);fail(env,"UNTRUSTED","Path resolution limit exceeded");return -1;}
    if(!strcmp(cursor,".")) {cursor=tail;continue;}
    if(!strcmp(cursor,"..")) {
      if(!*prefix) {close(current);fail(env,"UNTRUSTED","Alias escapes root");return -1;}
      char *slash=strrchr(prefix,'/');if(slash)*slash='\0';else prefix[0]='\0';
      char next[PATH_MAX];bool ok=combine(next,prefix,".",tail);close(current);
      if(!ok) {fail(env,"INVALID_INPUT","Alias path exceeds limit");return -1;}strcpy(todo,next);goto restart;
    }
    int next=safe_open(current,cursor,O_PATH|O_NOFOLLOW|O_CLOEXEC,RESOLVE_SAFE);
    if(next<0) {int e=errno;close(current);errno=e;io_error(env,"Contained path open failed");return -1;}
    struct stat part;if(fstat(next,&part)) {int e=errno;close(next);close(current);errno=e;io_error(env,"Contained path stat failed");return -1;}
    if(S_ISLNK(part.st_mode)) {
      if(r->private_objects) {close(next);close(current);fail(env,"UNTRUSTED","Symlinks are forbidden in recovery storage");return -1;}
      char target[PATH_MAX];ssize_t len=readlinkat(next,"",target,sizeof(target)-1);int e=errno;close(next);close(current);
      if(len<0) {errno=e;io_error(env,"Alias handle read failed");return -1;}
      if(len>=(ssize_t)sizeof(target)-1||++links>40) {fail(env,"UNTRUSTED","Alias resolution limit exceeded");return -1;}
      target[len]='\0';if(!utf8((unsigned char*)target)) {fail(env,"INVALID_INPUT","Alias encoding unsupported");return -1;}
      const char *t=target;const char *parent=prefix;
      if(*t=='/') {
        size_t n=strlen(r->path);parent="";
        if(!strcmp(r->path,"/"))t++;
        else if(!strncmp(t,r->path,n)&&(t[n]=='/'||t[n]=='\0')) {t+=n;while(*t=='/')t++;}
        else {fail(env,"UNTRUSTED","Absolute alias escapes registered root");return -1;}
      }
      char joined[PATH_MAX];if(!combine(joined,parent,*t?t:".",tail)) {fail(env,"INVALID_INPUT","Alias path exceeds limit");return -1;}
      strcpy(todo,joined);goto restart;
    }
    if(!private_info(env,r,&part)) {close(next);close(current);return -1;}
    if(end&&!S_ISDIR(part.st_mode)) {close(next);close(current);fail(env,"MISSING","Parent is not a directory");return -1;}
    char joined[PATH_MAX];if(!combine(joined,prefix,cursor,"")) {close(next);close(current);fail(env,"INVALID_INPUT","Path exceeds limit");return -1;}
    strcpy(prefix,joined);close(current);current=next;cursor=tail;
  }
  if(fstat(current,st)) {int e=errno;close(current);errno=e;io_error(env,"Opened object stat failed");return -1;}close(current);
  if(!S_ISREG(st->st_mode)&&!S_ISDIR(st->st_mode)) {fail(env,"NOT_REGULAR","Only regular files and directories are supported");return -1;}
  strcpy(canonical,*prefix?prefix:".");
  int fd=safe_open(r->fd,canonical,O_RDONLY|O_NONBLOCK|O_NOCTTY|O_NOFOLLOW|O_CLOEXEC|(S_ISDIR(st->st_mode)?O_DIRECTORY:0),RESOLVE_SAFE);
  if(fd<0) {io_error(env,"Read-only contained file open failed");return -1;}
  struct stat actual;if(fstat(fd,&actual)||!same_revision(st,&actual)) {close(fd);fail(env,"CHANGED","Object changed while opening");return -1;}
  /* Bind the immediate parent namespace too. A same-inode hardlink in a new
   * parent cannot silently replace the original file/parent authority. */
  char parent_path[PATH_MAX];strcpy(parent_path,canonical);
  char *slash=strrchr(parent_path,'/');const char *leaf=canonical;
  if(slash) {leaf=canonical+(slash-parent_path)+1;*slash='\0';}
  else strcpy(parent_path,".");
  int pfd=safe_open(r->fd,parent_path,O_PATH|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC,RESOLVE_SAFE);
  if(pfd<0) {int saved=errno;close(fd);errno=saved;io_error(env,"Immediate parent open failed");return -1;}
  struct stat parent,observed;
  bool stable=fstat(pfd,&parent)==0&&fstatat(pfd,leaf,&observed,AT_SYMLINK_NOFOLLOW)==0&&same_id(&observed,&actual);
  close(pfd);
  if(!stable) {close(fd);fail(env,"CHANGED","File or immediate parent changed during opening");return -1;}
  if(parent_st)*parent_st=parent;
  if(!verify_root(env,r)) {close(fd);return -1;}
  return fd;
}
static bool verify_file(napi_env env,handle *h) {
  if(h->root)return verify_root(env,h);
  char canonical[PATH_MAX];struct stat now,parent;int fd=resolve_file(env,h->parent,h->relative,canonical,&now,&parent);
  if(fd<0)return false;
  close(fd);
  struct stat held;
  if(strcmp(canonical,h->path)||!same_id(&parent,&h->immediate_parent)||fstat(h->fd,&held)||(h->private_writer?(!same_id(&held,&h->initial)||!same_id(&now,&h->initial)):(!same_revision(&held,&h->initial)||!same_revision(&now,&h->initial)))) {
    fail(env,"CHANGED","File identity, revision or namespace changed");return false;
  }return true;
}
static void text(napi_env env,napi_value obj,const char *key,const char *value) {
  napi_value v;napi_create_string_utf8(env,value,NAPI_AUTO_LENGTH,&v);napi_set_named_property(env,obj,key,v);
}
static void decimal(napi_env env,napi_value obj,const char *key,uint64_t number) {char buf[32];snprintf(buf,sizeof(buf),"%"PRIu64,number);text(env,obj,key,buf);}
static void nanos(napi_env env,napi_value obj,const char *key,struct timespec time) {
  __int128 value=(__int128)time.tv_sec*1000000000+time.tv_nsec;bool neg=value<0;if(neg)value=-value;
  char buf[64];size_t at=sizeof(buf)-1;buf[at]='\0';do {buf[--at]=(char)('0'+value%10);value/=10;}while(value);if(neg)buf[--at]='-';text(env,obj,key,buf+at);
}
static napi_value root_info(napi_env env,napi_callback_info info) {
  napi_value argv[2],out,identity;state *s;if(!arguments(env,info,1,argv,&s))return NULL;handle *r=unwrap(env,argv[0],s);
  if(!r)return NULL;
  if(!r->root)return fail(env,"INVALID_INPUT","Root authority required");
  if(!verify_root(env,r))return NULL;
  napi_create_object(env,&out);napi_create_object(env,&identity);text(env,out,"path",r->path);text(env,out,"sourcePath",r->source);
  decimal(env,identity,"device",r->initial.st_dev);decimal(env,identity,"inode",r->initial.st_ino);napi_set_named_property(env,out,"identity",identity);return out;
}
static napi_value open_root(napi_env env,napi_callback_info info) {
  napi_value argv[4];state *s;char path[PATH_MAX],dev[PATH_MAX],ino[PATH_MAX];
  if(!arguments(env,info,3,argv,&s)||!string_arg(env,argv[0],path)||!string_arg(env,argv[1],dev)||!string_arg(env,argv[2],ino))return NULL;
  if(*path!='/')return fail(env,"INVALID_INPUT","Absolute root source required");
  char *canonical=realpath(path,NULL);
  if(!canonical)return io_error(env,"Root source does not resolve");
  if(strlen(canonical)>=PATH_MAX) {free(canonical);return fail(env,"INVALID_INPUT","Root path exceeds limit");}
  int fd=safe_open(AT_FDCWD,canonical,O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW,RESOLVE_NO_SYMLINKS|RESOLVE_NO_MAGICLINKS);
  if(fd<0) {int e=errno;free(canonical);errno=e;return io_error(env,"Root open failed");}
  struct stat st;struct statfs fs;if(fstat(fd,&st)||fstatfs(fd,&fs)) {int e=errno;close(fd);free(canonical);errno=e;return io_error(env,"Root stat failed");}
  /* Explicit initial target set. Unknown and network filesystems fail closed. */
  uint64_t type=(uint64_t)fs.f_type;
  if(type!=0xef53&&type!=0x01021994&&type!=0x794c7630&&type!=0x58465342&&type!=0x9123683e) {close(fd);free(canonical);return fail(env,"UNSUPPORTED","Filesystem not yet verified by the Linux backend");}
  char actual_dev[32],actual_ino[32];snprintf(actual_dev,sizeof(actual_dev),"%"PRIu64,(uint64_t)st.st_dev);snprintf(actual_ino,sizeof(actual_ino),"%"PRIu64,(uint64_t)st.st_ino);
  if((!!*dev!=!!*ino)||(*dev&&(strcmp(dev,actual_dev)||strcmp(ino,actual_ino)))) {close(fd);free(canonical);return fail(env,"STALE_ROOT","Expected root identity changed");}
  int probe=safe_open(fd,".",O_RDONLY|O_DIRECTORY|O_CLOEXEC,RESOLVE_SAFE);
  if(probe<0) {int e=errno;close(fd);free(canonical);errno=e;return io_error(env,"Required openat2 confinement is unavailable");}close(probe);
  handle *h;napi_value out=new_handle(env,s,fd,true,&h);if(!out) {free(canonical);return NULL;}strcpy(h->path,canonical);strcpy(h->source,path);h->initial=st;free(canonical);
  if(!verify_root(env,h)) {close_handle(env,h);return NULL;}return out;
}
static napi_value open_relative(napi_env env,napi_callback_info info) {
  napi_value argv[3];state *s;char relative[PATH_MAX];if(!arguments(env,info,2,argv,&s)||!string_arg(env,argv[1],relative))return NULL;handle *r=unwrap(env,argv[0],s);if(!r)return NULL;
  if(!r->root)return fail(env,"INVALID_INPUT","Root authority required");
  char canonical[PATH_MAX];struct stat st,parent;
  int fd=resolve_file(env,r,relative,canonical,&st,&parent);
  if(fd<0)return NULL;
  handle *h;napi_value out=new_handle(env,s,fd,false,&h);if(!out)return NULL;h->parent=r;strcpy(h->path,canonical);strcpy(h->relative,relative);h->initial=st;h->immediate_parent=parent;
  if(napi_create_reference(env,argv[0],1,&h->parent_ref)!=napi_ok) {close_handle(env,h);return NULL;}return out;
}
static napi_value metadata(napi_env env,napi_callback_info info) {
  napi_value argv[2],out,identity,v;state *s;if(!arguments(env,info,1,argv,&s))return NULL;handle *h=unwrap(env,argv[0],s);if(!h||!verify_file(env,h))return NULL;
  struct stat st;if(fstat(h->fd,&st))return io_error(env,"File metadata unavailable");napi_create_object(env,&out);napi_create_object(env,&identity);
  decimal(env,identity,"device",st.st_dev);decimal(env,identity,"inode",st.st_ino);napi_set_named_property(env,out,"identity",identity);
  napi_value parent_identity;napi_create_object(env,&parent_identity);const struct stat *parent=h->root?&h->initial:&h->immediate_parent;
  decimal(env,parent_identity,"device",parent->st_dev);decimal(env,parent_identity,"inode",parent->st_ino);napi_set_named_property(env,out,"parentIdentity",parent_identity);
  text(env,out,"relativePath",h->root?".":h->path);
  napi_create_double(env,(double)st.st_size,&v);napi_set_named_property(env,out,"size",v);decimal(env,out,"mode",st.st_mode);decimal(env,out,"uid",st.st_uid);decimal(env,out,"gid",st.st_gid);decimal(env,out,"nlink",st.st_nlink);
  nanos(env,out,"changedNs",st.st_ctim);nanos(env,out,"modifiedNs",st.st_mtim);text(env,out,"kind",S_ISDIR(st.st_mode)?"directory":"file");
  struct statx sx={0};if(statx(h->fd,"",AT_EMPTY_PATH|AT_NO_AUTOMOUNT,STATX_BTIME,&sx)==0&&(sx.stx_mask&STATX_BTIME)) {struct timespec t={.tv_sec=sx.stx_btime.tv_sec,.tv_nsec=sx.stx_btime.tv_nsec};nanos(env,out,"birthtimeNs",t);}else {napi_get_null(env,&v);napi_set_named_property(env,out,"birthtimeNs",v);}
  handle *r=h->root?h:h->parent;int allowed=(int)syscall(SYS_faccessat2,r->fd,h->root?".":h->path,W_OK,AT_EACCESS|AT_SYMLINK_NOFOLLOW);
  if(allowed&&errno!=EACCES&&errno!=EPERM&&errno!=EROFS)return io_error(env,"Cannot determine physical write permission");
  napi_get_boolean(env,allowed==0,&v);napi_set_named_property(env,out,"writable",v);if(!verify_file(env,h))return NULL;return out;
}
static bool integer(napi_env env,napi_value arg,uint32_t *out) {
  double number;if(napi_get_value_double(env,arg,&number)!=napi_ok||!isfinite(number)||number<0||number>MAX_BYTES||number!=(double)(uint32_t)number) {fail(env,"INVALID_INPUT","Invalid bounded byte range");return false;}*out=(uint32_t)number;return true;
}
static napi_value read_bytes(napi_env env,napi_callback_info info) {
  napi_value argv[4],out;state *s;uint32_t offset,length;
  if(!arguments(env,info,3,argv,&s)||!integer(env,argv[1],&offset)||!integer(env,argv[2],&length))return NULL;
  handle *h=unwrap(env,argv[0],s);
  if(!h||!verify_file(env,h))return NULL;
  if(length>MAX_READ)return fail(env,"TOO_LARGE","Read block exceeds existing text budget");
  if(h->root||!S_ISREG(h->initial.st_mode))return fail(env,"NOT_REGULAR","Regular file required for reading");
  if(h->initial.st_size<0||h->initial.st_size>MAX_BYTES)return fail(env,"TOO_LARGE","File exceeds read-core limit");
  uint64_t size=(uint64_t)h->initial.st_size;if(offset>size)return fail(env,"INVALID_INPUT","Byte offset exceeds file size");if(length>size-offset)length=(uint32_t)(size-offset);
  unsigned char *bytes=malloc(length?length:1);if(!bytes)return fail(env,"IO","Read allocation failed");size_t at=0;
  while(at<length) {ssize_t n=pread(h->fd,bytes+at,length-at,(off_t)(offset+at));if(n<0&&errno==EINTR)continue;if(n<=0) {free(bytes);return fail(env,"CHANGED","File changed or became unreadable");}at+=(size_t)n;}
  if(!verify_file(env,h)) {free(bytes);return NULL;}napi_status status=napi_create_buffer_copy(env,length,bytes,NULL,&out);free(bytes);return status==napi_ok?out:NULL;
}
static napi_value list_names(napi_env env,napi_callback_info info) {
  napi_value argv[2],out;state *s;if(!arguments(env,info,1,argv,&s))return NULL;handle *h=unwrap(env,argv[0],s);if(!h||!verify_file(env,h))return NULL;
  if(!S_ISDIR(h->initial.st_mode))return fail(env,"NOT_REGULAR","Directory required for listing");
  int fd=fcntl(h->fd,F_DUPFD_CLOEXEC,3);if(fd<0)return io_error(env,"Directory duplicate failed");DIR *dir=fdopendir(fd);if(!dir) {close(fd);return io_error(env,"Directory enumeration unavailable");}
  rewinddir(dir);
  napi_create_array(env,&out);uint32_t count=0;struct dirent *entry;errno=0;
  while((entry=readdir(dir))) {
    if(!strcmp(entry->d_name,".")||!strcmp(entry->d_name,".."))continue;
    if(count>=100000||!utf8((unsigned char*)entry->d_name)) {closedir(dir);return fail(env,count>=100000?"TOO_LARGE":"INVALID_INPUT","Directory enumeration limit or encoding unsupported");}
    struct stat st;if(fstatat(h->fd,entry->d_name,&st,AT_SYMLINK_NOFOLLOW)) {int e=errno;closedir(dir);errno=e;return io_error(env,"Directory entry changed");}
    napi_value value,identity,v;napi_create_object(env,&value);napi_create_object(env,&identity);text(env,value,"name",entry->d_name);
    decimal(env,identity,"device",st.st_dev);decimal(env,identity,"inode",st.st_ino);napi_set_named_property(env,value,"identity",identity);
    napi_get_boolean(env,S_ISLNK(st.st_mode),&v);napi_set_named_property(env,value,"symbolicLink",v);napi_create_double(env,(double)st.st_size,&v);napi_set_named_property(env,value,"size",v);
    napi_set_element(env,out,count++,value);errno=0;
  }
  int saved=errno;closedir(dir);if(saved) {errno=saved;return io_error(env,"Directory enumeration failed");}if(!verify_file(env,h))return NULL;return out;
}
static napi_value verify(napi_env env,napi_callback_info info) {
  napi_value argv[2],out;state *s;if(!arguments(env,info,1,argv,&s))return NULL;handle *h=unwrap(env,argv[0],s);if(!h||!verify_file(env,h))return NULL;napi_get_boolean(env,true,&out);return out;
}
static napi_value close_authority(napi_env env,napi_callback_info info) {
  napi_value argv[2],out;state *s;if(!arguments(env,info,1,argv,&s))return NULL;
  void *p=NULL;if(napi_get_value_external(env,argv[0],&p)!=napi_ok)return fail(env,"INVALID_INPUT","Expected opaque native authority");
  handle *h=s->head;while(h&&h!=p)h=h->next;if(!h)return fail(env,"UNTRUSTED","Unknown native authority");close_handle(env,h);napi_get_undefined(env,&out);return out;
}
static napi_value use_private(napi_env env,napi_callback_info info) {
  napi_value argv[2],out;state *s;if(!arguments(env,info,1,argv,&s))return NULL;
  handle *root=unwrap(env,argv[0],s);if(!root)return NULL;
  if(!root->root)return fail(env,"INVALID_INPUT","Root authority required");
  root->private_objects=true;if(!verify_root(env,root))return NULL;
  napi_get_undefined(env,&out);return out;
}
/* Identity-only ancestry observations for recovery protection. No contents are
 * read outside the registered root. Use canonical namespace paths and verify
 * the registered root on both ends, including roots registered below a private
 * ancestor; do not infer privacy from a filename prefix or a mount's inode. */
static napi_value root_ancestors(napi_env env,napi_callback_info info) {
  napi_value argv[2],out;state *s;if(!arguments(env,info,1,argv,&s))return NULL;
  handle *root=unwrap(env,argv[0],s);if(!root)return NULL;
  if(!root->root)return fail(env,"INVALID_INPUT","Root authority required");
  if(!verify_root(env,root))return NULL;
  napi_create_array(env,&out);char path[PATH_MAX];strcpy(path,root->path);uint32_t count=0;
  for(;;) {
    int fd=safe_open(AT_FDCWD,path,O_PATH|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW,RESOLVE_NO_SYMLINKS|RESOLVE_NO_MAGICLINKS);
    if(fd<0)return io_error(env,"Root ancestor identity is unavailable");
    struct stat st;int status=fstat(fd,&st);int saved=errno;close(fd);
    if(status) {errno=saved;return io_error(env,"Root ancestor stat failed");}
    napi_value item;napi_create_object(env,&item);decimal(env,item,"device",st.st_dev);decimal(env,item,"inode",st.st_ino);napi_set_element(env,out,count++,item);
    if(!strcmp(path,"/"))break;
    char *slash=strrchr(path,'/');if(!slash)return fail(env,"UNTRUSTED","Canonical root path is invalid");
    if(slash==path)path[1]='\0';else *slash='\0';
  }
  if(!verify_root(env,root))return NULL;
  return out;
}
/* Recovery bootstrap writes only the two fixed private directories beneath
 * the validated userData FD. It grants no source-file writing authority. Never
 * chmod/adopt an existing object, follow a recovery symlink, or remove failed
 * preparation: a later inspection must see the original state. */
static bool owned_private_directory(napi_env env,int fd,struct stat *st) {
  if(fstat(fd,st)) {io_error(env,"Recovery directory stat failed");return false;}
  if(!S_ISDIR(st->st_mode)||st->st_uid!=geteuid()||(st->st_mode&0777)!=0700) {
    fail(env,"UNTRUSTED","Recovery directory owner or mode changed");return false;
  }
  return true;
}
static int private_directory(napi_env env,int parent,const char *name,struct stat *st) {
  if(mkdirat(parent,name,0700)&&errno!=EEXIST) {io_error(env,"Recovery directory creation failed");return -1;}
  int fd=safe_open(parent,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC,RESOLVE_SAFE);
  if(fd<0) {io_error(env,"Recovery directory open failed");return -1;}
  if(!owned_private_directory(env,fd,st)) {close(fd);return -1;}
  if(fsync(parent)) {int saved=errno;close(fd);errno=saved;io_error(env,"Recovery parent sync failed");return -1;}
  return fd;
}
static bool verify_private_child(napi_env env,int parent,const char *name,const struct stat *expected) {
  int fd=safe_open(parent,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC,RESOLVE_SAFE);
  if(fd<0) {io_error(env,"Recovery directory namespace changed");return false;}
  struct stat actual;bool valid=owned_private_directory(env,fd,&actual);close(fd);
  if(!valid)return false;
  if(!same_id(expected,&actual)) {fail(env,"CHANGED","Recovery directory identity changed");return false;}
  return true;
}
static napi_value initialize_recovery(napi_env env,napi_callback_info info) {
  napi_value argv[2],out,identity,parent_identity;state *s;
  if(!arguments(env,info,1,argv,&s))return NULL;
  handle *root=unwrap(env,argv[0],s);if(!root)return NULL;
  if(!root->root)return fail(env,"INVALID_INPUT","Root authority required");
  if(!verify_root(env,root))return NULL;
  char path[PATH_MAX];int length=snprintf(path,sizeof(path),"%s%sfile-recovery/v1",root->path,!strcmp(root->path,"/")?"":"/");
  if(length<0||length>=PATH_MAX)return fail(env,"INVALID_INPUT","Recovery path exceeds limit");
  struct stat parent_st,version_st;int parent=private_directory(env,root->fd,"file-recovery",&parent_st);
  if(parent<0)return NULL;
  int version=private_directory(env,parent,"v1",&version_st);
  if(version<0) {close(parent);return NULL;}
  bool valid=verify_root(env,root)&&verify_private_child(env,root->fd,"file-recovery",&parent_st)&&verify_private_child(env,parent,"v1",&version_st);
  if(valid&&fsync(version)) {io_error(env,"Recovery version sync failed");valid=false;}
  if(valid)valid=verify_private_child(env,root->fd,"file-recovery",&parent_st)&&verify_private_child(env,parent,"v1",&version_st)&&verify_root(env,root);
  close(version);close(parent);if(!valid)return NULL;
  napi_create_object(env,&out);text(env,out,"path",path);
  napi_create_object(env,&identity);decimal(env,identity,"device",version_st.st_dev);decimal(env,identity,"inode",version_st.st_ino);napi_set_named_property(env,out,"identity",identity);
  napi_create_object(env,&parent_identity);decimal(env,parent_identity,"device",parent_st.st_dev);decimal(env,parent_identity,"inode",parent_st.st_ino);napi_set_named_property(env,out,"parentIdentity",parent_identity);
  return out;
}
/* Private checkpoint writes are a separate capability. Every mutation is
 * rooted in a verified0700 recovery authority; source descriptors are data,
 * never opened by these methods. Record directory locks coordinate the native
 * protocol's own processes; they are not a general hostile-writer CAS proof. */
static bool private_component(const char *name) {
  size_t length=strlen(name);
  if(!length||length>80)return false;
  for(size_t i=0;i<length;i++)if(!((name[i]>='a'&&name[i]<='z')||(name[i]>='0'&&name[i]<='9')||name[i]=='-'))return false;
  return true;
}
static bool private_leaf(const char *name) {
  return private_component(name)&&((!strncmp(name,"draft-",6)&&strlen(name)==42)||(!strncmp(name,"journal-",8)&&strlen(name)==44));
}
static handle *private_root(napi_env env,napi_value arg,state *s) {
  handle *root=unwrap(env,arg,s);if(!root)return NULL;
  if(!root->root||!root->private_objects) {fail(env,"UNTRUSTED","Private recovery root authority required");return NULL;}
  return verify_root(env,root)?root:NULL;
}
static handle *private_record(napi_env env,napi_value arg,state *s) {
  handle *record=unwrap(env,arg,s);if(!record)return NULL;
  if(!record->private_writer||!record->parent||!record->parent->private_objects||!S_ISDIR(record->initial.st_mode)) {
    fail(env,"UNTRUSTED","Locked private record authority required");return NULL;
  }
  return verify_file(env,record)?record:NULL;
}
static napi_value begin_private_record(napi_env env,napi_callback_info info) {
  napi_value argv[5],out,value;state *s;char project[PATH_MAX],record_id[PATH_MAX];bool create=false;
  if(!arguments(env,info,4,argv,&s)||!string_arg(env,argv[1],project)||!string_arg(env,argv[2],record_id))return NULL;
  if(napi_get_value_bool(env,argv[3],&create)!=napi_ok)return fail(env,"INVALID_INPUT","Explicit record creation flag required");
  if(!private_component(project)||!private_component(record_id))return fail(env,"INVALID_INPUT","Invalid private record component");
  handle *root=private_root(env,argv[0],s);if(!root)return NULL;
  bool created=false;
  if(create) {
    struct stat parent_st;int parent=private_directory(env,root->fd,project,&parent_st);if(parent<0)return NULL;
    int status=mkdirat(parent,record_id,0700);int saved=errno;
    if(status==0)created=true;
    else if(saved!=EEXIST) {close(parent);errno=saved;return io_error(env,"Private record creation failed");}
    if(fsync(parent)) {saved=errno;close(parent);errno=saved;return io_error(env,"Private project directory sync failed");}
    close(parent);
  }
  char relative[PATH_MAX],canonical[PATH_MAX];
  if(!combine(relative,project,record_id,""))return fail(env,"INVALID_INPUT","Private record path exceeds limit");
  struct stat st,parent;int fd=resolve_file(env,root,relative,canonical,&st,&parent);if(fd<0)return NULL;
  if(!S_ISDIR(st.st_mode)) {close(fd);return fail(env,"NOT_REGULAR","Private record is not a directory");}
  if(flock(fd,LOCK_EX|LOCK_NB)) {int saved=errno;close(fd);if(saved==EWOULDBLOCK||saved==EAGAIN)return fail(env,"CONFLICT","Private record is already in use");errno=saved;return io_error(env,"Private record lock failed");}
  handle *record;napi_value external=new_handle(env,s,fd,false,&record);if(!external)return NULL;
  record->parent=root;record->private_writer=true;record->initial=st;record->immediate_parent=parent;
  strcpy(record->path,canonical);strcpy(record->relative,relative);
  if(napi_create_reference(env,argv[0],1,&record->parent_ref)!=napi_ok) {close_handle(env,record);return NULL;}
  if(!verify_file(env,record)) {close_handle(env,record);return NULL;}
  napi_create_object(env,&out);napi_set_named_property(env,out,"handle",external);napi_get_boolean(env,created,&value);napi_set_named_property(env,out,"created",value);return out;
}
static napi_value check_private_space(napi_env env,napi_callback_info info) {
  napi_value argv[3],out;state *s;uint32_t bytes;
  if(!arguments(env,info,2,argv,&s)||!integer(env,argv[1],&bytes))return NULL;
  handle *root=private_root(env,argv[0],s);if(!root)return NULL;
  struct statvfs volume;if(fstatvfs(root->fd,&volume))return io_error(env,"Recovery free space unavailable");
  __uint128_t available=(__uint128_t)volume.f_bavail*volume.f_frsize;
  if(available<(__uint128_t)bytes+64*1024)return fail(env,"QUOTA","Insufficient free space for recovery material");
  napi_get_undefined(env,&out);return out;
}
static napi_value create_private_file(napi_env env,napi_callback_info info) {
  napi_value argv[4],out,identity;state *s;char leaf[PATH_MAX];void *data=NULL;size_t bytes=0;bool buffer=false;
  if(!arguments(env,info,3,argv,&s)||!string_arg(env,argv[1],leaf))return NULL;
  if(!private_leaf(leaf))return fail(env,"INVALID_INPUT","Private generated leaf required");
  if(napi_is_buffer(env,argv[2],&buffer)!=napi_ok||!buffer||napi_get_buffer_info(env,argv[2],&data,&bytes)!=napi_ok)return fail(env,"INVALID_INPUT","Private byte buffer required");
  if(bytes>41U*1024U*1024U)return fail(env,"TOO_LARGE","Private draft exceeds format ceiling");
  if(!strncmp(leaf,"journal-",8)&&bytes>64U*1024U)return fail(env,"TOO_LARGE","Recovery journal exceeds budget");
  handle *record=private_record(env,argv[0],s);if(!record)return NULL;
  struct open_how how={.flags=O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC,.mode=0600,.resolve=RESOLVE_SAFE};
  int fd=(int)syscall(SYS_openat2,record->fd,leaf,&how,sizeof(how));if(fd<0)return io_error(env,"Exclusive private file creation failed");
  struct stat before,after;
  if(fstat(fd,&before)||!S_ISREG(before.st_mode)) {int saved=errno;close(fd);errno=saved;return fail(env,"IO","Created private file is not regular");}
  if(!private_info(env,record->parent,&before)) {close(fd);return NULL;}
  if(before.st_nlink!=1) {close(fd);return fail(env,"UNTRUSTED","New private file authority changed");}
  for(size_t offset=0;offset<bytes;) {
    ssize_t count=write(fd,(unsigned char*)data+offset,bytes-offset);
    if(count<0&&errno==EINTR)continue;
    if(count<=0) {int saved=count<0?errno:EIO;close(fd);errno=saved;return io_error(env,"Private file write failed");}
    offset+=(size_t)count;
  }
  if(fsync(fd)||fstat(fd,&after)) {int saved=errno;close(fd);errno=saved;return io_error(env,"Private file data sync failed");}
  close(fd);
  if(!same_id(&before,&after)||after.st_size!=(off_t)bytes||after.st_nlink!=1||after.st_uid!=before.st_uid||after.st_mode!=before.st_mode)return fail(env,"CHANGED","Private file changed while writing");
  if(!private_record(env,argv[0],s))return NULL;
  struct stat named;if(fstatat(record->fd,leaf,&named,AT_SYMLINK_NOFOLLOW)||!same_revision(&after,&named))return fail(env,"CHANGED","Private file namespace changed after sync");
  if(fsync(record->fd))return io_error(env,"Private file directory sync failed");
  napi_create_object(env,&out);napi_create_object(env,&identity);decimal(env,identity,"device",after.st_dev);decimal(env,identity,"inode",after.st_ino);napi_set_named_property(env,out,"identity",identity);return out;
}
static napi_value install_private_journal(napi_env env,napi_callback_info info) {
  napi_value argv[4],out,value;state *s;char leaf[PATH_MAX];
  if(!arguments(env,info,3,argv,&s)||!string_arg(env,argv[1],leaf))return NULL;
  if(!private_leaf(leaf)||strncmp(leaf,"journal-",8))return fail(env,"INVALID_INPUT","Generated journal leaf required");
  handle *record=private_record(env,argv[0],s);if(!record)return NULL;
  napi_valuetype type;if(napi_typeof(env,argv[2],&type)!=napi_ok)return fail(env,"INVALID_INPUT","Expected old journal authority");
  handle *old=NULL;
  if(type!=napi_null) {
    old=unwrap(env,argv[2],s);if(!old||!verify_file(env,old))return NULL;
    char expected[PATH_MAX];if(!combine(expected,record->path,"journal.json","")||old->root||old->parent!=record->parent||strcmp(expected,old->path))return fail(env,"UNTRUSTED","Old journal is not in this record");
  }
  struct stat temporary;if(fstatat(record->fd,leaf,&temporary,AT_SYMLINK_NOFOLLOW))return io_error(env,"New journal disappeared");
  if(!S_ISREG(temporary.st_mode)||temporary.st_size>64*1024||temporary.st_nlink!=1||!private_info(env,record->parent,&temporary))return fail(env,"UNTRUSTED","New journal authority changed");
  if(!verify_file(env,record))return NULL;
  unsigned flags=old?RENAME_EXCHANGE:RENAME_NOREPLACE;
  if(syscall(SYS_renameat2,record->fd,leaf,record->fd,"journal.json",flags))return io_error(env,"Atomic private journal install failed");
  if(fsync(record->fd))return io_error(env,"Installed recovery journal directory sync failed");
  if(!verify_file(env,record))return NULL;
  struct stat installed;if(fstatat(record->fd,"journal.json",&installed,AT_SYMLINK_NOFOLLOW)||!same_id(&installed,&temporary))return fail(env,"CHANGED","Installed journal identity changed");
  if(old) {struct stat displaced;if(fstatat(record->fd,leaf,&displaced,AT_SYMLINK_NOFOLLOW)||!same_id(&displaced,&old->initial))return fail(env,"CONFLICT","Unexpected old journal retained beside new journal");}
  napi_create_object(env,&out);if(old)napi_create_string_utf8(env,leaf,NAPI_AUTO_LENGTH,&value);else napi_get_null(env,&value);napi_set_named_property(env,out,"displaced",value);return out;
}
static napi_value remove_private_file(napi_env env,napi_callback_info info) {
  napi_value argv[4],out;state *s;char leaf[PATH_MAX];
  if(!arguments(env,info,3,argv,&s)||!string_arg(env,argv[1],leaf))return NULL;
  if(!private_leaf(leaf)&&strcmp(leaf,"draft"))return fail(env,"INVALID_INPUT","Only superseded private draft/journal leaves may be removed");
  handle *record=private_record(env,argv[0],s);if(!record)return NULL;
  handle *file=unwrap(env,argv[2],s);if(!file||!verify_file(env,file))return NULL;
  char expected[PATH_MAX];if(!combine(expected,record->path,leaf,"")||file->root||file->parent!=record->parent||strcmp(file->path,expected))return fail(env,"UNTRUSTED","Superseded file is outside this record");
  struct stat current;if(fstatat(record->fd,leaf,&current,AT_SYMLINK_NOFOLLOW)||!same_revision(&current,&file->initial))return fail(env,"CONFLICT","Superseded private file changed; retained");
  if(unlinkat(record->fd,leaf,0))return io_error(env,"Superseded private file removal failed");
  if(fsync(record->fd))return io_error(env,"Private cleanup directory sync failed");
  if(!verify_file(env,record))return NULL;
  napi_get_undefined(env,&out);return out;
}
static napi_value initialize(napi_env env,napi_value exports) {
  state *s=calloc(1,sizeof(*s));if(!s)return fail(env,"IO","Authority state allocation failed");s->refs=1;
  if(napi_set_instance_data(env,s,finalize_state,NULL)!=napi_ok) {free(s);return NULL;}
  struct {const char *name;napi_callback function;} methods[]={{"openRoot",open_root},{"rootInfo",root_info},{"openRelative",open_relative},{"metadata",metadata},{"readBytes",read_bytes},{"listNames",list_names},{"verify",verify},{"close",close_authority},{"usePrivate",use_private},{"rootAncestors",root_ancestors},{"initializeRecovery",initialize_recovery},{"beginPrivateRecord",begin_private_record},{"checkPrivateSpace",check_private_space},{"createPrivateFile",create_private_file},{"installPrivateJournal",install_private_journal},{"removePrivateFile",remove_private_file}};
  for(size_t i=0;i<sizeof(methods)/sizeof(methods[0]);i++) {napi_value fn;if(napi_create_function(env,methods[i].name,NAPI_AUTO_LENGTH,methods[i].function,s,&fn)!=napi_ok)return NULL;napi_set_named_property(env,exports,methods[i].name,fn);}return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,initialize)
