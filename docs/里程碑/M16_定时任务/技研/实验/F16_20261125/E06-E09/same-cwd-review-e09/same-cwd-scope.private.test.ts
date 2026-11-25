import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { runBundledMigrations } from '../../db/migrations';
import * as schema from '../../db/schema';
import { AgentStore } from '../agent/agent-store';
import { CapabilityRegistryService, type CapabilityScanContext } from './capability-registry';

it('F16 E09 same physical registered cwd: standalone candidate selection is global-only by actual task membership', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'm16-same-cwd-scope-')));
  const home = join(root, 'home'), projectRoot = join(root, 'repo');
  mkdirSync(home); mkdirSync(projectRoot);
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys=ON');
  runBundledMigrations(sqlite);
  const store = new AgentStore(sqlite);
  const db = drizzle(sqlite, { schema });
  const put = (path: string, content: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };
  try {
    sqlite.prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,?,1,1)').run('fixture-project', 'isolated experiment');
    sqlite.prepare('INSERT INTO project_dirs(id,project_id,label,path,created_at,updated_at) VALUES(?,?,?,?,1,1)').run('fixture-dir', 'fixture-project', 'registered directory', projectRoot);
    put(join(home, '.claude/skills/global-fixture/SKILL.md'), '---\nname: global-fixture\ndescription: public test fixture\n---\nGlobal test.');
    put(join(projectRoot, '.claude/skills/project-fixture/SKILL.md'), '---\nname: project-fixture\ndescription: project test fixture\n---\nProject test.');
    put(join(home, '.claude.json'), JSON.stringify({mcpServers: {'global-mcp': { command: '/usr/bin/true' }}}));
    put(join(projectRoot, '.mcp.json'), JSON.stringify({mcpServers: {'project-mcp': { command: '/usr/bin/true' }}}));
    const contexts: CapabilityScanContext[] = [{
      runner: 'claude', home, stateRoot: join(home, '.claude'), cwd: projectRoot, projectRoot, path: '',
    }];
    const registry = new CapabilityRegistryService(db, () => contexts, () => Date.now());
    registry.scan();
    registry.adoptAll();
    const selection = { driverId: 'codex-app-server' as const, profileId: 'fixture', tier: 'ask' as const };
    const projectTask = store.createTask({ projectId:'fixture-project', dirId:'fixture-dir', cwd:projectRoot, title:'ordinary project task', selection });
    const standaloneTask = store.createTask({ projectId:null, dirId:null, cwd:projectRoot, title:'standalone scheduled task', selection });
    const project = store.task(projectTask)!;
    const standalone = store.task(standaloneTask)!;
    expect(project.cwd).toBe(standalone.cwd);
    expect(project.project_id).toBe('fixture-project');
    expect(standalone.project_id).toBeNull();
    expect(standalone.dir_id).toBeNull();
    const projection = (rows: ReturnType<typeof registry.selected>) => rows.map(({name,kind,projectRoot}) => ({name,kind,scope: projectRoot === null ? 'global' : 'project'})).sort((a,b)=>a.name.localeCompare(b.name));
    const names = (rows: ReturnType<typeof projection>) => rows.map(row=>row.name);
    const ordinaryBaseline = projection(registry.selected(project.cwd));
    const standaloneBaseline = projection(registry.selected(standalone.cwd));
    expect(names(ordinaryBaseline)).toEqual(['global-fixture','global-mcp','project-fixture','project-mcp']);
    expect(standaloneBaseline).toEqual(ordinaryBaseline);

    // Private candidate seam: derive authority from recorded task scope, never
    // from the supplied cwd alone. Have the existing registry perform its
    // domain filtering before conflict/deduplication. No production source edits.
    const selectedForTask = (taskId: string) => {
      const task = store.task(taskId)!;
      if (task.project_id === null) return registry.selected();
      const dir = sqlite.prepare('SELECT path FROM project_dirs WHERE id=? AND project_id=?').get(task.dir_id,task.project_id) as {path:string};
      expect(realpathSync(dir.path)).toBe(realpathSync(task.cwd));
      return registry.selected(dir.path);
    };
    const standaloneCandidate = projection(selectedForTask(standaloneTask));
    const projectCandidate = projection(selectedForTask(projectTask));
    expect(names(standaloneCandidate)).toEqual(['global-fixture','global-mcp']);
    expect(standaloneCandidate.every(row=>row.scope==='global')).toBe(true);
    expect(projectCandidate).toEqual(ordinaryBaseline);
    expect(sqlite.prepare('SELECT count(*) AS n FROM projects').get()).toEqual({n:1});
    console.log(JSON.stringify({
      case:'E09-same-cwd-explicit-scope',
      samePhysicalCwd:projectRoot,
      actualTaskProjectMembership:[project.project_id,standalone.project_id],
      ordinaryBaseline, standaloneBaseline, standaloneCandidate, projectCandidate,
      noNewProject:true,
      baselineCommit:'a0acddb3a2325c6bf732adaa7e954ce4d767a2c3',
      boundary:'actual local registry/discovery/SQLite; explicit scope-selection candidate only; no native model, tool invocation, GUI, production integration',
    }));
  } finally { sqlite.close(); rmSync(root,{recursive:true,force:true}); }
});
