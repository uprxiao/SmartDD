// Synthetic local macOS paths. Percent encoding and backslashes are literal
// filesystem names here; URL decoding and Windows behavior are separate paths.
export const authorityFixtureFiles={
 'safe/允许 空格 中文🙂.txt':'INSIDE legitimate Unicode CRLF\r\n',
 '%2e%2e/outside.txt':'INSIDE percent directory\r\n',
 '%2e%2e%2foutside.txt':'INSIDE percent slash filename\r\n',
 '%252e%252e%252foutside.txt':'INSIDE double percent filename\r\n',
 'encoded%00.txt':'INSIDE percent NUL filename\r\n',
 'C:/outside.txt':'INSIDE POSIX colon directory\r\n',
 'C:\\outside.txt':'INSIDE POSIX backslash filename\r\n',
 '\\\\server\\share\\outside.txt':'INSIDE POSIX UNC-looking filename\r\n',
};
export const authorityLegalPath='safe/允许 空格 中文🙂.txt';
export const authorityRejectedPaths=outside=>[
 {path:'../outside.txt',error:'需要根内相对路径'},
 {path:'safe/../../outside.txt',error:'需要根内相对路径'},
 {path:'./'+authorityLegalPath,error:'需要根内相对路径'},
 {path:outside,error:'需要根内相对路径'},
 {path:'//server/share/outside.txt',error:'需要根内相对路径'},
 {path:'safe/\0outside.txt',error:'需要根内相对路径'},
 {path:'safe//允许 空格 中文🙂.txt',error:'[INVALID_INPUT]'},
 {path:'file://'+outside,error:'[INVALID_INPUT]'},
];
export const authorityForgedScopes=(projectId,foreignDirectoryId,outside)=>[
 {scope:{kind:'project',projectId:'m9-authority-missing-project'},error:'[MISSING]'},
 {scope:{kind:'task',taskId:'m9-authority-missing-task'},error:'[MISSING]'},
 {scope:{kind:'project',projectId:foreignDirectoryId},error:'[MISSING]'},
 {scope:{kind:'project',projectId,dirId:foreignDirectoryId},error:'unrecognized_keys'},
 {scope:{kind:'project',projectId,hostId:'forged-local',root:outside,path:outside},error:'[UNSUPPORTED]'},
 {scope:{kind:'project',projectId,hostId:'local',root:outside,path:outside},error:'unrecognized_keys'},
 {scope:{kind:'task',taskId:'m9-authority-missing-task',projectId,cwd:outside},error:'unrecognized_keys'},
];
