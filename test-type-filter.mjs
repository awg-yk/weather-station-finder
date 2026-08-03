import { JSDOM } from "jsdom";
import { readFileSync } from "fs";

const dom = new JSDOM("<!DOCTYPE html><div id='root'></div>", { url: "http://localhost/" });
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;

const { initTypeFilter } = await import("./js/modules/typeFilter.js");
const data = JSON.parse(readFileSync("./data/stations.json", "utf-8"));

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("OK:", msg);
}

const container = document.getElementById("root");
const stationTypes = [...new Set(data.stations.map((s) => s.stationType))];

let lastSelected = null;

initTypeFilter({
  container,
  stationTypes,
  onChange: (selected) => {
    lastSelected = selected;
  },
});

assert(lastSelected === null, "初期状態では onChange は呼ばれない");

const checkboxes = [...container.querySelectorAll('input[type="checkbox"]')];
assert(checkboxes.length === stationTypes.length, `種別数と同じ数のチェックボックスが描画される (実際: ${checkboxes.length})`);

const kanshoCheckbox = checkboxes.find((cb) => cb.id === "type-気象台等");
assert(!!kanshoCheckbox, "気象台等のチェックボックスが存在する");

kanshoCheckbox.checked = true;
kanshoCheckbox.dispatchEvent(new dom.window.Event("change"));
assert(lastSelected.size === 1 && lastSelected.has("気象台等"), "気象台等をチェックすると選択に追加される");

const amedasCheckbox = checkboxes.find((cb) => cb.id === "type-アメダス");
amedasCheckbox.checked = true;
amedasCheckbox.dispatchEvent(new dom.window.Event("change"));
assert(lastSelected.size === 2, "両方チェックすると2件選択される");

kanshoCheckbox.checked = false;
kanshoCheckbox.dispatchEvent(new dom.window.Event("change"));
assert(lastSelected.size === 1 && lastSelected.has("アメダス"), "気象台等を外すとアメダスのみ残る");

const clearButton = container.querySelector(".element-controls__clear");
clearButton.dispatchEvent(new dom.window.Event("click"));
assert(lastSelected.size === 0, "クリアボタンで0件選択になる");
assert(!kanshoCheckbox.checked && !amedasCheckbox.checked, "クリア後はチェックボックスの見た目もOFFになる");

// --- initialSelected による初期状態の復元（URLクエリ・プリセット復元用） ---

let lastSelected2 = null;
const typeFilter = initTypeFilter({
  container,
  stationTypes,
  stationCounts: new Map([["気象台等", 57], ["アメダス", 1230]]),
  initialSelected: new Set(["気象台等"]),
  onChange: (selected) => {
    lastSelected2 = selected;
  },
});
const restoredCheckbox = container.querySelector("#type-気象台等");
assert(restoredCheckbox.checked === true, "initialSelectedで指定した種別は最初からチェックされている");
assert(lastSelected2 === null, "再初期化時にも初期状態ではonChangeは呼ばれない");

// --- updateCounts()（他の絞り込みに連動した件数更新。フェーズ10） -----------

assert(
  container.querySelector("#type-気象台等 + .element-item__label").textContent === "気象台等 (57)",
  "stationCounts を渡すとラベルに件数が表示される"
);

typeFilter.updateCounts(new Map([["気象台等", 7], ["アメダス", 219]]));
assert(
  container.querySelector("#type-気象台等 + .element-item__label").textContent === "気象台等 (7)",
  "updateCounts() で件数表示だけが更新される"
);
assert(restoredCheckbox.checked === true, "updateCounts() はチェック状態を変えない");

typeFilter.updateCounts(new Map([["アメダス", 219]]));
assert(
  container.querySelector("#type-気象台等").parentElement.classList.contains("element-item--empty"),
  "0件になった種別には element-item--empty が付く"
);

// clearButtonSlot を渡すと、そちらに「選択をクリア」ボタンが描画される（フェーズ23）
{
  const bodyContainer = document.createElement("div");
  const headerSlot = document.createElement("span");
  let slotLastSelected = null;
  initTypeFilter({
    container: bodyContainer,
    stationTypes: ["気象台等", "アメダス"],
    initialSelected: new Set(["気象台等"]),
    clearButtonSlot: headerSlot,
    onChange: (sel) => {
      slotLastSelected = sel;
    },
  });
  assert(!bodyContainer.querySelector(".element-controls__clear"), "clearButtonSlot指定時はパネル本文側にクリアボタンが無い");
  const slotClearButton = headerSlot.querySelector(".element-controls__clear");
  assert(!!slotClearButton, "clearButtonSlotの中にクリアボタンが描画される");
  slotClearButton.dispatchEvent(new dom.window.Event("click"));
  assert(slotLastSelected.size === 0, "スロット内のクリアボタンでも選択解除が機能する");
}

console.log("\nAll type-filter tests passed.");
