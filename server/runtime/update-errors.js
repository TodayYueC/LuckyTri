// Only these descriptions reach the management UI. Subprocess output can
// contain local paths or credentials and belongs in the local log only.
export const UPDATE_FAILURES = Object.freeze({
  NODE_UNSUPPORTED: "Node.js 版本不满足新版本要求，请先升级 Node.js 后重试。",
  NPM_NOT_FOUND: "当前服务找不到 npm，请安装 npm 并检查服务的 PATH 配置。",
  VERSION_UNAVAILABLE:
    "npm 暂时无法下载该版本或其运行依赖，请稍后重新检查更新。",
  NETWORK_ERROR: "连接 npm 失败，请检查服务器的网络、DNS 和代理配置。",
  TLS_ERROR: "连接 npm 时证书校验失败，请检查服务器的证书和代理配置。",
  REGISTRY_ACCESS: "npm 拒绝了下载请求，请检查服务器的网络或代理访问限制。",
  DISK_FULL: "磁盘空间不足，请为新程序、数据库快照和迁移副本留出空间。",
  PERMISSION_DENIED: "服务账号没有所需的读写权限，请检查实例和更新目录的权限。",
  STEP_TIMEOUT: "当前更新步骤超时，请检查运行日志后重试。",
  INSTALL_FAILED:
    "新版本安装失败，旧实例仍在运行，请查看运行日志中的 npm 报错。",
  PACKAGE_CHECK_FAILED: "新程序或本机运行依赖校验失败，请查看运行日志。",
  STOP_FAILED: "旧实例未能安全停止，请检查进程管理和实例端口。",
  BACKUP_FAILED: "更新前的数据库快照未能完成或通过校验，请查看运行日志。",
  MIGRATION_FAILED: "记忆与数据迁移未通过校验，请查看运行日志。",
  START_FAILED: "新实例未能正常启动，请检查运行日志和端口占用。",
  UPDATE_INTERRUPTED:
    "更新进程意外退出，请检查服务管理器、进程退出记录和运行日志。",
  RECOVERY_FAILED: "旧版本或数据库恢复未完成，请使用更新前的校验备份恢复。",
  STEP_FAILED: "当前更新步骤未完成，请查看运行日志。",
});

export function updateError(code) {
  const known = Object.hasOwn(UPDATE_FAILURES, code) ? code : "STEP_FAILED";
  return Object.assign(Error(UPDATE_FAILURES[known]), { updateCode: known });
}

export function npmFailureCode(output) {
  for (const [pattern, code] of [
    [/\bEBADENGINE\b/, "NODE_UNSUPPORTED"],
    [/\bENOSPC\b/, "DISK_FULL"],
    [/\b(?:EACCES|EPERM)\b/, "PERMISSION_DENIED"],
    [/\b(?:E404|ETARGET)\b/, "VERSION_UNAVAILABLE"],
    [/\b(?:E401|E403)\b/, "REGISTRY_ACCESS"],
    [
      /\b(?:CERT_[A-Z_]+|[A-Z_]*CERTIFICATE[A-Z_]*|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE)\b/,
      "TLS_ERROR",
    ],
    [
      /\b(?:ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ESOCKETTIMEDOUT|ENETUNREACH|EHOSTUNREACH)\b/,
      "NETWORK_ERROR",
    ],
  ])
    if (pattern.test(output)) return code;
  return "INSTALL_FAILED";
}

export function updateFailure(error, stage) {
  const osCode = {
    ENOSPC: "DISK_FULL",
    EACCES: "PERMISSION_DENIED",
    EPERM: "PERMISSION_DENIED",
  }[error?.code];
  const fallback =
    {
      downloading: "INSTALL_FAILED",
      checking: "PACKAGE_CHECK_FAILED",
      stopping: "STOP_FAILED",
      backup: "BACKUP_FAILED",
      migrating: "MIGRATION_FAILED",
      restarting: "START_FAILED",
      verifying: "START_FAILED",
      restoring: "RECOVERY_FAILED",
    }[stage] || "STEP_FAILED";
  const failureCode = Object.hasOwn(UPDATE_FAILURES, error?.updateCode)
    ? error.updateCode
    : osCode || fallback;
  return { failureCode, detail: UPDATE_FAILURES[failureCode] };
}
