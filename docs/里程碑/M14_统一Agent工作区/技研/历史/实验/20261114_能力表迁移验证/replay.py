"""Rebuild actual source DDL in a temporary directory; never open the application DB."""
from pathlib import Path
import hashlib,importlib.util,json,sqlite3,sys,tempfile,unittest
root=Path(__file__).resolve().parent
repo=Path(sys.argv[1]).resolve()
rows=json.loads((root/'schema-inventory.json').read_text())['sourceFiles']
for row in rows:
 assert hashlib.sha256((repo/row['file']).read_bytes()).hexdigest()==row['sha256'],row['file']
spec=importlib.util.spec_from_file_location('probe',root/'attempt-2'/'probe.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory(prefix='willyou-cap-replay-') as scratch:
 m.BASE=Path(scratch);m.REPO=repo
 db=sqlite3.connect(m.BASE/'baseline.sqlite')
 for row in rows:db.executescript((repo/row['file']).read_text())
 assert not db.execute('PRAGMA foreign_key_check').fetchall()
 db.close()
 result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(m.Probe))
 sys.exit(0 if result.wasSuccessful() else 1)
