import assert from 'node:assert/strict';
import { pause } from './electron-harness.mjs';

// Real CDP key events only; observations never set DOM/media state or send PTY data.
export async function runMediaKeyboard(app, { prototype, terminal, receive, theme, record }) {
  const frame = prototype ? '.fw-video-frame' : 'video';
  const playing = prototype ? '!!document.querySelector(\'[aria-label="暂停"]\')' : '!document.querySelector("video").paused';
  const state = () => app.evaluate(`({playing:${playing},focus:document.activeElement?.getAttribute('aria-label'),position:${prototype ? '+document.querySelector(\'[aria-label="播放进度"]\').value' : 'document.querySelector("video").currentTime'},frames:document.querySelector('video')?.getVideoPlaybackQuality().totalVideoFrames})`);
  await app.evaluate(`(()=>{const t={keys:[]};t.listener=e=>{const r={key:e.key,repeat:e.repeat,trusted:e.isTrusted,target:e.target.getAttribute?.('aria-label'),tag:e.target.tagName};t.keys.push(r);setTimeout(()=>r.prevented=e.defaultPrevented,0)};window.__mediaKeyboard=t;window.addEventListener('keydown',t.listener,true);return true})()`);
  const press = async (key, repeat = false) => {
    const count = await app.evaluate('__mediaKeyboard.keys.length');
    await app.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key === ' ' ? 'Space' : 'Enter', windowsVirtualKeyCode: key === ' ' ? 32 : 13, nativeVirtualKeyCode: key === ' ' ? 49 : 36, text: key === ' ' ? ' ' : '\r', autoRepeat: repeat });
    await app.waitFor(`__mediaKeyboard.keys.length===${count + 1}&&typeof __mediaKeyboard.keys[${count}].prevented==='boolean'`);
    return app.evaluate(`__mediaKeyboard.keys[${count}]`);
  };
  const release = key => app.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key === ' ' ? 'Space' : 'Enter', windowsVirtualKeyCode: key === ' ' ? 32 : 13, nativeVirtualKeyCode: key === ' ' ? 49 : 36 });
  try {
    for (const key of [' ', 'Enter']) for (const target of [true, false]) {
      await app.click(frame);
      await app.waitFor(`document.activeElement===document.querySelector(${JSON.stringify(frame)})`);
      const before = await state();
      assert.equal(before.playing, !target);
      const keys = [await press(key)];
      await app.waitFor(`(${playing})===${target}`);
      const samples = [await state()];
      for (let i = 0; i < 11; i++) {
        await pause(40); keys.push(await press(key, true));
        samples.push(await state()); assert.equal(samples.at(-1).playing, target);
      }
      await release(key);
      assert(keys.every(x => x.trusted && x.prevented && x.target === '视频画面'), JSON.stringify(keys));
      assert.equal(keys.filter(x => !x.repeat).length, 1);
      assert.equal(keys.filter(x => x.repeat).length, 11);
      await record({ theme, scenario: `${key === ' ' ? 'Space' : 'Enter'} to ${target ? 'playing' : 'paused'} with 11 repeats`, before, samples, keys });
    }
    for (const target of [true, false]) {
      // Set the intended playback state through the ordinary UI button.
      await app.click(target ? '[aria-label="播放"]' : '[aria-label="暂停"]');
      await app.waitFor(`(${playing})===${target}`);
      const destination = typeof terminal === 'function' ? terminal(target) : terminal;
      await app.click(destination.click);
      await app.waitFor(`document.activeElement===document.querySelector(${JSON.stringify(destination.focus)})`);
      const before = await state(), keys = [], samples = [];
      for (const key of [' ', 'Enter']) {
        keys.push(await press(key));
        for (let i = 0; i < 11; i++) { await pause(40); keys.push(await press(key, true)); samples.push(await state()); assert.equal(samples.at(-1).playing, target); }
        await release(key);
      }
      assert(keys.every(x => x.trusted && x.target !== '视频画面'));
      const receiver = await receive(' '.repeat(12) + (prototype ? '\n' : '\r').repeat(12), target);
      await record({ theme, scenario: `terminal input while video ${target ? 'playing' : 'paused'}`, before, after: await state(), keys, samples, receiver });
    }
  } finally {
    await app.evaluate("(()=>{const t=window.__mediaKeyboard;window.removeEventListener('keydown',t.listener,true);delete window.__mediaKeyboard;return true})()");
  }
}
