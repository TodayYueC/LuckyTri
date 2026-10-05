import { spawn } from "node:child_process";

export function browserCommand(url, platform = process.platform) {
  if (platform === "win32")
    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Start-Process $env:LUCKY_LAUNCH_URL",
      ],
      env: { ...process.env, LUCKY_LAUNCH_URL: url },
    };
  return { command: platform === "darwin" ? "open" : "xdg-open", args: [url] };
}

export async function openBrowser(url) {
  const { command, args, env } = browserCommand(url);
  const child = spawn(command, args, {
    windowsHide: true,
    stdio: "ignore",
    env,
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(Error("浏览器未打开，请手动打开上方地址。"));
    }, 10000);
    const finish = (error) => {
      clearTimeout(timeout);
      error ? reject(error) : resolve();
    };
    child.once("error", () =>
      finish(Error("浏览器未打开，请手动打开上方地址。")),
    );
    child.once("exit", (code) =>
      finish(code === 0 ? null : Error("浏览器未打开，请手动打开上方地址。")),
    );
  });
}
