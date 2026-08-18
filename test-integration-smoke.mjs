/**
 * test-integration-smoke.mjs
 * ------------------------------------------------------------
 * index.html を実際にjsdomで読み込み、main.jsを走らせて
 * 「検索・地域選択・要素選択・ページネーションがDOM上で
 * 実際に噛み合っているか」を確認する統合テスト。
 * 個別モジュールの単体テストでは検出できない、
 * HTML側のID不一致や配線ミスを見つけるためのもの。
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "fs";
import { regionSelectorKey } from "./js/modules/filterEngine.js";

const html = readFileSync("./index.html", "utf-8");
const stationsJson = readFileSync("./data/stations.json", "utf-8");

const dom = new JSDOM(html, {
  url: "http://localhost/",
  runScripts: "dangerously",
});

// fetch("data/stations.json") をダミー実装で差し替える
dom.window.fetch = async (url) => {
  if (String(url).includes("stations.json")) {
    return { ok: true, json: async () => JSON.parse(stationsJson) };
  }
  throw new Error("unexpected fetch: " + url);
};

function loadScript(win, path) {
  const code = readFileSync(path, "utf-8");
  const script = win.document.createElement("script");
  script.type = "module";
  script.textContent = code;
  win.document.body.appendChild(script);
}

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("OK:", msg);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const win = dom.window;
const doc = win.document;

// main.js は type="module" の相対importを使っているため、jsdom単体では
// モジュール解決ができない。代わりにNodeのESMローダーでmain.jsを直接importし、
// dom.window をグローバルとして差し込む簡易アプローチを取る。
global.window = win;
global.document = doc;
global.fetch = win.fetch;
global.Node = win.Node;
global.HTMLElement = win.HTMLElement;

await import("./js/main.js");

// 初期読み込み（fetch + 各モジュール初期化）が終わるまで少し待つ
await wait(50);

// --- 初期表示: 絞り込む前は一覧を出さず、案内文だけを表示する（フェーズ22） ---
const rowsInitial = doc.querySelectorAll("#station-table-container tbody tr");
assert(rowsInitial.length === 0, `絞り込む前は一覧に行を出さない (実際: ${rowsInitial.length})`);
assert(
  doc.querySelector("#station-table-container .empty-state") != null,
  "絞り込む前は代わりに案内文（empty-state）が表示される"
);

// --- 検索: 「東京」で絞り込む ---
const searchInput = doc.querySelector("#keyword-search-container .keyword-search__input");
assert(searchInput != null, "検索ボックスが描画されている");

searchInput.value = "東京";
searchInput.dispatchEvent(new win.Event("input"));
await wait(300); // デバウンス(200ms)待ち

const rowsAfterSearch = doc.querySelectorAll("#station-table-container tbody tr");
assert(rowsAfterSearch.length > 0, "「東京」検索でヒットする観測所がある");
assert(rowsAfterSearch.length < 50, "「東京」検索で全件よりずっと少ない件数に絞り込まれる");

const paginationButtons = doc.querySelectorAll("#pagination-container .pagination__page");
assert(paginationButtons.length > 0, "検索結果に対してページネーションが描画されている");

const firstRowText = rowsAfterSearch[0].textContent;
assert(firstRowText.includes("東京") || firstRowText.includes("都"), "絞り込み結果に「東京」関連の文字列が含まれる");

// --- 検索クリアで全件表示に戻る ---
const clearBtn = doc.querySelector("#keyword-search-container .keyword-search__clear");
clearBtn.dispatchEvent(new win.Event("click"));
await wait(300);

const rowsAfterClear = doc.querySelectorAll("#station-table-container tbody tr");
assert(rowsAfterClear.length === 0, "検索クリア後は絞り込みなしに戻り、一覧は空になる");

// --- 種別フィルタ: 「気象台等」だけに絞り込む -------------------------------
const kanshoCheckbox = doc.querySelector("#type-filter-container #type-気象台等");
assert(!!kanshoCheckbox, "種別フィルタに「気象台等」のチェックボックスが描画されている");

kanshoCheckbox.checked = true;
kanshoCheckbox.dispatchEvent(new win.Event("change"));
await wait(50);

const rowsAfterTypeFilter = [...doc.querySelectorAll("#station-table-container tbody tr")];
assert(rowsAfterTypeFilter.length > 0, "種別で絞り込んでも観測所が表示される");

// 既定では廃止済み観測所も母集団に含まれる（フェーズ21）ので、現役＋廃止済みの両方を数える。
const stationsData = JSON.parse(stationsJson);
const kanshoCount = [...stationsData.stations, ...stationsData.discontinuedStations].filter(
  (s) => s.stationType === "気象台等"
).length;
const statusTextAfterTypeFilter = doc.querySelector("#status-count").textContent;
assert(
  statusTextAfterTypeFilter.includes(`絞り込み ${kanshoCount}件`),
  `「気象官署」で絞り込むと${kanshoCount}件になる (実際の表示: ${statusTextAfterTypeFilter})`
);

// --- 件数表示が他の絞り込みに連動する（フェーズ10） -------------------------
// 種別の絞り込みが残っていると件数の期待値が変わるため、いったん解除する
kanshoCheckbox.checked = false;
kanshoCheckbox.dispatchEvent(new win.Event("change"));
await wait(50);

const elementLabelOf = (id) =>
  doc.querySelector(`#element-filter-container #element-${id} ~ .element-item__label`).textContent;

const tempLabelNationwide = elementLabelOf("temperature");

// 北海道は地域選択UI上、宗谷・上川など14地域を持つ1枚のカードになっている（フェーズ23・24）
const hokkaidoCheckbox = doc.querySelector("#region-selector-container #region-hokkaido");
assert(!!hokkaidoCheckbox, "北海道のカードが描画されている");
hokkaidoCheckbox.checked = true;
hokkaidoCheckbox.dispatchEvent(new win.Event("change"));
await wait(50);

const tempLabelHokkaido = elementLabelOf("temperature");
assert(
  tempLabelHokkaido !== tempLabelNationwide,
  `北海道を選ぶと観測要素の件数表示が変わる (全国: ${tempLabelNationwide} → 北海道: ${tempLabelHokkaido})`
);

// 北海道カードが選択済みなので、regionSelectorKey が地域名（＝北海道かつprecNo確定済み）に
// 解決される観測所だけが該当する（precNo未確定の廃止済み観測所は選択対象に含まれない）
const expectedHokkaidoTemp = [...stationsData.stations, ...stationsData.discontinuedStations].filter(
  (s) => s.prefecture === "北海道" && regionSelectorKey(s) !== s.prefecture && s.elements.includes("temperature")
).length;
assert(
  tempLabelHokkaido.includes(`(${expectedHokkaidoTemp})`),
  `観測要素の件数が北海道内の気温観測地点数になる (期待: ${expectedHokkaidoTemp}, 実際: ${tempLabelHokkaido})`
);

// --- 一覧テーブルの列構成（プリセット廃止・気象庁リンクの地点名化） -----------
const headerCells = [...doc.querySelectorAll("#station-table-container thead th")].map((th) => th.textContent);
assert(
  headerCells.join(",") === "地点コード,地点名,かな,都道府県,地方,標高(m),緯度,経度,観測要素,種別",
  `一覧の列が想定通り (実際: ${headerCells.join(",")})`
);
assert(!doc.querySelector("#preset-panel-container"), "プリセットパネルは廃止されている");

const firstNameLink = doc.querySelector("#station-table-container tbody a.station-table__name--link");
assert(!!firstNameLink, "地点名が気象庁ページへのリンクになっている");
assert(
  firstNameLink.getAttribute("href").startsWith("https://www.data.jma.go.jp/stats/etrn/index.php?"),
  `地点名リンクの遷移先がetrnの地点選択済みページ (実際: ${firstNameLink.getAttribute("href")})`
);

const firstTag = doc.querySelector("#station-table-container tbody .tag:not(.tag--empty)");
assert(
  /tag--(temperature|precipitation|snow|wind|humidity|sunshine)/.test(firstTag.className),
  `観測要素タグに要素ごとの色クラスが付く (実際: ${firstTag.className})`
);

// --- 一覧の行クリックで選択状態になる（マーカー⇔一覧行の相互連携。フェーズ15） -------
const rowsForSelection = [...doc.querySelectorAll("#station-table-container tbody tr")];
const secondRow = rowsForSelection[1];
secondRow.dispatchEvent(new win.Event("click", { bubbles: true }));
await wait(10);

const selectedRows = doc.querySelectorAll("#station-table-container tbody tr.station-table__row--selected");
assert(selectedRows.length === 1, "行クリックで選択行が1件だけハイライトされる");
assert(selectedRows[0].getAttribute("aria-selected") === "true", "選択された行にaria-selected=trueが付く");

// 別の行をクリックすると選択が移る（同時に2件ハイライトされない）
// renderStationTable は毎回テーブル全体を作り直すため、行はDOM参照ではなく地点コードで追跡する
const thirdRow = doc.querySelectorAll("#station-table-container tbody tr")[2];
const thirdRowStationId = thirdRow.querySelector(".station-table__id").textContent;
thirdRow.dispatchEvent(new win.Event("click", { bubbles: true }));
await wait(10);
const selectedRowsAfter = doc.querySelectorAll("#station-table-container tbody tr.station-table__row--selected");
assert(
  selectedRowsAfter.length === 1 &&
    selectedRowsAfter[0].querySelector(".station-table__id").textContent === thirdRowStationId,
  "別の行をクリックすると選択がそちらに移る"
);

// 絞り込み条件を変えると選択状態は解除される（表示から外れた地点の選択が残らないように）
kanshoCheckbox.checked = true;
kanshoCheckbox.dispatchEvent(new win.Event("change"));
await wait(50);
assert(
  doc.querySelectorAll("#station-table-container tbody tr.station-table__row--selected").length === 0,
  "絞り込み条件を変えると選択状態が解除される"
);
kanshoCheckbox.checked = false;
kanshoCheckbox.dispatchEvent(new win.Event("change"));
await wait(50);

// --- 「廃止済みの観測地点を含めない」チェックボックス（フェーズ16・21） ------
// ここまでのテストで北海道フィルタがオンのままなので、クリーンな状態に戻す
hokkaidoCheckbox.checked = false;
hokkaidoCheckbox.dispatchEvent(new win.Event("change"));
await wait(50);

const discontinuedCount = stationsData.discontinuedStations.length;
const statusBeforeDiscontinued = doc.querySelector("#status-count").textContent;
assert(
  statusBeforeDiscontinued.includes(`全 ${1287 + discontinuedCount} 件中`),
  `既定では廃止済み観測所を含む (実際: ${statusBeforeDiscontinued})`
);

const discontinuedCheckbox = doc.querySelector("#discontinued-filter-container input[type=checkbox]");
assert(!!discontinuedCheckbox, "「廃止済みの観測地点を含めない」チェックボックスが描画されている");
assert(discontinuedCheckbox.checked === false, "既定ではチェックが外れている（＝廃止済みを含む）");

// 50件/ページの1ページ目に廃止済み観測所が含まれるとは限らないため、検索で1件に絞ってから確認する
searchInput.value = "阿蘇山";
searchInput.dispatchEvent(new win.Event("input"));
await wait(300);
const asosanRow = doc.querySelector("#station-table-container tbody tr");
assert(!!asosanRow, "既定の状態で検索すると廃止済み観測所（阿蘇山）がヒットする");
assert(
  asosanRow.classList.contains("station-table__row--discontinued"),
  "廃止済み観測所を含む既定状態では、検索結果にも廃止済み観測所が現れる"
);
assert(!!asosanRow.querySelector(".station-table__discontinued-badge"), "「廃止」バッジが表示される");

discontinuedCheckbox.checked = true;
discontinuedCheckbox.dispatchEvent(new win.Event("change"));
await wait(50);

const statusAfterDiscontinued = doc.querySelector("#status-count").textContent;
assert(
  statusAfterDiscontinued.includes("全 1287 件"),
  `チェックすると廃止済み観測所が母数から除かれる (実際: ${statusAfterDiscontinued})`
);
assert(
  doc.querySelectorAll("#station-table-container tbody tr").length === 0,
  "「含めない」をチェックした状態で検索すると廃止済み観測所（阿蘇山）はヒットしなくなる"
);

searchInput.value = "";
searchInput.dispatchEvent(new win.Event("input"));
await wait(300);
discontinuedCheckbox.checked = false;
discontinuedCheckbox.dispatchEvent(new win.Event("change"));
await wait(50);

console.log("\nAll integration smoke tests passed.");
