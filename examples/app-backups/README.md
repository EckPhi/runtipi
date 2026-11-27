# App-defined backup and restore

An app's `config.json` can optionally define:

```json
{
  "backup": {
    "stop": false,
    "include": ["backup-dump.sql", "config"]
  }
}
```

- `stop` defaults to `true`. Set it to `false` only when the app can produce a consistent snapshot while running.
- Omitting `include` archives all app-data, installed app files and user-config, as before. Directories named `backups` are excluded from app-data.
- Setting `include` produces a **partial archive** containing only those files/directories relative to app-data. Paths are literal, not glob patterns. Parent selections subsume child selections. Missing paths, absolute paths, `..` components, backslashes, symlinked selections/ancestors and paths containing a `backups` directory are rejected. Symlinks inside selected directories are archived as links without following their targets.
- `include: []` saves no app-data; `include: ["."]` selects all app-data (still a partial archive). Partial archives leave installed app files, user-config and migration history untouched when restored.

Optional hooks live in the installed app definition:

```text
backup/backup.yml
backup/restore.yml
```

Each file must define exactly one Compose service named `migration`, with an image. Hooks use the migration runner: the app environment and user environment are available, the image is pulled, and `run --rm --no-TTY --no-deps migration` runs in the separate migration project. The generated app Compose file and user Compose overrides are not merged. Hook containers are cleaned up afterwards. Use bind mounts under `${APP_DATA_DIR}` for data that must be captured. Hooks must not depend on another service being started by Compose.

For example, `backup/backup.yml` for an app using SQLite:

```yaml
services:
  migration:
    image: keinos/sqlite3:latest # Pin a suitable version/digest for your app store.
    volumes:
      - ${APP_DATA_DIR}:/data
    entrypoint: ['/bin/sh', '-ec']
    command:
      - sqlite3 /data/database.sqlite '.dump' > /data/backup-dump.sql
```

And `backup/restore.yml`:

```yaml
services:
  migration:
    image: keinos/sqlite3:latest
    volumes:
      - ${APP_DATA_DIR}:/data
    entrypoint: ['/bin/sh', '-ec']
    command:
      - rm -f /data/database.sqlite /data/database.sqlite-wal /data/database.sqlite-shm; sqlite3 /data/database.sqlite < /data/backup-dump.sql
```

Adapt permissions, paths, image and database restore logic to the app. The backup hook runs **before** the optional stop, so it must also work when the app is already stopped. After staging, a previously running app is restarted only if backup stopped it. A backup hook failure aborts publication and attempts to restart a previously running app.

Restore runs with the app stopped. Selected files/directories replace their current versions (including removing extra files inside selected directories); unselected paths are preserved. Partial restores stage and swap only selected paths using the same crash-recoverable transaction as full restores. Unselected paths retain their ownership, permissions and inode identity. The restore hook runs after the file transaction commits and before the app starts. If it fails, the restored files remain in place and the operation fails without starting the app. The pending hook is recorded durably and retried before start, update, backup and other lifecycle operations, which refuse to run while it keeps failing, so the app never starts with restored data its hook has not processed. Hooks must be idempotent because interrupted executions can run again.

To get out of a failing restore hook, restore a backup again: restoring the same backup re-runs the hook (useful after a transient failure such as an image pull), and restoring another backup replaces the pending one. The pending hook is only dropped once the new archive has been validated and its restore journal written, so a rejected archive leaves it in place. Deleting backups and uninstalling also work while a hook is pending. An update does not: if the installed `restore.yml` itself is broken, restore a backup that does not need it or uninstall the app.

Partial archives contain `runtipi-backup.json` with `{ "version": 1, "partial": true, "include": [...], "migrationIds": [...] }`. `migrationIds` records the app migrations that had run when the backup was taken. Because a partial restore keeps the current migration history, it is rejected when that history has changed since the backup (for example after an update ran a migration); restore a full backup instead.

When a selected path's parent directory no longer exists, the topmost missing directory is restored as a whole (the archive holds only selected entries inside it), so an interrupted restore removes it again. Keep the restore hook available in the currently installed app definition: partial archives do not contain app files. Full user restores run the hook from the restored app definition.

Migration rollback always takes a full, stopped snapshot, ignoring this policy and both hooks. Partial archives are rejected for migration rollback, and full rollback restores do not run app restore hooks. No plugin system is required.
