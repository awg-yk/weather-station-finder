import { JSDOM } from "jsdom";

const dom = new JSDOM("<!DOCTYPE html><div id='root'></div>", { url: "http://localhost/test/" });
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;
global.URLSearchParams = dom.window.URLSearchParams;

const { parseStateFromUrl, buildQueryString, syncUrlWithState } = await import("./js/modules/urlState.js");

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("OK:", msg);
}

// --- parseStateFromUrl ---------------------------------------------------

const empty = parseStateFromUrl(new URLSearchParams(""));
assert(empty.prefectures.size === 0, "パラメータなしなら都道府県は未選択");
assert(empty.elements.size === 0, "パラメータなしなら観測要素は未選択");
assert(empty.elementLogic === "AND", "パラメータなしならモードはAND");
assert(empty.stationTypes.size === 0, "パラメータなしなら種別は未選択");
assert(empty.keyword === "", "パラメータなしならキーワードは空");
assert(empty.page === 1, "パラメータなしなら1ページ目");

const full = parseStateFromUrl(new URLSearchParams("pref=青森県,秋田県&elem=temperature,wind&mode=OR&type=kansho,amedas&q=空港&page=3"));
assert(full.prefectures.size === 2 && full.prefectures.has("青森県") && full.prefectures.has("秋田県"), "都道府県をカンマ区切りで復元");
assert(full.elements.size === 2 && full.elements.has("temperature") && full.elements.has("wind"), "観測要素をカンマ区切りで復元");
assert(full.elementLogic === "OR", "mode=ORを復元");
assert(
  full.stationTypes.size === 2 && full.stationTypes.has("気象台等") && full.stationTypes.has("アメダス"),
  "種別コードを日本語名に復元する"
);
assert(full.keyword === "空港", "キーワードを復元");
assert(full.page === 3, "ページ番号を復元");

const unknownTypeCode = parseStateFromUrl(new URLSearchParams("type=kansho,unknown_code"));
assert(
  unknownTypeCode.stationTypes.size === 1 && unknownTypeCode.stationTypes.has("気象台等"),
  "未知の種別コードは無視し、既知のものだけ復元する"
);

const invalidPage = parseStateFromUrl(new URLSearchParams("page=0"));
assert(invalidPage.page === 1, "0以下のページ番号は1に補正される");

const nonNumericPage = parseStateFromUrl(new URLSearchParams("page=abc"));
assert(nonNumericPage.page === 1, "数値でないページ番号は1に補正される");

const unknownMode = parseStateFromUrl(new URLSearchParams("mode=XYZ"));
assert(unknownMode.elementLogic === "AND", "不正なmode値はANDにフォールバックする");

assert(empty.includeDiscontinued === true, "パラメータなしなら廃止済み観測所を含める（既定。フェーズ21）");
const withoutDiscontinued = parseStateFromUrl(new URLSearchParams("discontinued=0"));
assert(withoutDiscontinued.includeDiscontinued === false, "discontinued=0で廃止済み観測所を含めない状態を復元する");
const otherValueDiscontinued = parseStateFromUrl(new URLSearchParams("discontinued=yes"));
assert(otherValueDiscontinued.includeDiscontinued === true, "discontinued=0以外の値は含める扱いにする");

// --- buildQueryString -----------------------------------------------------

assert(
  buildQueryString({
    selectedPrefectures: new Set(),
    selectedElements: new Set(),
    keyword: "",
    page: 1,
    includeDiscontinued: true,
  }) === "",
  "絞り込みなしの状態は空のクエリ文字列になる"
);

const qs = buildQueryString({
  selectedPrefectures: new Set(["東京都"]),
  selectedElements: new Set(["snow"]),
  elementLogic: "OR",
  selectedStationTypes: new Set(["気象台等"]),
  keyword: "山",
  page: 2,
  includeDiscontinued: true,
});
assert(qs.includes("pref=%E6%9D%B1%E4%BA%AC%E9%83%BD") || qs.includes("pref=東京都"), "都道府県パラメータを含む");
assert(qs.includes("elem=snow"), "観測要素パラメータを含む");
assert(qs.includes("mode=OR"), "ORモードのときはmodeパラメータを含む");
assert(qs.includes("type=kansho"), "種別パラメータを短いコードで含む");
assert(qs.includes("page=2"), "1ページ目以外のときはpageパラメータを含む");

const qsDefaultMode = buildQueryString({
  selectedPrefectures: new Set(),
  selectedElements: new Set(["snow"]),
  elementLogic: "AND",
  keyword: "",
  page: 1,
  includeDiscontinued: true,
});
assert(!qsDefaultMode.includes("mode="), "ANDモード（既定値）のときはmodeパラメータを省略する");
assert(!qsDefaultMode.includes("page="), "1ページ目（既定値）のときはpageパラメータを省略する");

assert(!qsDefaultMode.includes("discontinued="), "含める（既定値）のときはdiscontinuedパラメータを省略する");
const qsWithoutDiscontinued = buildQueryString({
  selectedPrefectures: new Set(),
  selectedElements: new Set(),
  keyword: "",
  page: 1,
  includeDiscontinued: false,
});
assert(qsWithoutDiscontinued.includes("discontinued=0"), "含めない場合はdiscontinued=0パラメータを含む");

// --- syncUrlWithState（history.replaceStateの呼び出し確認） ---------------

let replaceStateCalls = 0;
const fakeHistory = {
  replaceState: (...args) => {
    replaceStateCalls += 1;
    dom.window.history.replaceState(...args);
  },
};

syncUrlWithState(
  { selectedPrefectures: new Set(["北海道"]), selectedElements: new Set(), keyword: "", page: 1 },
  { location: dom.window.location, history: fakeHistory }
);
assert(replaceStateCalls === 1, "絞り込み条件が変わればreplaceStateが呼ばれる");
assert(dom.window.location.search.includes("pref="), "URLのクエリ文字列が更新される");

replaceStateCalls = 0;
syncUrlWithState(
  { selectedPrefectures: new Set(["北海道"]), selectedElements: new Set(), keyword: "", page: 1 },
  { location: dom.window.location, history: fakeHistory }
);
assert(replaceStateCalls === 0, "同じ状態なら再度replaceStateは呼ばれない（無駄な履歴操作をしない）");

console.log("\nAll urlState tests passed.");
