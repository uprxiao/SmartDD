import zipfile,os,sys,stat
src,out=sys.argv[1],sys.argv[2];os.makedirs(out,exist_ok=True)
def base(z):
    for d,_,fs in os.walk(src):
        for f in sorted(fs):
            p=os.path.join(d,f);z.write(p,os.path.relpath(p,src))
with zipfile.ZipFile(f'{out}/good.zip','w',zipfile.ZIP_DEFLATED) as z: base(z)
with zipfile.ZipFile(f'{out}/symlink.zip','w') as z:
    base(z);i=zipfile.ZipInfo('runtime/link');i.create_system=3;i.external_attr=(stat.S_IFLNK|0o777)<<16;z.writestr(i,'/Users')
with zipfile.ZipFile(f'{out}/traversal.zip','w') as z: base(z);z.writestr('../../evil.mjs','x')
with zipfile.ZipFile(f'{out}/absolute.zip','w') as z:
    base(z);i=zipfile.ZipInfo('x');i.filename='/tmp/evil-abs';z.writestr(i,'x')
with zipfile.ZipFile(f'{out}/bomb.zip','w',zipfile.ZIP_DEFLATED) as z: base(z);z.writestr('assets/big.bin',b'\0'*(70*1024*1024))
print('ok')
