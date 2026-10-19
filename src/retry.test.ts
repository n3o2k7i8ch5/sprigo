import { test } from "node:test";
import assert from "node:assert/strict";
import { retry, withBackup } from "./retry.ts";

test("retry repeats accepted errors, then gives up", async () => {
  let n = 0;
  assert.equal(await retry(async () => { if (++n < 3) throw new Error("bad"); return "ok"; }, () => true), "ok");
  assert.equal(n, 3);
  n = 0;
  await assert.rejects(retry(async () => { n++; throw new Error("bad"); }, () => true), /bad/);
  assert.equal(n, 3);
  n = 0;
  await assert.rejects(retry(async () => { n++; throw new Error("401"); }, () => false), /401/);
  assert.equal(n, 1);
});

test("withBackup moves to the backup only when the first fails", async () => {
  const seen: string[] = [];
  const fn = async (c: string) => { if (c === "down") throw new Error(c); return c; };
  assert.equal(await withBackup("up", "b", fn, (c) => seen.push(c)), "up");
  assert.equal(await withBackup("down", "b", fn, (c) => seen.push(c)), "b");
  assert.deepEqual(seen, ["b"]);
  await assert.rejects(withBackup("down", null, fn, () => {}), /down/);
  await assert.rejects(withBackup("down", "b", fn, () => {}, () => false), /down/); // e.g. already speaking
  await assert.rejects(withBackup("down", "down", fn, () => {}), /down/);
});
