// Why a bot that "is connected" still says nothing. Shown on the channel
// status; the wording is for the person running LuckyTri.

export function silenceHints(status) {
  const hints = [];
  if (!status.configured)
    hints.push("还没有 AppID 和 AppSecret，开放平台不会把消息送到这里。");
  if (status.state === "error" && status.error)
    hints.push(`连接没有就绪：${status.error}`);
  if (
    status.transport === "websocket" &&
    status.online &&
    status.dispatchCount === 0
  )
    hints.push(
      "网关已经 READY，但一条事件都没有。常见原因：开放平台选的是 Webhook（和 WebSocket 互斥，切换立刻生效）；机器人还没进群，也没被加为好友；这台机器的出口 IP 不在白名单里。",
    );
  if (
    status.transport === "webhook" &&
    !status.webhookVerified &&
    status.dispatchCount === 0
  )
    hints.push(
      "还在等开放平台回调。地址必须是公网 HTTPS，端口只允许 80、443、8080、8443，控制台的接收方式要选 Webhook。",
    );
  if (
    status.transport === "webhook" &&
    status.webhookVerified &&
    status.dispatchCount === 0
  )
    hints.push(
      "回调地址已经通过验证，但还没有用户消息。把机器人加进你当群主或管理员的群，或在 QQ 里给它发一条单聊。",
    );
  if (status.groupMessages === "mentions")
    hints.push(
      "群里目前只有 @ 她的消息。没开「接收所有消息」时，她听不见群里的闲聊。",
    );
  if (status.closedRooms > 0)
    hints.push(
      "有会话关掉了主动消息。被动回复窗口之外她发不出去，会等对方先开口。",
    );
  if (status.proactive === "passive")
    hints.push(
      "QQBOT_PROACTIVE=passive：只在被动回复窗口内按原消息回复，窗口外不调用主动发送。",
    );
  if (status.lastSendError)
    hints.push(`最近一次发送失败：${status.lastSendError}`);
  return hints;
}
