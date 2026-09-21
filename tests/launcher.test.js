import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Windows double-click launchers retain ASCII and CRLF for cmd.exe", () => {
  for (const name of ["启动LuckyBot.cmd", "停止LuckyBot.cmd"]) {
    const bytes = readFileSync(new URL(`../${name}`, import.meta.url));
    assert.ok(
      bytes.every((byte) => byte < 128),
      `${name}: ASCII only`,
    );
    const source = bytes.toString("ascii");
    assert.ok(source.includes("\r\n"));
    assert.ok(!source.replaceAll("\r\n", "").includes("\n"));
    assert.ok(source.includes('cd /d "%~dp0"'));
    assert.match(source, /"%[A-Z]+_NODE%"/);
  }
});
