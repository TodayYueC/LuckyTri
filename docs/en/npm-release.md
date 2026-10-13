# npm release maintenance

LuckyTri publishes from this same Git repository as `luckytri`. The root `package.json` remains the source of the version, read by `server/version.js`.

The ESM server needs Express, ws and sharp, plus Node.js 24.5 or newer for built-in SQLite and proxy support. Vite builds `studio-web/` into `public/app/`; the documentation build generates the bilingual guide pages. `bin/luckytri.js` reuses the existing launch, stop, setup, backup, recovery and plugin scripts.

`server/paths.js` separates package resources from writable instance data. Global installations use a stable per-user directory; source checkouts retain their existing `.env` and `data/`. Relative database and backup settings resolve under the instance directory. Server and backup workers inherit absolute paths, and service identity uses the instance directory rather than an installation location. The existing SQLite migrations and snapshots remain in use.

For a server managed by systemd or PM2, use `luckytri start --home /srv/luckytri` with the existing instance directory containing `.env` and `data/`. The foreground supervisor waits through backup, memory migration and startup verification, then adopts the replacement process. Only explicit success or failure ends that wait, so stages introduced by future releases cannot trigger a premature restart. Running `server/index.js` directly bypasses this handover. The background launcher is intended for standalone use. The service account needs Node.js >=24.5, npm, write access to the instance directory and enough room for database snapshots.

Updates install and check the candidate separately before stopping the service. A verified backup is retained, migration runs on a database copy, and the replacement must pass a health check. Ordinary failures attempt rollback; an externally terminated worker is reported with its interrupted stage and recovery requirements. The UI distinguishes network, certificate, permission, disk, runtime, migration and startup errors. Raw errors stay in the instance's `data/launcher.log`.

The foreground supervisor in 1.2.0–1.2.1 omitted the migration stage and could start the old instance prematurely. Clicking update still runs the already installed updater, so the upgrade to the fixed 1.2.2 release should be performed manually: back up, stop the managed service, run `npm install -g luckytri@1.2.2`, then restart with the same service account and instance directory. Reinstalling 1.2.1 does not fix the defect. Keep the instance and `runtime/` directories, which may contain recovery state and previous programs.

`package.json.files` allows only the CLI, server, runtime scripts, built WebUI, guides, plugin bridge, built-in weather plugin, SDK and public documentation. `.npmignore` adds exclusions. Application install and uninstall hooks are prohibited, so an install never initializes, copies or deletes user data and requires no frontend build tools.

`npm run pack:check` inspects npm's actual final file list before reading any contents. Unreviewed paths, credentials, environment configuration, databases, logs, backups, development files and missing resources fail the check. Reviewed source files are scanned for common embedded secret formats. It also verifies the CLI shebang and WebUI asset references.

For a release, install development dependencies and a Playwright browser. Windows tests use Edge by default; Linux/macOS can use `npx playwright install chromium`.

```bash
npm ci
npm run release:check
npm publish
```

`release:check` builds resources, runs the full backend and browser suites, and tests a real global installation. `prepublishOnly` builds, runs backend tests and tests the packed installation; `prepack` builds and checks the final package. Update both manifest and lockfile versions, and the changelog, for subsequent releases. Published versions cannot be overwritten.

Package tests use temporary global npm prefixes and synthetic data. They cover arbitrary caller directories, paths with spaces and Chinese characters, the packed WebUI in a browser, plugins, backup verification, a local test version upgrade, uninstall and reinstall, and retention of configuration, memory, relationships, chats, knowledge, logs, backups and plugin state. The test version is never published. The reviewed release tarball and checks are saved under the Git-ignored `workspace/npm-release/` directory. You can publish that exact release `.tgz` after validation. `npm run test:registry` verifies the registry integrity against the reviewed tarball and repeats installation tests from npm after publication.

The GitHub workflow runs backend and package checks on Windows, macOS and Linux. It does not publish or require npm credentials. For local publication, npm itself handles authentication; the account holder must complete any additional authentication the registry requests.
