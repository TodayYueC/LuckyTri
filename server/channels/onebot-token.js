export function effectiveOneBotToken(store) {
  return process.env.ONEBOT_TOKEN || store.settings().onebotToken || "";
}
