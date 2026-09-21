import { timingSafeEqual } from "node:crypto";

export const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
};

export function tokenEqual(a, b) {
  return (
    typeof a === "string" &&
    typeof b === "string" &&
    Buffer.byteLength(a) === Buffer.byteLength(b) &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
