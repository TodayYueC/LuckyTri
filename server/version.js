// The one place the running version is read: `package.json`. Everything that
// needs to say which LuckyTri it is (request headers, database archives)
// imports it from here, so a release only changes one number.
import { readFileSync } from "node:fs";

export const VERSION = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;

export const USER_AGENT = `LuckyTri/${VERSION}`;
