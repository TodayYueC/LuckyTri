# npm release maintenance

LuckyTri publishes from this same Git repository as `luckytri`. The root `package.json` remains the source of the version, read by `server/version.js`.

The ESM server needs Express, ws and sharp, plus Node.js 24.5 or newer for built-in SQLite and proxy support. Vite builds `studio-web/` into `public/app/`; the documentation build generates the bilingual guide pages. `bin/luckytri.js` reuses the existing launch, stop, setup, backup, recovery and plugin scripts.

`server/paths.js` separates package resources from writable instance data. Global installations use a stable per-user directory; source checkouts retain their existing `.env` and `data/`. Relative database and backup settings resolve under the instance directory. Server and backup workers inherit absolute paths, and service identity uses the instance directory rather than an installation location. The existing SQLite migrations and snapshots remain in use.

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
