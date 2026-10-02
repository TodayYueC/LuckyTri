import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Finds the interface wording in studio-web/src: every literal handed to
// t(), tn() or N_(). The Chinese text is the key; the English table has to
// cover each one. Reads the source as text so it sees script and template
// alike, and reports calls whose text is not a literal, because those can
// never be checked (or translated) ahead of time.

const CALL =
  /(?<![\w$.])(t|tn|N_)\(\s*(?:(["'`])((?:\\[\s\S]|(?!\2)[^\\])*)\2|([^\s)]))/g;

function unescape(text) {
  return text.replace(
    /\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g,
    (_, code) => {
      if (code[0] === "u" && code.length === 5)
        return String.fromCharCode(parseInt(code.slice(1), 16));
      if (code[0] === "x" && code.length === 3)
        return String.fromCharCode(parseInt(code.slice(1), 16));
      if (code === "n") return "\n";
      if (code === "t") return "\t";
      return code;
    },
  );
}

function walk(directory, found = []) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (/\.(vue|ts)$/.test(name)) found.push(path);
  }
  return found;
}

export function collectInterfaceText(sourceDirectory) {
  const keys = new Map();
  const dynamic = [];
  for (const file of walk(sourceDirectory)) {
    const rel = relative(sourceDirectory, file).split(sep).join("/");
    if (rel.startsWith("i18n/")) continue;
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(CALL)) {
      const [, kind, quote, body, other] = match;
      const line = source.slice(0, match.index).split("\n").length;
      if (quote === undefined) {
        // `t(` followed by something that is not a string: a variable, an
        // expression, or the name of a function that merely ends in t.
        dynamic.push({ file: rel, line, call: `${kind}(${other}` });
        continue;
      }
      if (quote === "`" && body.includes("${")) {
        dynamic.push({
          file: rel,
          line,
          call: `${kind}(\`${body.slice(0, 24)}…`,
        });
        continue;
      }
      const key = unescape(body);
      const known = keys.get(key) ?? { files: new Set(), kinds: new Set() };
      known.files.add(rel);
      known.kinds.add(kind);
      keys.set(key, known);
    }
  }
  return { keys, dynamic };
}
