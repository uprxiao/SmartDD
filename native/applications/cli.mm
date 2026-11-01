#import <Foundation/Foundation.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <poll.h>
#include <signal.h>
#include <fcntl.h>
#include <cerrno>
#include <cstring>
#include <chrono>
#include <string>

// Native, fixed executable identity; no shell, third-party library, credentials or token files.
static constexpr size_t requestLimit=256*1024,responseLimit=1024*1024;
static void output(id value){NSData *data=[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingFragmentsAllowed error:nil];if(!data){fputs("{\"error\":{\"code\":\"INVALID_RESPONSE\"}}\n",stdout);return;}fwrite(data.bytes,1,data.length,stdout);fputc('\n',stdout);}
static int failure(NSString *code,NSString *message,int exitCode,NSString *layer=@"config",NSString *effect=@"not-started"){
  output(@{@"error":@{@"code":code,@"message":message,@"layer":layer,@"retryable":@NO,@"attemptCount":@0,@"retryExhausted":@NO,@"effectState":effect,@"nextAction":exitCode==5?@"核对原操作记录，不要自动重发":@"核对当前应用状态后再明确操作"}});
  fprintf(stderr,"willyou-app: %s\n",code.UTF8String);return exitCode;
}
static bool matches(NSString *value,NSString *pattern){return value&&[value rangeOfString:pattern options:NSRegularExpressionSearch].location!=NSNotFound;}
static int refused(NSDictionary *response){
  NSDictionary *error=[response[@"error"] isKindOfClass:NSDictionary.class]?response[@"error"]:nil;if(!error)return failure(@"INVALID_RESPONSE",@"宿主错误结果无效",4,@"bridge");
  NSString *code=[error[@"code"] isKindOfClass:NSString.class]?error[@"code"]:@"CAPABILITY_UNAVAILABLE";if(!matches(code,@"^[A-Z][A-Z0-9_]{0,63}$"))return failure(@"INVALID_RESPONSE",@"宿主错误标识无效",4,@"bridge");
  NSMutableDictionary *value=[@{@"error":error} mutableCopy];if([response[@"operationId"] isKindOfClass:NSString.class])value[@"operationId"]=response[@"operationId"];output(value);fprintf(stderr,"willyou-app: %s\n",code.UTF8String);
  return [error[@"effectState"] isEqual:@"unknown"]?5:2;
}
static long long milliseconds(){return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();}
static bool ready(int fd,short events,long long until){while(true){long long left=until-milliseconds();if(left<=0)return false;pollfd item{fd,events,0};int rc=poll(&item,1,(int)left);if(rc>0)return (item.revents&events)!=0;if(rc<0&&errno==EINTR)continue;return false;}}
static NSDictionary *exchange(int fd,NSDictionary *request,int budget,bool &sent){
  NSData *bytes=[NSJSONSerialization dataWithJSONObject:request options:0 error:nil];if(!bytes||bytes.length>requestLimit)return nil;std::string message((const char*)bytes.bytes,bytes.length);message+='\n';auto until=milliseconds()+budget;size_t offset=0;
  while(offset<message.size()){if(!ready(fd,POLLOUT,until))return nil;ssize_t n=write(fd,message.data()+offset,message.size()-offset);if(n<0&&(errno==EINTR||errno==EAGAIN||errno==EWOULDBLOCK))continue;if(n<=0)return nil;offset+=(size_t)n;}sent=true;
  std::string response;while(response.size()<=responseLimit){if(!ready(fd,POLLIN,until))return nil;char chunk[8192];ssize_t n=read(fd,chunk,sizeof(chunk));if(n<0&&(errno==EINTR||errno==EAGAIN||errno==EWOULDBLOCK))continue;if(n<=0)return nil;response.append(chunk,(size_t)n);size_t line=response.find('\n');if(line==std::string::npos)continue;if(line>responseLimit||line+1!=response.size())return nil;NSData *data=[NSData dataWithBytes:response.data() length:line];id parsed=[NSJSONSerialization JSONObjectWithData:data options:0 error:nil];if(![parsed isKindOfClass:NSDictionary.class]||![parsed[@"schema"] isEqual:@1]||![parsed[@"id"] isEqual:request[@"id"]])return nil;return parsed;}return nil;
}
int main(int argc,const char *argv[]){@autoreleasepool{
  signal(SIGPIPE,SIG_IGN);
  NSMutableArray<NSString*> *args=[NSMutableArray array];for(int i=1;i<argc;i++){NSString *arg=[[NSString alloc] initWithUTF8String:argv[i]];if(!arg)return failure(@"INVALID_INPUT",@"参数必须是完整UTF-8",2);[args addObject:arg];}
  if(args.count==1&&[args[0] isEqual:@"--help"]){output(@{@"command":@"willyou-app",@"usage":@[@"willyou-app --list",@"willyou-app <app> <command> [--field value]",@"willyou-app <app> <command> --json '<JSON object>'"],@"scope":@"当前WillYou终端已启用的应用能力",@"resultContractMajor":@2});return 0;}
  const char *rawToken=getenv("WILLYOU_RUN_TOKEN"),*rawEndpoint=getenv("WILLYOU_ENDPOINT");NSString *token=rawToken?[[NSString alloc] initWithUTF8String:rawToken]:nil;NSString *endpoint=rawEndpoint?[[NSString alloc] initWithUTF8String:rawEndpoint]:nil;
  if(!matches(token,@"^[a-f0-9]{64}$")||!endpoint||![endpoint hasPrefix:@"/"]||[endpoint rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location!=NSNotFound)return failure(@"AUTH_REQUIRED",@"请在WillYou受管终端中使用应用能力",3,@"auth");
  bool list=args.count==1&&[args[0] isEqual:@"--list"];NSMutableArray<NSString*> *command=[NSMutableArray array];NSMutableDictionary *arguments=[NSMutableDictionary dictionary];bool json=false;
  NSSet *reserved=[NSSet setWithArray:@[@"token",@"endpoint",@"runId",@"run-id",@"projectId",@"project-id",@"connectionId",@"connection-id",@"approved"]];
  if(!list){for(NSUInteger i=0;i<args.count;i++){
    NSString *arg=args[i];if(![arg hasPrefix:@"--"]){if(arguments.count||json||!matches(arg,@"^[a-z][a-z0-9-]{0,63}$"))return failure(@"INVALID_INPUT",@"命令段无效",2);[command addObject:arg];continue;}
    NSString *key=[arg substringFromIndex:2];if(!matches(key,@"^[a-zA-Z][a-zA-Z0-9-]{0,63}$")||[reserved containsObject:key]||i+1>=args.count)return failure(@"INVALID_INPUT",@"此参数不能用于应用调用",2);
    NSString *value=args[++i];if([key isEqual:@"json"]){if(json||arguments.count)return failure(@"INVALID_INPUT",@"JSON参数不能与字段参数混用",2);NSData *bytes=[value dataUsingEncoding:NSUTF8StringEncoding];id object=bytes.length<=requestLimit?[NSJSONSerialization JSONObjectWithData:bytes options:0 error:nil]:nil;if(![object isKindOfClass:NSDictionary.class])return failure(@"INVALID_INPUT",@"需要有界JSON对象参数",2);arguments=[object mutableCopy];json=true;}
    else{if(json||arguments[key])return failure(@"INVALID_INPUT",@"参数重复或混用",2);NSData *bytes=[value dataUsingEncoding:NSUTF8StringEncoding];id parsed=bytes.length<=requestLimit?[NSJSONSerialization JSONObjectWithData:bytes options:NSJSONReadingFragmentsAllowed error:nil]:nil;arguments[key]=parsed?:value;}
  }if(command.count<2||command.count>8)return failure(@"INVALID_INPUT",@"请使用已列出的应用命令",2);}
  sockaddr_un address{};address.sun_family=AF_UNIX;const char *path=endpoint.fileSystemRepresentation;if(!path||strlen(path)>=sizeof(address.sun_path))return failure(@"INVALID_INPUT",@"应用端点无效",3,@"auth");strcpy(address.sun_path,path);
  int fd=socket(AF_UNIX,SOCK_STREAM,0);if(fd<0)return failure(@"CONNECTION_UNAVAILABLE",@"应用通道不可用",4,@"bridge");if(fcntl(fd,F_SETFL,fcntl(fd,F_GETFL)|O_NONBLOCK)<0){close(fd);return failure(@"CONNECTION_UNAVAILABLE",@"应用通道不可用",4,@"bridge");}if(connect(fd,(sockaddr*)&address,sizeof(address))!=0){int code=errno,error=0;socklen_t size=sizeof(error);if((code!=EINPROGRESS&&code!=EAGAIN)||!ready(fd,POLLOUT,milliseconds()+3000)||getsockopt(fd,SOL_SOCKET,SO_ERROR,&error,&size)!=0||error){close(fd);return failure(@"CONNECTION_UNAVAILABLE",@"应用通道未连接",4,@"bridge");}}
  NSDictionary *discovery=@{@"schema":@"willyou-cli-v1",@"id":NSUUID.UUID.UUIDString.lowercaseString,@"token":token,@"method":@"capabilities/list"};bool sent=false;NSDictionary *listed=exchange(fd,discovery,10000,sent);
  if(!listed){close(fd);return failure(@"CONNECTION_UNAVAILABLE",@"应用能力发现未完成",4,@"bridge");}if(![listed[@"status"] isEqual:@"ok"]){close(fd);return refused(listed);}NSDictionary *catalog=[listed[@"value"] isKindOfClass:NSDictionary.class]?listed[@"value"]:nil;NSArray *capabilities=[catalog[@"capabilities"] isKindOfClass:NSArray.class]?catalog[@"capabilities"]:nil;if(!capabilities){close(fd);return failure(@"INVALID_RESPONSE",@"应用能力列表无效",4,@"bridge");}
  if(list){close(fd);output(catalog);return 0;}
  NSDictionary *selected=nil;for(id item in capabilities)if([item isKindOfClass:NSDictionary.class]&&[item[@"command"] isEqual:command]){if(selected){close(fd);return failure(@"INVALID_RESPONSE",@"应用命令不唯一",4,@"bridge");}selected=item;}
  if(!selected||![selected[@"id"] isKindOfClass:NSString.class]||![selected[@"contractMajor"] isKindOfClass:NSNumber.class]){close(fd);return failure(@"SCOPE_DENIED",@"本次运行没有启用这项应用命令",2,@"auth");}
  NSDictionary *call=@{@"schema":@"willyou-cli-v1",@"id":NSUUID.UUID.UUIDString.lowercaseString,@"token":token,@"method":@"capabilities/call",@"call":@{@"operation":selected[@"id"],@"contractMajor":selected[@"contractMajor"],@"connectionId":NSNull.null,@"arguments":arguments}};NSData *input=[NSJSONSerialization dataWithJSONObject:call options:0 error:nil];if(!input||input.length>requestLimit){close(fd);return failure(@"TOO_LARGE",@"应用参数超过预算",2);}
  bool readOnly=[selected[@"annotations"] isKindOfClass:NSDictionary.class]&&[selected[@"annotations"][@"readOnlyHint"] isEqual:@YES];sent=false;NSDictionary *response=exchange(fd,call,125000,sent);close(fd);
  if(!response)return failure(@"CONNECTION_UNAVAILABLE",@"应用调用结果未返回",sent&&!readOnly?5:4,@"bridge",sent?(readOnly?@"read-only":@"unknown"):@"not-started");if(![response[@"status"] isEqual:@"ok"])return refused(response);id value=response[@"value"];if(![value isKindOfClass:NSDictionary.class]||![value[@"schema"] isEqual:@"willyou-app-result-v2"]||![value[@"capabilityId"] isEqual:selected[@"id"]]||![value[@"contractMajor"] isEqual:@2])return failure(@"INVALID_RESPONSE",@"应用结果契约无效",sent&&!readOnly?5:4,@"bridge",readOnly?@"read-only":@"unknown");output(value);return [value[@"operation"][@"effectState"] isEqual:@"unknown"]?5:0;
}}
