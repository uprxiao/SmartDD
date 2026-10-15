// Runs in the isolated packaged application's main process. Only counts and locations
// leave it; decrypted values never enter the renderer, console, argv or an artifact.
function scanInsideApp(root, extraText) {
  const req = typeof require === 'function' ? require : process.mainModule.require.bind(process.mainModule);
  const { app, safeStorage } = req('electron');
  const fs = req('node:fs');
  const path = req('node:path');
  const scopedRequire = req('node:module').createRequire(path.join(app.getAppPath(), 'package.json'));
  const Database = scopedRequire('better-sqlite3');
  if (path.resolve(app.getPath('userData')) !== path.resolve(root, 'userdata')) throw new Error('Audit requires isolated userData');
  const db = new Database(path.join(root, 'userdata', 'smartdd.db'), { readonly: true });
  const rows = db.prepare('SELECT key, secret FROM app_secrets').all();
  db.close();
  const secrets = rows.map((r) => Buffer.from(safeStorage.decryptString(Buffer.from(r.secret, 'base64')))).filter((b) => b.length);
  const leaks = []; let files = 0;
  const scan = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(file);
      else {
        const bytes = fs.readFileSync(file); files++;
        if (secrets.some((value) => bytes.includes(value))) leaks.push(path.relative(root, file));
      }
    }
  };
  scan(root);
  if (secrets.some((value) => Buffer.from(extraText).includes(value))) leaks.push('live-renderer-or-logs');
  return { credentials: secrets.length, aiCredentials: rows.filter((r) => r.key.startsWith('ai:')).length, files, leaks };
}

export async function auditSecrets(app, root, extraText) {
  return app.mainEvaluate(`(${scanInsideApp.toString()})(${JSON.stringify(root)}, ${JSON.stringify(extraText)})`);
}
