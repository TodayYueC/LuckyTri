<p align="right"><a href="../zh/recovery.md">中文</a> · <b>English</b></p>

# Data: backup, migration and recovery

Everything of her — memory, self, diary, relationships — lives in one SQLite database. This document explains how to keep it safe, how to verify a backup and how to restore.

## Backup

The database uses WAL, FULL durability and write-lock waiting. Run `npm run backup` before upgrading; while running, automatic backups still happen on the configured schedule. Both full and automatic backups are written to a temporary file first, published only after SQLite integrity and reference checks, and accompanied by a `.db.json` manifest: SHA-256, application version, database version, schema signature and the number of life records. When copying a backup, copy both files together to another disk.

## Verify and restore

```powershell
npm run recovery -- verify --backup "data/backups/some-backup.db"
npm run recovery -- restore --backup "data/backups/some-backup.db" --to "data/recovered-life.db"
```

Restore only publishes to a brand-new file; it refuses when the target or its WAL/SHM files already exist. The manifest and integrity are checked before restoring and the new file is checked afterwards; the running instance and its database are never overwritten. An old backup without a manifest can still be checked and restored, and the command says it has no SHA-256 manifest.

After verifying the restored copy, stop the original instance, set `DB_PATH` for the instance you want to point at the new file, and start it. Keep the original database and backups until you are sure the restored experiences, self, diary, relationships and permissions are what you expect. To test a restored copy, use another port and simulation mode so no second QQ connection is made.

## Migration

The schema version is stored in `PRAGMA user_version`. Before the first migration of an existing database, a checked `luckytri-migration-*.db` snapshot and manifest are saved automatically; it does not take part in automatic-backup rotation. The new version is recorded only after the migration succeeds. A database with a newer version opened by an older program is refused read-only, so a downgrade cannot corrupt records. When the schema changes later, bump `DATABASE_VERSION`, keep the migration idempotent and add regression tests for restoring and upgrading old databases.

## Limits

Verification finds corruption and manifest mismatches; the SHA-256 manifest is not a cryptographic signature. A database backup contains the knowledge passages, vectors and reading records already stored in it; external image attachments and the original files in `data/knowledge` must be copied separately. A backup on the same disk cannot survive failure of the whole disk.
