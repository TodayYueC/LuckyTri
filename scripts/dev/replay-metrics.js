// Metrics for replay runs (scripts/dev/replay-real.js). Reads only files in
// REPLAY_DIR. Usage: REPLAY_DIR=... node scripts/dev/replay-metrics.js base f1
import { readFileSync } from "node:fs";
import { join } from "node:path";
const dir = process.env.REPLAY_DIR;
const cases = Object.fromEntries(
  JSON.parse(readFileSync(join(dir, "cases.json"), "utf8")).map((c) => [
    c.id,
    c,
  ]),
);
const P = {
  ledger: /账|认了|认下|认一半|验收|并案|立此存照/,
  imageFail:
    /图.{0,8}(?:没读|读不|看不|打不开|空)|读不出|打不开|没读出|断线|瘫|查无此图|空壳|看个摘要|重新发一?遍文字|没读到|全吞|没救回来|废图|全灭|图床|撂挑子|文字复述|集体加班|集体罢工|一样是空|是空的|真断线|打字说|没收到画面|剩个壳|图通了|文字补|集体发作|看不太真切|没画面|图道|塌方|硬猜|这通道|通道.{0,6}关|文字报|图集体|作对|看了个寂寞|等能看见/,
  clarify: /说来听听|是指.{0,20}还是|后半句|具体.{0,6}(?:讲讲|说说)|讲讲呗/,
  secrecy:
    /不在(?:这|群)[儿里]?(?:细说|说|讲|展开|点名)|不好在这|知道但|另外知道|先不展开|留一手|在别处聊|私下聊的|不在这说/,
  selfCrit: /检讨|又.{0,4}错|不像话|认错/,
};
const pct = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))] || 0;
};
for (const tag of process.argv.slice(2)) {
  const runs = JSON.parse(readFileSync(join(dir, `run-${tag}.json`), "utf8"));
  const spoke = runs.filter((r) => r.after?.length);
  const count = {};
  for (const [k, re] of Object.entries(P))
    count[k] = spoke.filter((r) => r.after.some((l) => re.test(l))).length;
  const group = runs.filter((r) => cases[r.id]?.session.startsWith("group:"));
  const q = pct(group.map((r) => r.ms));
  const calls = runs.map((r) => r.calls?.length || 0);
  const chars = spoke.map((r) => r.after.join("").length);
  console.log(
    tag,
    JSON.stringify({
      n: runs.length,
      spoke: spoke.length,
      errors: runs.filter((r) => r.error).length,
      ...count,
      groupP50s: Math.round(q(0.5) / 1000),
      groupP90s: Math.round(q(0.9) / 1000),
      callsAvg: +(calls.reduce((a, b) => a + b, 0) / runs.length).toFixed(2),
      charsMedian: pct(chars)(0.5),
    }),
  );
}
