"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeText,
  filterEffects,
  createInitialVersions,
  addVersion,
  selectVersion,
} = require("./app.js");

const effects = [
  {
    id: "arcane-ring",
    name: "Vòng phép Tinh Vân",
    type: "Vòng phép",
    colors: ["xanh", "tím"],
    source: "Mẫu nội bộ",
    license: "CC0",
    gameVerified: true,
    duration: 2.4,
    loop: true,
  },
  {
    id: "frost-slash",
    name: "Vệt chém Băng Lam",
    type: "Vệt chém",
    colors: ["xanh", "trắng"],
    source: "Effekseer Sample",
    license: "CC-BY",
    gameVerified: false,
    duration: 0.8,
    loop: false,
  },
  {
    id: "solar-shot",
    name: "Đạn Nhật Quang",
    type: "Đạn",
    colors: ["vàng"],
    source: "Kho cộng đồng",
    license: "CC0",
    gameVerified: true,
    duration: 3.2,
    loop: false,
  },
];

test("normalizeText folds Vietnamese accents, đ, case, and surrounding whitespace", () => {
  assert.equal(normalizeText("  XƯƠNG ĐẦU RỒNG  "), "xuong dau rong");
  assert.equal(normalizeText("Vệt chém Băng Lam"), "vet chem bang lam");
  assert.equal(normalizeText(null), "");
});

test("filterEffects gives the same result for accented and accent-free searches", () => {
  const accented = filterEffects(effects, { query: "vòng phép" });
  const accentFree = filterEffects(effects, { query: "VONG PHEP" });

  assert.deepEqual(accented.map(({ id }) => id), ["arcane-ring"]);
  assert.deepEqual(accentFree, accented);
  assert.deepEqual(filterEffects(effects, { search: "dan nhat" }).map(({ id }) => id), ["solar-shot"]);
});

test("filterEffects searches metadata and combines query, type, and game verification", () => {
  assert.deepEqual(
    filterEffects(effects, { query: "trang" }).map(({ id }) => id),
    ["frost-slash"],
    "color names participate in search",
  );
  assert.deepEqual(
    filterEffects(effects, { query: "cong dong", type: "Đạn", verified: true }).map(({ id }) => id),
    ["solar-shot"],
  );
  assert.deepEqual(filterEffects(effects, { type: "Vệt chém", gameVerified: true }), []);
  assert.deepEqual(filterEffects(effects, {}).map(({ id }) => id), effects.map(({ id }) => id));
});

test("filterEffects combines color, duration, loop, source, and license controls", () => {
  assert.deepEqual(filterEffects(effects, { color: "trắng", duration: "short", loop: "once", source: "Effekseer Sample", license: "CC-BY" }).map(({ id }) => id), ["frost-slash"]);
  assert.deepEqual(filterEffects(effects, { duration: "medium", loop: "loop" }).map(({ id }) => id), ["arcane-ring"]);
  assert.deepEqual(filterEffects(effects, { duration: "long", license: "CC0" }).map(({ id }) => id), ["solar-shot"]);
});

test("addVersion appends and selects a version without mutating prior history", () => {
  const initial = createInitialVersions();
  const originalSnapshot = structuredClone(initial);
  const updated = addVersion(initial, "Tím hơn, nổ muộn 0,5 s");

  assert.deepEqual(initial, originalSnapshot);
  assert.notStrictEqual(updated, initial);
  assert.notStrictEqual(updated.items, initial.items);
  assert.equal(updated.items.length, initial.items.length + 1);
  assert.deepEqual(updated.items.slice(0, initial.items.length), initial.items);
  assert.ok(updated.items.slice(0, initial.items.length).every((item, index) => item !== initial.items[index]));
  assert.deepEqual(updated.items.at(-1), {
    id: "v4",
    label: "Bản 4",
    instruction: "Tím hơn, nổ muộn 0,5 s",
    time: "Bây giờ",
  });
  assert.equal(updated.selectedId, "v4");
  assert.equal(updated.next, 5);
});

test("successive edits preserve history and allocate stable increasing ids", () => {
  const initial = createInitialVersions();
  const fourth = addVersion(initial, "Thêm tia lửa");
  const fifth = addVersion(fourth, "Giảm bán kính");

  assert.deepEqual(fifth.items.map(({ id }) => id), ["v1", "v2", "v3", "v4", "v5"]);
  assert.equal(fifth.selectedId, "v5");
  assert.equal(fifth.items.find(({ id }) => id === "v4").instruction, "Thêm tia lửa");
  assert.equal(fourth.items.length, 4);
  assert.equal(fourth.selectedId, "v4");
});

test("selectVersion selects existing history immutably and ignores unknown ids", () => {
  const state = addVersion(createInitialVersions(), "Thêm tia lửa");
  const selected = selectVersion(state, "v1");

  assert.equal(selected.selectedId, "v1");
  assert.equal(state.selectedId, "v4");
  assert.notStrictEqual(selected, state);
  assert.notStrictEqual(selected.items, state.items);
  assert.deepEqual(selected.items, state.items);
  assert.strictEqual(selectVersion(selected, "missing-version"), selected);
});
