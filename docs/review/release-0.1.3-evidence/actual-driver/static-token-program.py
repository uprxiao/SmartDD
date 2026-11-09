import os,re,json,hashlib,base64,pathlib
token=os.environ.get("WILLYOU_RUN_TOKEN","")
assert re.fullmatch(r"[a-f0-9]{64}",token), "own runtime token must be64hex"
raw=token.encode("ascii")
forms={"raw64hex":raw,"base64":base64.b64encode(raw),"utf16le":token.encode("utf-16le"),"utf16be":token.encode("utf-16be")}
receipt={"schema":"release013-own-token-digests-v1","tokenLength":len(token),"hashes":{k:hashlib.sha256(v).hexdigest() for k,v in forms.items()}}
pathlib.Path("/private/tmp/willyou-m12-release-0.1.3/launcher-prep/attempt-005/static-only-token-digests.json").write_text(json.dumps(receipt,sort_keys=True))
del token,raw,forms
