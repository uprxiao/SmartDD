// Explicit M13 acceptance namespace, shared by the pre-entry home fixture and
// launcher. Never enables hooks for a daily App or mismatched private run.
export function isM13HomePath(home){
 return typeof home==='string'&&/^\/private\/tmp\/willyou-m13-p1-App[0-9]{3}-ui-[0-9]{3}\/home$/.test(home);
}
export function isM13PreEntryRun(executable,userData,home){
 if(typeof executable!=='string')return false;
 const match=/^\/private\/tmp\/willyou-m13-p1-(App[0-9]{3})\/(?:baseline\/)?mac-arm64\/WillYou\.app\/Contents\/MacOS\/WillYou$/.exec(executable);
 if(!match||!isM13HomePath(home))return false;
 const run=new RegExp('^/private/tmp/willyou-m13-p1-'+match[1]+'-ui-[0-9]{3}/userdata$');
 return typeof userData==='string'&&run.test(userData)&&home===userData.replace(/\/userdata$/,'/home');
}
