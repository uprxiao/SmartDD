import {describe,expect,it} from 'vitest';
import {pluginHostReadOnlyRoots} from '../host-paths';

describe('host supplied plugin program boundary',()=>{
  it('covers the complete bundle as well as the unpacked development project',()=>{
    expect(pluginHostReadOnlyRoots('/work/WillYou source','/work/node_modules/Electron.app/Contents/MacOS/Electron'))
      .toEqual(['/work/WillYou source','/work/node_modules/Electron.app']);
    expect(pluginHostReadOnlyRoots('/Apps/WillYou.app/Contents/Resources/app.asar','/Apps/WillYou.app/Contents/MacOS/WillYou'))
      .toEqual(['/Apps/WillYou.app/Contents/Resources/app.asar','/Apps/WillYou.app']);
  });
  it.each(['/usr/local/bin/node','relative/WillYou.app/Contents/MacOS/WillYou','/Apps/WillYou/Contents/MacOS/WillYou'])('refuses an unknown executable layout instead of guessing a broad parent: %s',executable=>{
    expect(()=>pluginHostReadOnlyRoots('/work/project',executable)).toThrow(expect.objectContaining({code:'HOST_INCOMPATIBLE'}));
  });
});
