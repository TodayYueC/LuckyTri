# npm 发布与维护

发布复用 LuckyTri 当前 Git 仓库和 `package.json`，包名为 `luckytri`，版本继续由 `server/version.js` 从根 `package.json` 读取。

## 结构与启动

`server/` 是无需转译的 ESM 服务端，运行依赖为 Express、ws 和 sharp；SQLite 使用 Node.js 内置的 `node:sqlite`，最低 Node.js 24.5。`studio-web/` 使用 Vue 与 Vite，发布前构建到 `public/app/`。教程从中英文 `docs/*/guide.md` 生成到 `public/`。

`bin/luckytri.js` 提供全局命令，分派到既有启动、停止、备份、恢复与插件脚本。`scripts/runtime.js` 复用 `scripts/setup.js` 的本机环境初始化与管理台首次密码设置，并保留已有配置。`server/paths.js` 将包内资源与实例数据分开；源码默认继续使用仓库的 `.env` 和 `data/`，npm 安装默认使用独立用户目录。相对数据库和备份路径以实例目录为基准，后台进程和自动备份子进程继承相同的绝对路径。服务身份以实例目录确认，更新程序安装位置后仍能定位原实例。

数据库、心智、聊天、界面配置继续使用原 SQLite 存储与迁移；知识文件、插件安装与插件数据、日志和备份都在实例目录中。启动锁保留到服务退出，阻止重复打开同一实例。Windows、macOS、Linux 分别使用系统浏览器打开方式；无桌面环境可使用 `--no-browser`。

## 包内容边界

`package.json.files` 白名单只包含 CLI、服务端、运行脚本、构建后的 WebUI、教程、插件桥接资源、内置天气插件、SDK 和公开文档。`.npmignore` 再排除敏感及本地文件。安装和卸载没有应用生命周期脚本，普通用户无需前端构建工具。

`npm run pack:check` 使用 npm 实际生成的最终文件清单，先检查路径，再检查经过批准的源码内容，拒绝配置、秘密文件、数据库、聊天、日志、备份、开发文件和意外新增文件。它还校验 CLI shebang、关键资源、WebUI 资源引用及源代码中的常见秘密格式。不要使用 `--ignore-scripts` 从未经验证的源码直接发布。

## 发布流程

维护者需要开发依赖和 Playwright 浏览器。Windows 默认使用已安装的 Edge；Linux/macOS 可用 `npx playwright install chromium` 安装测试浏览器。

```bash
npm ci
npm run release:check
npm publish
```

`release:check` 构建完整资源、运行全部后端与 WebUI 测试、检查实际包并验证全局安装。`prepublishOnly` 自动执行构建、后端测试和实际包安装测试；`prepack` 自动构建并检查最终包内容。发新版本前同时更新 `package.json` 与 lockfile，并更新版本记录；已发布的版本不可覆盖。

包测试使用临时 npm 全局前缀和模拟数据，检查含空格、中文的任意调用目录、WebUI 浏览器加载、内置插件、数据库备份及恢复检查，再安装测试版本并卸载重装，确认配置、记忆、关系、聊天、知识文件、日志、备份和插件数据保留。测试版本只存在于本机临时压缩包，不发布。测试清单和经过验证的正式压缩包输出到被 Git 忽略的 `workspace/npm-release/`。完成检查后也可直接发布该目录中的正式 `.tgz`，保证上传的是已经检查和安装过的同一份包。

首次发布需要 npm 注册与登录。发布命令使用 npm 自己的登录流程，不读取或输出登录凭据文件；如果 npm 要求二次验证，由账号本人完成认证后继续发布。
