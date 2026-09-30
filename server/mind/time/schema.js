export function migrateTime(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mind_time_projects(id TEXT PRIMARY KEY,created INTEGER NOT NULL,updated INTEGER NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,why TEXT NOT NULL DEFAULT '',state TEXT NOT NULL DEFAULT 'active',session_id TEXT,discretion TEXT NOT NULL DEFAULT 'open',sources TEXT NOT NULL DEFAULT '[]',bible TEXT NOT NULL DEFAULT '{}',summary TEXT NOT NULL DEFAULT '',serial INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS mind_time_tasks(id TEXT PRIMARY KEY,created INTEGER NOT NULL,updated INTEGER NOT NULL,kind TEXT NOT NULL,activity TEXT NOT NULL,title TEXT NOT NULL,why TEXT NOT NULL DEFAULT '',state TEXT NOT NULL DEFAULT 'todo',ready_at INTEGER NOT NULL,due_at INTEGER,session_id TEXT,subject TEXT,discretion TEXT NOT NULL DEFAULT 'open',sources TEXT NOT NULL DEFAULT '[]',anticipation_id TEXT UNIQUE,project_id TEXT,work_id TEXT,checkpoint TEXT NOT NULL DEFAULT '{}',revision INTEGER NOT NULL DEFAULT 1,next_step INTEGER NOT NULL DEFAULT 0,wait_reason TEXT NOT NULL DEFAULT '',share_state TEXT NOT NULL DEFAULT 'none',share_reason TEXT NOT NULL DEFAULT '',depends_on TEXT,lease TEXT,lease_at INTEGER,completed INTEGER);
    CREATE INDEX IF NOT EXISTS mind_time_tasks_queue ON mind_time_tasks(state,ready_at,next_step);
    CREATE UNIQUE INDEX IF NOT EXISTS mind_time_single_main ON mind_time_tasks((1)) WHERE state='doing';
    CREATE TABLE IF NOT EXISTS mind_time_spans(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,started INTEGER NOT NULL,updated INTEGER NOT NULL,ended INTEGER,active_ms INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS mind_time_spans_task ON mind_time_spans(task_id,started);
    CREATE TABLE IF NOT EXISTS mind_time_events(id INTEGER PRIMARY KEY,created INTEGER NOT NULL,task_id TEXT,kind TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',data TEXT NOT NULL DEFAULT '{}');
    CREATE INDEX IF NOT EXISTS mind_time_events_time ON mind_time_events(created);
    CREATE TABLE IF NOT EXISTS mind_time_works(id TEXT PRIMARY KEY,created INTEGER NOT NULL,updated INTEGER NOT NULL,task_id TEXT,project_id TEXT,ordinal INTEGER NOT NULL DEFAULT 1,title TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'draft',version INTEGER NOT NULL DEFAULT 0,session_id TEXT,discretion TEXT NOT NULL DEFAULT 'open',legacy_creation TEXT UNIQUE,UNIQUE(project_id,ordinal));
    CREATE TABLE IF NOT EXISTS mind_time_versions(id TEXT PRIMARY KEY,work_id TEXT NOT NULL,version INTEGER NOT NULL,created INTEGER NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '',sources TEXT NOT NULL DEFAULT '[]',run_id TEXT,UNIQUE(work_id,version));
    CREATE INDEX IF NOT EXISTS mind_time_versions_work ON mind_time_versions(work_id,version);
    CREATE INDEX IF NOT EXISTS mind_time_works_recent ON mind_time_works(updated DESC);
    CREATE INDEX IF NOT EXISTS mind_time_works_task ON mind_time_works(task_id);
    CREATE INDEX IF NOT EXISTS mind_time_projects_recent ON mind_time_projects(updated DESC);
    CREATE TABLE IF NOT EXISTS mind_time_sources(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,created INTEGER NOT NULL,title TEXT NOT NULL,url TEXT NOT NULL,content TEXT NOT NULL,hash TEXT NOT NULL,UNIQUE(project_id,url,hash));
    CREATE TABLE IF NOT EXISTS mind_time_searches(id INTEGER PRIMARY KEY,created INTEGER NOT NULL,provider TEXT NOT NULL,query TEXT NOT NULL,state TEXT NOT NULL,error TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS mind_time_shares(id TEXT PRIMARY KEY,created INTEGER NOT NULL,updated INTEGER NOT NULL,work_id TEXT NOT NULL,version INTEGER NOT NULL,session_id TEXT NOT NULL,offset INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL DEFAULT 'pending',reason TEXT NOT NULL DEFAULT '',trace_id TEXT,UNIQUE(work_id,version,session_id));
  `);
}
