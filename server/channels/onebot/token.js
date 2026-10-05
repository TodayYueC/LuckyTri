import { isLoopback } from "../../local-access.js";
import { tokenEqual } from "../../http.js";

export async function authorizeOneBot(
  req,
  store,
  verifyPassword = async () => false,
) {
  if (req.headers.origin) return false;
  if (isLoopback(req.socket.remoteAddress)) return true;
  const supplied = String(req.headers.authorization || "").replace(
    /^Bearer /,
    "",
  );
  const legacy = effectiveOneBotToken(store);
  if (legacy && tokenEqual(supplied, legacy)) return true;
  return verifyPassword(supplied, req.socket.remoteAddress);
}

export function effectiveOneBotToken(store) {
  return process.env.ONEBOT_TOKEN || store.settings().onebotToken || "";
}
