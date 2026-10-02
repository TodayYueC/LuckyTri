<p align="right"><b>中文</b> · <a href="#security">English</a></p>

# 安全说明

LuckyTri 默认只监听本机。页面、聊天记录、记忆和模型密钥都在本地，不会上传。

## 不要提交

这些内容已由 `.gitignore` 排除，只应留在本机：

- `.env`、`ADMIN_TOKEN`、`ONEBOT_TOKEN`、`QQBOT_APP_SECRET` 和模型 API Key
- `data/` 下的数据库、备份、日志和聊天内容
- 接入端的登录状态、二维码、Cookie 和运行日志

仓库里的 `.env.example` 只有空字段。仓库有一个卫生测试（`tests/repo-hygiene.test.js`），会扫描已发布的文件，查找常见格式的密钥、本机路径和不该出现的记录。

## 密钥进了 Git

1. 在服务商后台撤销该密钥并换新密钥。
2. 更新本机 `.env` 或 LuckyTri 中的模型配置。
3. 从 Git 历史里去掉泄露内容后再推送。

删除当前文件不会清除已经推送过的历史。

## 对外访问

监听 `127.0.0.1`、`localhost` 或 `::1` 以外的地址时，必须设置 `ADMIN_TOKEN`，否则进程拒绝启动。OneBot WebSocket 使用单独的 `ONEBOT_TOKEN`；QQ 官方机器人的 AppSecret 只会被保存，不会再回显给页面。不要在公开 Issue 里粘贴密钥、令牌、聊天记录或数据库文件。

## 报告问题

发现安全问题时，请不要在公开 Issue 里贴出细节，也不要贴出任何密钥或聊天内容。可以通过仓库主页上的联系方式私下告诉维护者。

---

# Security

LuckyTri listens on the local machine only by default. The pages, chat records, memories and model keys all stay on your machine and are never uploaded.

## Never commit

These are excluded by `.gitignore` and should only live on your machine:

- `.env`, `ADMIN_TOKEN`, `ONEBOT_TOKEN`, `QQBOT_APP_SECRET` and model API keys
- The database, backups, logs and chat content under `data/`
- Login state, QR codes, cookies and run logs of your connection endpoint

`.env.example` in the repository holds empty fields only. A hygiene test (`tests/repo-hygiene.test.js`) scans the published files for common secret formats, local paths and records that must not appear.

## If a key reached Git

1. Revoke the key at your provider and issue a new one.
2. Update your local `.env` or the model settings inside LuckyTri.
3. Remove the leaked content from Git history before pushing.

Deleting the current file does not clear history that was already pushed.

## Reaching it from outside

When listening on anything other than `127.0.0.1`, `localhost` or `::1`, `ADMIN_TOKEN` must be set, or the process refuses to start. The OneBot WebSocket uses its own `ONEBOT_TOKEN`; the QQ official bot's AppSecret is only stored and never shown back to the page. Do not paste keys, tokens, chat records or database files into public issues.

## Reporting a problem

If you find a security problem, do not post the details in a public issue, and never include any key or chat content. Tell the maintainer privately through the contact on the repository profile.
