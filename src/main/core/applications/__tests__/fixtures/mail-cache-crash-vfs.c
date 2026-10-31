/* Private fault fixture: delegate SQLite's original VFS unchanged, pausing after one
 * real main-database write while its FULL-synced rollback journal is still live.
 * No production build includes or loads this extension. */
#include <sqlite3ext.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <unistd.h>
#include <fcntl.h>
typedef struct { sqlite3_file base; sqlite3_file *real; int index; } File;
static sqlite3_vfs wrapped;
static int paused;
static sqlite3_vfs *parent(sqlite3_vfs *v){return (sqlite3_vfs *)v->pAppData;}
static int close_file(sqlite3_file *f){File *w=(File *)f;int r=w->real->pMethods->xClose(w->real);f->pMethods=0;return r;}
static int read_file(sqlite3_file *f,void *p,int n,sqlite3_int64 o){File *w=(File *)f;return w->real->pMethods->xRead(w->real,p,n,o);}
static int write_file(sqlite3_file *f,const void *p,int n,sqlite3_int64 o){
 File *w=(File *)f;int r=w->real->pMethods->xWrite(w->real,p,n,o);
 const char *gate=getenv("WILLYOU_CACHE_FIXTURE_GATE");
 if(r==SQLITE_OK&&w->index&&!paused&&gate){
  char armed[4096],blocked[4096],release[4096];
  if(snprintf(armed,sizeof armed,"%s.armed",gate)>=(int)sizeof armed||snprintf(blocked,sizeof blocked,"%s.blocked",gate)>=(int)sizeof blocked||snprintf(release,sizeof release,"%s.release",gate)>=(int)sizeof release)return SQLITE_IOERR;
  if(access(armed,F_OK)==0){
   paused=1;int fd=open(blocked,O_CREAT|O_EXCL|O_WRONLY,0600);if(fd<0)return SQLITE_IOERR;
   const char marker[]="original main database write completed\n";if(write(fd,marker,sizeof marker-1)!=(ssize_t)(sizeof marker-1)){close(fd);return SQLITE_IOERR;}fsync(fd);close(fd);
   for(int i=0;i<400&&access(release,F_OK)!=0;i++)usleep(20000);
   if(access(release,F_OK)!=0)return SQLITE_IOERR;
  }
 }
 return r;
}
static int truncate_file(sqlite3_file *f,sqlite3_int64 n){File *w=(File *)f;return w->real->pMethods->xTruncate(w->real,n);}
static int sync_file(sqlite3_file *f,int flags){File *w=(File *)f;return w->real->pMethods->xSync(w->real,flags);}
static int size_file(sqlite3_file *f,sqlite3_int64 *n){File *w=(File *)f;return w->real->pMethods->xFileSize(w->real,n);}
static int lock_file(sqlite3_file *f,int n){File *w=(File *)f;return w->real->pMethods->xLock(w->real,n);}
static int unlock_file(sqlite3_file *f,int n){File *w=(File *)f;return w->real->pMethods->xUnlock(w->real,n);}
static int reserved_file(sqlite3_file *f,int *n){File *w=(File *)f;return w->real->pMethods->xCheckReservedLock(w->real,n);}
static int control_file(sqlite3_file *f,int op,void *p){File *w=(File *)f;return w->real->pMethods->xFileControl(w->real,op,p);}
static int sector_file(sqlite3_file *f){File *w=(File *)f;return w->real->pMethods->xSectorSize(w->real);}
static int characteristics_file(sqlite3_file *f){File *w=(File *)f;return w->real->pMethods->xDeviceCharacteristics(w->real);}
static int map_file(sqlite3_file *f,int p,int n,int e,void volatile **v){File *w=(File *)f;return w->real->pMethods->iVersion>=2?w->real->pMethods->xShmMap(w->real,p,n,e,v):SQLITE_IOERR;}
static int shmlock_file(sqlite3_file *f,int o,int n,int flags){File *w=(File *)f;return w->real->pMethods->iVersion>=2?w->real->pMethods->xShmLock(w->real,o,n,flags):SQLITE_IOERR;}
static void barrier_file(sqlite3_file *f){File *w=(File *)f;if(w->real->pMethods->iVersion>=2)w->real->pMethods->xShmBarrier(w->real);}
static int unmap_file(sqlite3_file *f,int n){File *w=(File *)f;return w->real->pMethods->iVersion>=2?w->real->pMethods->xShmUnmap(w->real,n):SQLITE_OK;}
static int fetch_file(sqlite3_file *f,sqlite3_int64 o,int n,void **p){File *w=(File *)f;if(w->real->pMethods->iVersion>=3)return w->real->pMethods->xFetch(w->real,o,n,p);*p=0;return SQLITE_OK;}
static int unfetch_file(sqlite3_file *f,sqlite3_int64 o,void *p){File *w=(File *)f;return w->real->pMethods->iVersion>=3?w->real->pMethods->xUnfetch(w->real,o,p):SQLITE_OK;}
static const sqlite3_io_methods methods={3,close_file,read_file,write_file,truncate_file,sync_file,size_file,lock_file,unlock_file,reserved_file,control_file,sector_file,characteristics_file,map_file,shmlock_file,barrier_file,unmap_file,fetch_file,unfetch_file};
static int open_file(sqlite3_vfs *v,const char *name,sqlite3_file *file,int flags,int *out){
 File *w=(File *)file;memset(w,0,sizeof *w);w->real=(sqlite3_file *)(w+1);
 int r=parent(v)->xOpen(parent(v),name,w->real,flags,out);if(r!=SQLITE_OK)return r;
 const char suffix[]="/cache/mail/index.sqlite";size_t n=name?strlen(name):0;
 w->index=name&&n>=sizeof suffix-1&&strcmp(name+n-(sizeof suffix-1),suffix)==0;file->pMethods=&methods;return SQLITE_OK;
}
static int delete_vfs(sqlite3_vfs *v,const char *n,int sync){return parent(v)->xDelete(parent(v),n,sync);}
static int access_vfs(sqlite3_vfs *v,const char *n,int flags,int *out){return parent(v)->xAccess(parent(v),n,flags,out);}
static int path_vfs(sqlite3_vfs *v,const char *n,int size,char *out){return parent(v)->xFullPathname(parent(v),n,size,out);}
static void *dlopen_vfs(sqlite3_vfs *v,const char *n){return parent(v)->xDlOpen(parent(v),n);}
static void dlerror_vfs(sqlite3_vfs *v,int n,char *out){parent(v)->xDlError(parent(v),n,out);}
static void (*dlsym_vfs(sqlite3_vfs *v,void *p,const char *n))(void){return parent(v)->xDlSym(parent(v),p,n);}
static void dlclose_vfs(sqlite3_vfs *v,void *p){parent(v)->xDlClose(parent(v),p);}
static int random_vfs(sqlite3_vfs *v,int n,char *out){return parent(v)->xRandomness(parent(v),n,out);}
static int sleep_vfs(sqlite3_vfs *v,int n){return parent(v)->xSleep(parent(v),n);}
static int time_vfs(sqlite3_vfs *v,double *out){return parent(v)->xCurrentTime(parent(v),out);}
static int error_vfs(sqlite3_vfs *v,int n,char *out){return parent(v)->xGetLastError(parent(v),n,out);}
static int time64_vfs(sqlite3_vfs *v,sqlite3_int64 *out){return parent(v)->xCurrentTimeInt64(parent(v),out);}
#ifdef _WIN32
__declspec(dllexport)
#endif
int sqlite3_extension_init(sqlite3 *db,char **error,const sqlite3_api_routines *api){
 (void)db;(void)error;sqlite3_vfs *original=api->vfs_find(0);if(!original)return SQLITE_ERROR;
 wrapped=*original;wrapped.iVersion=2;wrapped.szOsFile=(int)(sizeof(File)+original->szOsFile);wrapped.zName="willyou-private-cache-crash-fixture";wrapped.pAppData=original;
 wrapped.xOpen=open_file;wrapped.xDelete=delete_vfs;wrapped.xAccess=access_vfs;wrapped.xFullPathname=path_vfs;wrapped.xDlOpen=dlopen_vfs;wrapped.xDlError=dlerror_vfs;wrapped.xDlSym=dlsym_vfs;wrapped.xDlClose=dlclose_vfs;wrapped.xRandomness=random_vfs;wrapped.xSleep=sleep_vfs;wrapped.xCurrentTime=time_vfs;wrapped.xGetLastError=error_vfs;wrapped.xCurrentTimeInt64=time64_vfs;
 return api->vfs_register(&wrapped,1);
}
