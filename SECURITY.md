# 安全说明

LuckyBot 默认只监听本机。页面、聊天记录、记忆和模型密钥都在本地。

## 不要提交

这些内容已由 `.gitignore` 排除，只应留在本机：

- `.env`、`ADMIN_TOKEN`、`ONEBOT_TOKEN` 和模型 API Key
- `data/` 下的数据库、备份、日志和聊天内容
- QQ 登录状态、二维码、Cookie 和 NapCat 运行日志

仓库里的 `.env.example` 只有空字段。

## 密钥进了 Git

1. 在服务商后台撤销该密钥并换新密钥。
2. 更新本机 `.env` 或 LuckyBot 中的模型配置。
3. 从 Git 历史里去掉泄露内容后再推送。

删除当前文件不会清除已经推送过的历史。

## 对外访问

监听 `127.0.0.1`、`localhost` 或 `::1` 以外的地址时，必须设置 `ADMIN_TOKEN`，否则进程拒绝启动。OneBot WebSocket 使用单独的 `ONEBOT_TOKEN`。不要在公开 Issue 里粘贴密钥、令牌、聊天记录或数据库文件。
