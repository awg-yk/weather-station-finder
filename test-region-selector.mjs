import { JSDOM } from "jsdom";
import { readFileSync } from "fs";

const dom = new JSDOM("<!DOCTYPE html><div id='root'></div>", { url: "http://localhost/" });
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;

const { initRegionSelector } = await import("./js/modules/regionSelector.js");
const data = JSON.parse(readFileSync("./data/stations.json", "utf-8"));

const counts = new Map();
data.stations.forEach((s) => counts.set(s.prefecture, (counts.get(s.prefecture) ?? 0) + 1));

// 47都道府県 + 南極（昭和基地）。地域を増やしてもテストが壊れないようマスタから数える
const totalAreaCount = data.regions.reduce((sum, r) => sum + r.prefectures.length, 0);

let lastSelected = null;
const container = document.getElementById("root");

const regionSelector = initRegionSelector({
  container,
  regions: data.regions,
  stationCounts: counts,
  onChange: (selected) => {
    lastSelected = selected;
  },
});

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("OK:", msg);
}

// 1. 初期状態: 何も選択されていない
assert(lastSelected === null, "初期状態では onChange は呼ばれない");

// 2. 東北の地方チェックボックスをONにすると、配下の6県が選択される
const tohokuCheckbox = document.getElementById("region-tohoku");
tohokuCheckbox.checked = true;
tohokuCheckbox.dispatchEvent(new dom.window.Event("change"));
assert(lastSelected.size === 6, `東北ON → 6県選択 (実際: ${lastSelected.size})`);
assert(lastSelected.has("青森県") && lastSelected.has("福島県"), "青森県・福島県が含まれる");

// 3. 東北の中の1県（青森県）だけ外すと、東北チェックボックスは indeterminate になる
const aomoriCheckbox = document.getElementById("pref-tohoku-青森県");
aomoriCheckbox.checked = false;
aomoriCheckbox.dispatchEvent(new dom.window.Event("change"));
assert(lastSelected.size === 5, `青森県を外す → 5県選択 (実際: ${lastSelected.size})`);
assert(tohokuCheckbox.indeterminate === true, "東北チェックボックスが indeterminate になる");
assert(tohokuCheckbox.checked === false, "東北チェックボックス自体はONにならない");

// 4. 「全国」チェックボックスは一部選択のため indeterminate
const allCheckbox = document.getElementById("region-select-all");
assert(allCheckbox.indeterminate === true, "全国チェックボックスも indeterminate");

// 5. クリアボタンで全解除
const clearButton = container.querySelector(".region-controls__clear");
clearButton.dispatchEvent(new dom.window.Event("click"));
assert(lastSelected.size === 0, "クリア後は0件選択");
assert(tohokuCheckbox.checked === false && tohokuCheckbox.indeterminate === false, "クリア後は東北も未選択・indeterminate解除");

// 6. 一括選択チェックボックスONで全地域（47都道府県+南極）が選択される
allCheckbox.checked = true;
allCheckbox.dispatchEvent(new dom.window.Event("change"));
assert(lastSelected.size === totalAreaCount, `一括選択ON → ${totalAreaCount}地域 (実際: ${lastSelected.size})`);
assert(lastSelected.has("南極"), "南極（昭和基地）も選択対象に含まれる");

// 7. updateCounts() で、選択状態を保ったまま件数表示だけが更新される（フェーズ10）
const hokkaidoLabelBefore = container.querySelector("#region-hokkaido + .region-group__label").textContent;
regionSelector.updateCounts(new Map([["北海道", 3]]));

const hokkaidoLabelAfter = container.querySelector("#region-hokkaido + .region-group__label").textContent;
assert(hokkaidoLabelBefore !== hokkaidoLabelAfter, "updateCounts() で地方の件数表示が変わる");
assert(hokkaidoLabelAfter === "北海道 (3)", `地方の件数は配下都道府県の合計になる (実際: ${hokkaidoLabelAfter})`);

const aomoriLabel = container.querySelector("#pref-tohoku-青森県 + .prefecture-item__label").textContent;
assert(aomoriLabel.includes("青森県 (0)"), `件数が渡されなかった都道府県は0件表示になる (実際: ${aomoriLabel})`);
assert(
  container.querySelector("#pref-tohoku-青森県").parentElement.classList.contains("prefecture-item--empty"),
  "0件の都道府県には prefecture-item--empty が付く"
);
assert(lastSelected.size === totalAreaCount, "updateCounts() は選択状態を変えない");
assert(container.querySelector("#pref-tohoku-青森県").checked === true, "updateCounts() はチェックボックスの状態も保つ");

// 8. 「47都道府県一括選択」チェックボックス（南極を含まない一括選択。今回追加） ---------------
clearButton.dispatchEvent(new dom.window.Event("click"));
assert(lastSelected.size === 0, "テスト8の前提: クリア済み");

const japanCount = data.regions
  .filter((r) => r.id !== "antarctica")
  .reduce((sum, r) => sum + r.prefectures.length, 0);
const japanCheckbox = document.getElementById("region-select-japan");
assert(!!japanCheckbox, "「47都道府県一括選択」チェックボックスが存在する");

japanCheckbox.checked = true;
japanCheckbox.dispatchEvent(new dom.window.Event("change"));
assert(lastSelected.size === japanCount, `47都道府県一括選択ON → ${japanCount}件選択 (実際: ${lastSelected.size})`);
assert(!lastSelected.has("南極"), "47都道府県一括選択には南極（昭和基地）が含まれない");
assert(allCheckbox.indeterminate === true, "南極だけ未選択のため「すべて一括選択」はindeterminateになる");

// 「すべて一括選択」をONにすると南極も含めて全地域が選択される
allCheckbox.checked = true;
allCheckbox.dispatchEvent(new dom.window.Event("change"));
assert(lastSelected.has("南極"), "「すべて一括選択」で南極（昭和基地）も選択される");
assert(japanCheckbox.checked === true, "南極を含む全選択でも47都道府県一括選択はONのまま");

// 南極だけ選ぶと、47都道府県一括選択はOFF（南極は対象外のチェックボックスのため）
clearButton.dispatchEvent(new dom.window.Event("click"));
const antarcticaCheckbox = document.getElementById("region-antarctica");
antarcticaCheckbox.checked = true;
antarcticaCheckbox.dispatchEvent(new dom.window.Event("change"));
assert(japanCheckbox.checked === false && japanCheckbox.indeterminate === false, "南極のみ選択時、47都道府県一括選択はOFFのまま");
assert(allCheckbox.indeterminate === true, "南極のみ選択時、すべて一括選択はindeterminate");

clearButton.dispatchEvent(new dom.window.Event("click"));

// --- 9. hokkaidoSubAreas を渡すと、北海道カードが宗谷・上川等14地域を持つ1枚になる（フェーズ23・24） ---
{
  const container2 = document.createElement("div");
  let lastSelected2 = null;

  const regionSelector2 = initRegionSelector({
    container: container2,
    regions: data.regions,
    hokkaidoSubAreas: data.hokkaidoSubAreas,
    stationCounts: counts, // 北海道分のキーは無いが件数0扱いになるだけで問題ない
    onChange: (selected) => {
      lastSelected2 = selected;
    },
  });

  const allAreas = data.hokkaidoSubAreas.flatMap((sub) => sub.areas);
  assert(!!container2.querySelector("#region-hokkaido"), "北海道は1枚のカードのまま描画される（フェーズ24で2枚組から統合）");
  assert(allAreas.length === 14, "北海道の地域は14件ある（テストの前提）");
  assert(
    allAreas.every((area) => !!container2.querySelector(`#pref-hokkaido-${area}`)),
    "北海道カードに14地域分のチェックボックスがある"
  );
  assert(!container2.querySelector("#pref-hokkaido-北海道"), "都道府県名「北海道」自体のチェックボックスは無い");

  // 北海道カードの地方チェックボックスをONにすると、14地域名すべてが選択される（都道府県名「北海道」ではない）
  const hokkaidoCheckbox2 = container2.querySelector("#region-hokkaido");
  hokkaidoCheckbox2.checked = true;
  hokkaidoCheckbox2.dispatchEvent(new dom.window.Event("change"));
  assert(lastSelected2.size === 14, `北海道カードON → 14地域選択 (実際: ${lastSelected2.size})`);
  assert(allAreas.every((area) => lastSelected2.has(area)), "選択された値は地域名（宗谷・上川等）");
  assert(!lastSelected2.has("北海道"), "都道府県名「北海道」そのものは選択値に含まれない");

  // 沖縄・南極も他の地方と同じ大きさのカードとして描画される（フェーズ25で重ね表示を廃止）
  assert(!!container2.querySelector("#region-okinawa"), "沖縄のカードが描画される");
  assert(!!container2.querySelector("#region-antarctica"), "南極のカードが描画される");

  regionSelector2.updateCounts(new Map([["宗谷", 5]]));
  assert(
    container2.querySelector("#pref-hokkaido-宗谷 + .prefecture-item__label").textContent.includes("(5)"),
    "updateCounts() は北海道の地域にも反映される"
  );
}

// hokkaidoSubAreas を渡さない場合は、従来通り「北海道」が1枚のカードのまま
{
  const container3 = document.createElement("div");
  initRegionSelector({
    container: container3,
    regions: data.regions,
    stationCounts: counts,
    onChange: () => {},
  });
  assert(!!container3.querySelector("#region-hokkaido"), "hokkaidoSubAreas省略時は従来通り北海道が1枚のカード");
  assert(!!container3.querySelector("#pref-hokkaido-北海道"), "hokkaidoSubAreas省略時のチェックボックスは都道府県名のまま");
}

console.log("\nすべてのテストが成功しました。");
