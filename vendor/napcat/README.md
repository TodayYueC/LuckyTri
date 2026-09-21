# NapCatQQ Windows 包

`NapCat.Shell.Windows.OneKey.zip` 与 `NapCat.Shell.zip` 是 NapCatQQ 官方 Windows 发布包。检测到本机已有 QQ 时，WebUI 优先使用本地 Shell 包直接准备 NapCat，绕过 OneKey 安装器对旧 QQ 下载地址的依赖；没有检测到 QQ 时才回退到官方 OneKey 安装器。

来源：https://github.com/NapNeko/NapCatQQ/releases/tag/v4.18.28

`manifest.json` 和 `shell-manifest.json` 中的 SHA-256 会在使用前重新校验。NapCatQQ 仍是独立的第三方组件；QQ 登录、二维码、验证码和账号安全确认由 NapCat/QQ 自己处理。
