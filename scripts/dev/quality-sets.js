// Loads a versioned quality set by name.
export async function loadSet(name = "quality-v1") {
  if (name === "quality-v1") return import("./quality-set/v1.js");
  if (name === "life-v1") return import("./quality-set/life-v1.js");
  if (name === "life-v1.1") return import("./quality-set/life-v1.1.js");
  if (name === "life-v1.2") return import("./quality-set/life-v1.2.js");
  throw Error(`未知评测集 ${name}`);
}
