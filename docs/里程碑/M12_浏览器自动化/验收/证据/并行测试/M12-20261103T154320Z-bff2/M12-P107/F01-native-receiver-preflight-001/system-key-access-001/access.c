#include <ApplicationServices/ApplicationServices.h>
#include <stdio.h>
int main(void){int ax=AXIsProcessTrusted();int post=CGPreflightPostEventAccess();printf("{\"AXIsProcessTrusted\":%s,\"CGPreflightPostEventAccess\":%s,\"promptsRequested\":false,\"eventsPosted\":0}\n",ax?"true":"false",post?"true":"false");return 0;}
