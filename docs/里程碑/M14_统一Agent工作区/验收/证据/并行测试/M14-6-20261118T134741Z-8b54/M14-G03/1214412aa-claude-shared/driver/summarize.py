import json,sys
r=json.load(open(sys.argv[1]))
print(r['status'],r.get('phase'),(r.get('error') or '')[:400])
print([(c['label'][:60],c['ok']) for c in r['checks']])
