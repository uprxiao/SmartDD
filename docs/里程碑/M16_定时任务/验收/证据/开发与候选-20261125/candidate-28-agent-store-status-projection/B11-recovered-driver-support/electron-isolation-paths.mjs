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

const m14Root = '/private/tmp/willyou-m14-stage6\\.[A-Za-z0-9]{6}';
const m14Home = new RegExp('^(' + m14Root + ')/g0[1-4]/attempt-\\d{3}(?:/[A-Za-z0-9_-]+)*/home$');
const m14Executable = new RegExp('^(' + m14Root + ')/package/mac-arm64/WillYou\\.app/Contents/MacOS/WillYou$');

export function isM14HomePath(home) {
  return typeof home === 'string' && m14Home.test(home);
}

export function isM14PreEntryRun(executable, userData, home) {
  if (typeof executable !== 'string' || typeof userData !== 'string' || !isM14HomePath(home)) return false;
  const packageRoot = m14Executable.exec(executable)?.[1];
  const homeRoot = m14Home.exec(home)?.[1];
  return packageRoot === homeRoot && packageRoot !== undefined &&
    ['data', 'userdata', 'user-data'].some(name => userData === home.replace(/home$/, name));
}
