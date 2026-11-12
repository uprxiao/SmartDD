import {afterEach,describe,expect,it} from 'vitest';
import {lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {copyPluginDataTree} from '../data-tree';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const root=()=>{const value=realpathSync(mkdtempSync(join(tmpdir(),'willyou-m13-data-')));roots.push(value);return value;};
describe('private plugin data candidate copies',()=>{
  it('preserves original bytes and owner executable/read-only bits without sharing file inodes',()=>{
    const r=root(),from=join(r,'original'),to=join(r,'candidate');mkdirSync(from);mkdirSync(join(from,'nested'));
    writeFileSync(join(from,'nested/script.sh'),'#!/bin/sh\nexit 0\n',{mode:0o700});writeFileSync(join(from,'state.bin'),Buffer.from([0,255,1]),{mode:0o400});
    copyPluginDataTree(from,to);
    expect(readFileSync(join(to,'state.bin'))).toEqual(Buffer.from([0,255,1]));expect(lstatSync(join(to,'state.bin')).mode&0o700).toBe(0o400);expect(lstatSync(join(to,'nested/script.sh')).mode&0o700).toBe(0o700);
    expect(lstatSync(join(to,'state.bin')).ino).not.toBe(lstatSync(join(from,'state.bin')).ino);expect(readFileSync(join(from,'state.bin'))).toEqual(Buffer.from([0,255,1]));
  });
  it('refuses links before copying or touching the original tree',()=>{
    const r=root(),from=join(r,'original');mkdirSync(from);writeFileSync(join(r,'foreign'),'untouched');symlinkSync(join(r,'foreign'),join(from,'escape'));
    expect(()=>copyPluginDataTree(from,join(r,'candidate'))).toThrow('链接');expect(readFileSync(join(r,'foreign'),'utf8')).toBe('untouched');
  });
});
