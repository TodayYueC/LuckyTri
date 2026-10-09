// Models are asked for one JSON object and mostly comply. The rest of the time
// they wrap it in a fence, think out loud first, add a sentence afterwards,
// leave out a comma, or put an unescaped quote inside a Chinese sentence. A
// whole turn (or a whole stretch of solitude) used to be lost to each of these.
// Repairs only run after strict parsing fails. Duplicate object keys are
// ambiguous even when JSON.parse accepts them: silently keeping the final
// value can discard an answer or replace a decision with its opposite.

const THINK_BLOCK = /<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi;

function withoutReasoning(raw) {
  let text = String(raw ?? "")
    .replace(/^\uFEFF/, "")
    .replace(THINK_BLOCK, "");
  // A reply that only shows the closing tag: everything before it is thinking.
  const close = text.search(/<\/(think|thinking|reasoning)>/i);
  if (close !== -1)
    text = text.replace(/^[\s\S]*<\/(think|thinking|reasoning)>/i, "");
  return text.trim();
}

function unfenced(text) {
  return text.replace(/^```(?:json)?\s*|\s*```$/gi, "").trim();
}

// End index of the JSON value that opens at `start`, or -1 when it never
// closes. Quotes and escapes inside strings are respected.
function balancedEnd(text, start) {
  const open = text[start];
  const stack = [open === "{" ? "}" : "]"];
  let inString = false;
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") stack.push("}");
    else if (c === "[") stack.push("]");
    else if (c === "}" || c === "]") {
      if (stack.pop() !== c) return -1;
      if (!stack.length) return i;
    }
  }
  return -1;
}

const isSpace = (c) => c === " " || c === "\n" || c === "\r" || c === "\t";

function nextSignificant(text, from) {
  let i = from;
  while (i < text.length && isSpace(text[i])) i++;
  return i;
}

// Whether the string that starts at text[index] (a quote) is followed by a
// colon, that is, whether it is an object key rather than a value.
function startsKey(text, index) {
  for (let i = index + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === '"') return text[nextSignificant(text, i + 1)] === ":";
  }
  return false;
}

// One pass over the text that fixes the slips models actually make:
// raw line breaks inside strings, quotes inside a sentence, a missing comma
// between two members, and a comma before a closing bracket.
export function repairJson(text) {
  let out = "";
  let inString = false;
  const stack = [];
  // The last significant thing written outside a string, to spot a missing comma.
  let lastValue = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") {
        out += c + (text[i + 1] ?? "");
        i++;
      } else if (c === '"') {
        const after = nextSignificant(text, i + 1);
        const next = text[after];
        if (
          after >= text.length ||
          next === "," ||
          next === "}" ||
          next === "]" ||
          next === ":"
        ) {
          inString = false;
          lastValue = true;
          out += c;
        } else if (next === '"' && startsKey(text, after)) {
          // `"a": "x" "b": 1` - the string ended and a comma is missing.
          inString = false;
          lastValue = true;
          out += c;
        } else out += '\\"';
      } else if (c === "\n") out += "\\n";
      else if (c === "\r") out += "\\r";
      else if (c === "\t") out += "\\t";
      else if (c < " ") out += " ";
      else out += c;
      continue;
    }
    if (isSpace(c)) {
      out += c;
      continue;
    }
    if (c === ",") {
      const next = text[nextSignificant(text, i + 1)];
      if (next === "}" || next === "]") continue;
      lastValue = false;
      out += c;
      continue;
    }
    if (c === '"') {
      if (lastValue) out += ",";
      inString = true;
      lastValue = false;
      out += c;
      continue;
    }
    if (c === "{" || c === "[") {
      if (lastValue) out += ",";
      lastValue = false;
      stack.push(c === "{" ? "}" : "]");
      out += c;
      continue;
    }
    if (c === "}" || c === "]") {
      lastValue = true;
      // A closer of the wrong kind (`]` where `}` is due) becomes the one the
      // opener asks for, and a closer with nothing left to close is dropped.
      if (stack.length) out += stack.pop();
      continue;
    }
    if (c === ":") {
      lastValue = false;
      out += c;
      continue;
    }
    // A number or a bare word.
    if (lastValue && /[-\d]|[tfn]/.test(c)) out += ",";
    lastValue = true;
    out += c;
    while (i + 1 < text.length && /[\w.+\-]/.test(text[i + 1])) {
      out += text[i + 1];
      i++;
    }
  }
  return out;
}

class DuplicateKeyError extends SyntaxError {}

// JSON.parse has already established valid syntax before this token walk.
// Each object owns its own key set; escaped keys are compared after decoding.
function assertUniqueKeys(text) {
  const stack = [];
  for (const token of text.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\]:,]/g)) {
    const value = token[0];
    if (value === "{") stack.push({ keys: new Set(), keyNext: true });
    else if (value === "[") stack.push({ keys: null });
    else if (value === "}" || value === "]") stack.pop();
    else {
      const frame = stack.at(-1);
      if (!frame?.keys) continue;
      if (value === ",") frame.keyNext = true;
      else if (value === ":") frame.keyNext = false;
      else if (value[0] === '"' && frame.keyNext) {
        const key = JSON.parse(value);
        if (frame.keys.has(key))
          throw new DuplicateKeyError(
            "JSON 同一对象含重复字段，不能确定哪份内容有效",
          );
        frame.keys.add(key);
        frame.keyNext = false;
      }
    }
  }
}

const tryParse = (text) => {
  try {
    const value = JSON.parse(text);
    assertUniqueKeys(text);
    return { value };
  } catch (error) {
    if (error instanceof DuplicateKeyError) throw error;
    return { error };
  }
};

// Returns the parsed value or throws the error strict parsing gave, so callers
// and traces keep the message they always had.
export function parseModelJson(raw) {
  const text = withoutReasoning(raw);
  const plain = unfenced(text);
  const strict = tryParse(plain);
  if (!("error" in strict)) return strict.value;

  const candidates = [];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) candidates.push(fence[1].trim());
  const open = plain.search(/[{[]/);
  if (open !== -1) {
    const end = balancedEnd(plain, open);
    if (end !== -1) candidates.push(plain.slice(open, end + 1));
    else candidates.push(plain.slice(open));
  }
  candidates.push(plain);
  for (const candidate of candidates) {
    const first = tryParse(candidate);
    if (!("error" in first)) return first.value;
    const repaired = tryParse(repairJson(candidate));
    if (!("error" in repaired)) return repaired.value;
  }
  throw strict.error;
}
