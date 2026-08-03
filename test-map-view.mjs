import { JSDOM } from "jsdom";

// mapView.js の buildPopupHtml() は内部で document を直接触らないが、
// import chain (exporter.js) が document 参照を持つコードパスを含むため、
// 他のテストファイルと同様に最小限の DOM を用意しておく。
const dom = new JSDOM("<!DOCTYPE html><div id='root'></div>", { url: "http://localhost/" });
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;

const { getMarkerColor, buildPopupHtml, isMapGestureModifier, hasActiveFilters } = await import("./js/modules/mapView.js");

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("OK:", msg);
}

// --- getMarkerColor -----------------------------------------------------

assert(getMarkerColor({ stationType: "気象台等" }) === "#1C7C8C", "気象台等はteal色");
assert(getMarkerColor({ stationType: "アメダス" }) === "#E8A33D", "アメダスはamber色");
assert(getMarkerColor({ stationType: "不明種別" }) === "#5B6672", "未知の種別はデフォルト色");
assert(getMarkerColor({}) === "#5B6672", "stationType未指定でもデフォルト色（例外を投げない）");

// --- buildPopupHtml -------------------------------------------------------

const elementLabelMap = new Map([
  ["temperature", "気温"],
  ["precipitation", "降水量"],
]);

const stationWithLink = {
  id: "31506",
  name: "三沢",
  kana: "ミサワ",
  prefecture: "青森県",
  stationType: "アメダス",
  alt: 39,
  elements: ["temperature", "precipitation"],
  precNo: "31",
  blockNo: "0169",
};

const htmlWithLink = buildPopupHtml(stationWithLink, { elementLabelMap });
assert(htmlWithLink.includes("三沢"), "地点名がポップアップHTMLに含まれる");
assert(htmlWithLink.includes("ミサワ"), "かな読みがポップアップHTMLに含まれる");
assert(htmlWithLink.includes("気温・降水量"), "観測要素が日本語ラベルで連結される");
assert(htmlWithLink.includes("prec_no=31"), "precNo/blockNoが揃っていれば気象庁リンクを含む");

const stationWithoutLink = { ...stationWithLink, precNo: undefined, blockNo: undefined };
const htmlWithoutLink = buildPopupHtml(stationWithoutLink, { elementLabelMap });
assert(
  htmlWithoutLink.includes("気象庁リンク未収録"),
  "precNo/blockNoが欠けている場合はリンクの代わりに未収録表示"
);

const stationWithAmbiguousCandidates = {
  ...stationWithLink,
  precNo: undefined,
  blockNo: undefined,
  precNoAmbiguous: "19",
  blockNoAmbiguousCandidates: ["0092", "1187"],
};
const htmlWithCandidates = buildPopupHtml(stationWithAmbiguousCandidates, { elementLabelMap });
assert(
  htmlWithCandidates.includes("0092 / 1187"),
  "候補が複数ある場合はその番号一覧をポップアップに表示する"
);
assert(!htmlWithCandidates.includes("気象庁リンク未収録"), "候補がある場合は「未収録」ではなく候補を表示する");

// --- XSS対策（地点名にHTML特殊文字が含まれても壊れない） -----------------

const maliciousStation = {
  name: '<img src=x onerror=alert(1)>',
  kana: "テスト",
  prefecture: "テスト県",
  stationType: "アメダス",
  elements: [],
};
const escapedHtml = buildPopupHtml(maliciousStation, { elementLabelMap });
assert(!escapedHtml.includes("<img"), "地点名内のHTMLタグはエスケープされる");
assert(escapedHtml.includes("&lt;img"), "エスケープ後の文字列が含まれる");

// --- 地図操作の修飾キー判定（意図しないスクロールズーム防止） ---------------

assert(isMapGestureModifier({ ctrlKey: true }) === true, "Ctrl押下は地図操作の修飾キーとして扱う");
assert(isMapGestureModifier({ metaKey: true }) === true, "⌘(macOS)押下も地図操作の修飾キーとして扱う");
assert(isMapGestureModifier({ ctrlKey: false, metaKey: false }) === false, "修飾キー無しの操作は地図に渡さない");
assert(isMapGestureModifier({ shiftKey: true }) === false, "Shiftは地図操作の修飾キーではない");
assert(isMapGestureModifier(undefined) === false, "イベントが無くても例外を投げずfalseを返す");

// --- hasActiveFilters（既定表示で地図を南極までfitBoundsしないための判定。フェーズ22） ---

assert(
  hasActiveFilters({
    selectedPrefectures: new Set(),
    selectedElements: new Set(),
    selectedStationTypes: new Set(),
    keyword: "",
  }) === false,
  "何も絞り込んでいなければfalse（廃止済み観測所が既定で含まれていても絞り込みとは扱わない）"
);
assert(
  hasActiveFilters({
    selectedPrefectures: new Set(["北海道"]),
    selectedElements: new Set(),
    selectedStationTypes: new Set(),
    keyword: "",
  }) === true,
  "地域が選択されていればtrue"
);
assert(
  hasActiveFilters({
    selectedPrefectures: new Set(),
    selectedElements: new Set(["temperature"]),
    selectedStationTypes: new Set(),
    keyword: "",
  }) === true,
  "観測要素が選択されていればtrue"
);
assert(
  hasActiveFilters({
    selectedPrefectures: new Set(),
    selectedElements: new Set(),
    selectedStationTypes: new Set(["気象台等"]),
    keyword: "",
  }) === true,
  "種別が選択されていればtrue"
);
assert(
  hasActiveFilters({
    selectedPrefectures: new Set(),
    selectedElements: new Set(),
    selectedStationTypes: new Set(),
    keyword: "  ",
  }) === false,
  "空白だけのキーワードはfalse扱い"
);
assert(
  hasActiveFilters({
    selectedPrefectures: new Set(),
    selectedElements: new Set(),
    selectedStationTypes: new Set(),
    keyword: "空港",
  }) === true,
  "キーワードが入力されていればtrue"
);

console.log("\nAll mapView tests passed.");
