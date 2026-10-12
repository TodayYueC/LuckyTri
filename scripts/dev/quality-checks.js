// Objective checks for one quality-set reply: the parts a script can decide
// without a judge (referent words, dates, silence, who she answered, length).
export function objective(scene, result) {
  const e = scene.expect || {};
  const reply = String(result.reply || "");
  const items = [];
  const add = (name, ok) => items.push({ name, ok: Boolean(ok) });
  if (e.silent === true) add("silent", result.silent);
  if (e.silent === false) add("spoke", !result.silent);
  for (const i of e.target || [])
    add(`target:${i}`, !result.silent && result.targets.includes(i));
  for (const i of e.notTarget || [])
    add(`notTarget:${i}`, !result.targets.includes(i));
  for (const group of e.any || [])
    add(
      `any:${group.map(String).join("|")}`,
      !result.silent && group.some((re) => re.test(reply)),
    );
  for (const re of e.none || []) add(`none:${re}`, !re.test(reply));
  for (const re of e.hard || []) {
    add(`hard:${re}`, !re.test(reply));
    items.at(-1).hard = true;
  }
  if (e.maxChars)
    add(`maxChars:${e.maxChars}`, !result.silent && reply.length <= e.maxChars);
  return {
    items,
    total: items.length,
    passed: items.filter((i) => i.ok).length,
    hardErrors: items.filter((i) => i.hard && !i.ok).length,
  };
}
