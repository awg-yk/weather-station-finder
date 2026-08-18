/**
 * test-discontinued.mjs
 * ------------------------------------------------------------
 * 「廃止済み観測所を含める」機能（フェーズ16）のテスト。
 *   - data/stations.json の discontinuedStations のデータ整合性
 *   - discontinuedFilter.js のチェックボックスUI
 *   - mapView.js（マーカー色・ポップアップ）の廃止済み観測所向けの表示
 *   - stationList.js（一覧の「廃止」タグ・観測期間表示）
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "fs";

const dom = new JSDOM("<!DOCTYPE html><div id='root'></div>", { url: "http://localhost/" });
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;
global.HTMLElement = dom.window.HTMLElement;

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("OK:", msg);
}

const data = JSON.parse(readFileSync("./data/stations.json", "utf-8"));

// --- データ整合性 -----------------------------------------------------------

assert(Array.isArray(data.discontinuedStations), "discontinuedStationsが配列として存在する");
assert(data.discontinuedStations.length === 506, `廃止済み観測所は506件 (実際: ${data.discontinuedStations.length})`);

const regionIds = new Set(data.regions.map((r) => r.id));
const mainIds = new Set(data.stations.map((s) => s.id));

data.discontinuedStations.forEach((s) => {
  assert(typeof s.id === "string" && s.id.length > 0, `id: ${s.name}`);
  assert(!mainIds.has(s.id), `${s.name}のidが現行観測所と重複していない`);
  assert(s.discontinued === true, `${s.name}: discontinued=trueが設定されている`);
  assert(typeof s.observedFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.observedFrom), `${s.name}: observedFromがISO日付形式`);
  assert(typeof s.observedTo === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.observedTo), `${s.name}: observedToがISO日付形式`);
  assert(regionIds.has(s.region), `${s.name}: regionが規定のregions master内`);
  assert(typeof s.lat === "number" && s.lat > 20 && s.lat < 46, `${s.name}: 緯度が日本国内の範囲`);
  assert(typeof s.lon === "number" && s.lon > 122 && s.lon < 154, `${s.name}: 経度が日本国内の範囲`);
  // フェーズ19: block_numbers.json（etrnの地点選択ページのスクレイピング結果）と突き合わせて
  // 一意に一致した386件だけprecNo/blockNoを確定している。両方揃うか、両方とも無いかのどちらか。
  assert(
    (s.precNo && s.blockNo) || (!s.precNo && !s.blockNo),
    `${s.name}: precNo/blockNoは両方揃うか両方とも無いかのどちらか`
  );
});

const ids = data.discontinuedStations.map((s) => s.id);
assert(new Set(ids).size === ids.length, "discontinuedStations内でidの重複がない");

const withLink = data.discontinuedStations.filter((s) => s.precNo && s.blockNo);
assert(withLink.length === 386, `precNo/blockNoが確定している廃止済み観測所は386件 (実際: ${withLink.length})`);

console.log("\nAll discontinued data-integrity checks passed.");

// --- discontinuedFilter.js --------------------------------------------------

const { initDiscontinuedFilter } = await import("./js/modules/discontinuedFilter.js");

const container = document.createElement("div");
let lastChange = null;
initDiscontinuedFilter({
  container,
  count: 506,
  initialChecked: false,
  onChange: (checked) => {
    lastChange = checked;
  },
});

const checkbox = container.querySelector("input[type=checkbox]");
assert(!!checkbox, "チェックボックスが描画される");
assert(checkbox.checked === false, "初期状態は未チェック（既定で廃止済みを含める。フェーズ21）");
assert(container.textContent.includes("506"), "件数(506件)がラベルに表示される");
assert(container.textContent.includes("除外"), "「除外」＝オプトアウトの向きのラベルが表示される（フェーズ21）");

checkbox.checked = true;
checkbox.dispatchEvent(new dom.window.Event("change"));
assert(lastChange === true, "チェックすると onChange(true)（＝除外する）が呼ばれる");

// initialChecked: true の復元（URLクエリで discontinued=0 だった場合を想定）
const container2 = document.createElement("div");
initDiscontinuedFilter({ container: container2, count: 506, initialChecked: true, onChange: () => {} });
assert(container2.querySelector("input[type=checkbox]").checked === true, "initialChecked:trueで初期状態がチェック済み（除外）になる");

// updateCount() で件数だけ更新できる（フェーズ21: 他の絞り込み条件に連動）
const container3 = document.createElement("div");
const handle = initDiscontinuedFilter({ container: container3, count: 506, initialChecked: false, onChange: () => {} });
handle.updateCount(12);
assert(container3.textContent.includes("12件"), "updateCount()でラベルの件数だけが更新される");
assert(container3.querySelector("input[type=checkbox]").checked === false, "updateCount()してもチェック状態は変わらない");

console.log("\nAll discontinuedFilter tests passed.");

// --- mapView.js（廃止済み観測所向けの表示） ---------------------------------

const { getMarkerColor, buildPopupHtml } = await import("./js/modules/mapView.js");

// 地点番号が未確定の廃止済み観測所（precNo/blockNoともに無い）
const noLinkStation = data.discontinuedStations.find((s) => !s.precNo);
assert(!!noLinkStation, "precNo未確定の廃止済み観測所が存在する（テストの前提）");
// フェーズ19でblock_numbers.jsonと突き合わせてprecNo/blockNoが確定した廃止済み観測所
const withLinkStation = data.discontinuedStations.find((s) => s.precNo && s.blockNo);
assert(!!withLinkStation, "precNo/blockNoが確定した廃止済み観測所が存在する（テストの前提）");

assert(getMarkerColor(noLinkStation) === "#9AA1AA", "廃止済み観測所のマーカーは種別に関わらずグレーになる");
assert(
  getMarkerColor({ ...noLinkStation, stationType: "気象官署" }) ===
    getMarkerColor({ ...noLinkStation, stationType: "アメダス" }),
  "廃止済み観測所は種別が違っても同じグレーになる"
);

const popupHtmlNoLink = buildPopupHtml(noLinkStation, { elementLabelMap: new Map() });
assert(popupHtmlNoLink.includes("廃止済み"), "廃止済み観測所のポップアップに「廃止済み」の表示が含まれる");
assert(popupHtmlNoLink.includes(noLinkStation.observedFrom), "ポップアップに観測開始日が含まれる");
assert(popupHtmlNoLink.includes(noLinkStation.observedTo), "ポップアップに観測終了日が含まれる");
assert(!popupHtmlNoLink.includes("<a href"), "地点番号未確定の廃止済み観測所のポップアップにはリンクが無い");

const popupHtmlWithLink = buildPopupHtml(withLinkStation, { elementLabelMap: new Map() });
assert(popupHtmlWithLink.includes("<a href"), "precNo/blockNoが確定した廃止済み観測所のポップアップにはリンクがある");
assert(popupHtmlWithLink.includes(`prec_no=${withLinkStation.precNo}`), "ポップアップのリンクに正しいprec_noが含まれる");
assert(popupHtmlWithLink.includes("廃止済み観測所"), "リンクがあっても廃止済みである旨と観測期間は表示される");
assert(popupHtmlWithLink.includes(withLinkStation.observedFrom), "リンクありでも観測期間（開始日）が表示される");

console.log("\nAll mapView discontinued-station tests passed.");

// --- stationList.js（一覧の「廃止」タグ・観測期間表示） ---------------------

const { renderStationTable } = await import("./js/modules/stationList.js");

const tableContainer = document.createElement("div");
const elementLabelMap = new Map(data.elements.map((el) => [el.id, el.name]));
const regionLabelMap = new Map(data.regions.map((r) => [r.id, r.name]));

renderStationTable(tableContainer, [data.stations[0], noLinkStation, withLinkStation], {
  elementLabelMap,
  regionLabelMap,
});

const rows = [...tableContainer.querySelectorAll("tbody tr")];
assert(rows.length === 3, "現役1件・廃止済み2件、あわせて3行描画される");
assert(!rows[0].classList.contains("station-table__row--discontinued"), "現役観測所の行には廃止クラスが付かない");
assert(rows[1].classList.contains("station-table__row--discontinued"), "廃止済み観測所の行に廃止クラスが付く");
assert(rows[1].querySelector(".station-table__discontinued-badge")?.textContent === "廃止", "廃止済み観測所の行に「廃止」バッジが表示される");
assert(
  rows[1].textContent.includes(noLinkStation.observedFrom.slice(0, 4)),
  "廃止済み観測所の行に観測開始年が表示される"
);
assert(!rows[1].querySelector("a"), "地点番号未確定の廃止済み観測所の地点名はリンクにならない");

assert(rows[2].classList.contains("station-table__row--discontinued"), "precNo確定済みの廃止済み観測所の行にも廃止クラスが付く");
assert(rows[2].querySelector(".station-table__discontinued-badge")?.textContent === "廃止", "precNo確定済みでも「廃止」バッジは表示される");
const linkInRow2 = rows[2].querySelector("a");
assert(!!linkInRow2, "precNo/blockNoが確定した廃止済み観測所の地点名はリンクになる（フェーズ19）");
assert(
  linkInRow2.getAttribute("href").includes(`prec_no=${withLinkStation.precNo}`),
  "そのリンク先に正しいprec_noが含まれる"
);

console.log("\nAll stationList discontinued-station tests passed.");
