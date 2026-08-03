/**
 * test-facet-counts.mjs
 * ------------------------------------------------------------
 * フェーズ10で追加した buildFacetCounts()（絞り込み条件に連動した件数集計）と、
 * 南極・昭和基地のデータ収録を確認するテスト。
 *
 * 数え方の約束:
 *   - ある軸（地域／観測要素／種別）の件数は、その軸自身の選択を無視し、
 *     他の軸の条件だけを適用した母集団を数える（一般的なファセット検索と同じ）
 *   - キーワード検索は軸ではなく常時適用の条件なので、すべての件数に効く
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "fs";

const dom = new JSDOM("<!DOCTYPE html><div id='root'></div>", { url: "http://localhost/" });
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;

const { buildFacetCounts, computeVisibleStations, buildElementCounts, regionSelectorKey, getHokkaidoArea } =
  await import("./js/modules/filterEngine.js");
const data = JSON.parse(readFileSync("./data/stations.json", "utf-8"));

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("OK:", msg);
}

const noFilters = {
  selectedPrefectures: new Set(),
  selectedElements: new Set(),
  elementLogic: "AND",
  selectedStationTypes: new Set(),
  keyword: "",
};

// --- 絞り込みなしのときは全観測所ベースの件数 -----------------------------

const base = buildFacetCounts(data.stations, noFilters);
// 北海道は都道府県名ではなく、宗谷・上川など14地域（precNo由来）単位で集計される（フェーズ23）
const ishikariStations = data.stations.filter((s) => regionSelectorKey(s) === "石狩");
assert(ishikariStations.length > 0, "石狩地域（札幌など）に該当する観測所がある（テストの前提）");
assert(
  base.prefectureCounts.get("石狩") === ishikariStations.length,
  "絞り込みなしの地域件数は全観測所ベース（北海道は地域単位）"
);
assert(
  base.prefectureCounts.get("北海道") === undefined,
  "北海道は都道府県名そのものではキー化されない（宗谷・上川などに分割されるため）"
);
assert(
  base.elementCounts.get("temperature") === buildElementCounts(data.stations).get("temperature"),
  "絞り込みなしの観測要素件数は全観測所ベース"
);

// --- 地域を絞ると観測要素・種別の件数がそれに追随する ----------------------

const hokkaidoOnly = { ...noFilters, selectedPrefectures: new Set(["石狩"]) };
const hokkaido = buildFacetCounts(data.stations, hokkaidoOnly);
const hokkaidoStations = ishikariStations;

assert(
  hokkaido.elementCounts.get("temperature") ===
    hokkaidoStations.filter((s) => s.elements.includes("temperature")).length,
  "石狩地域だけ選ぶと観測要素の件数が石狩地域内の件数になる"
);
assert(
  hokkaido.elementCounts.get("temperature") < base.elementCounts.get("temperature"),
  "絞り込み後の観測要素件数は全国の件数より少ない"
);
assert(
  hokkaido.stationTypeCounts.get("気象台等") ===
    hokkaidoStations.filter((s) => s.stationType === "気象台等").length,
  "石狩地域だけ選ぶと種別の件数も石狩地域内の件数になる"
);
assert(
  hokkaido.prefectureCounts.get("東京都") === base.prefectureCounts.get("東京都"),
  "自分自身の軸（地域）の選択は、その軸の件数には影響しない"
);

// --- 観測要素を絞ると都道府県の件数がそれに追随する ------------------------

const snowOnly = { ...noFilters, selectedElements: new Set(["snow"]) };
const snow = buildFacetCounts(data.stations, snowOnly);
assert(
  snow.prefectureCounts.get("石狩") === ishikariStations.filter((s) => s.elements.includes("snow")).length,
  "積雪で絞ると地域の件数が積雪観測地点の件数になる"
);
assert(
  snow.elementCounts.get("snow") === base.elementCounts.get("snow"),
  "自分自身の軸（観測要素）の選択は、その軸の件数には影響しない"
);

// --- 北海道の14地域分割（フェーズ23）---------------------------------------

const allHokkaidoStations = data.stations.filter((s) => s.prefecture === "北海道");
const HOKKAIDO_AREAS = [
  "宗谷", "上川", "留萌", "石狩", "空知", "後志", "オホーツク",
  "根室", "釧路", "十勝", "胆振", "日高", "渡島", "檜山",
];
assert(
  allHokkaidoStations.every((s) => HOKKAIDO_AREAS.includes(getHokkaidoArea(s))),
  "北海道の全観測所（precNo確定済み）が14地域のいずれかに分類される"
);
const areaTotal = HOKKAIDO_AREAS.reduce(
  (sum, area) => sum + data.stations.filter((s) => regionSelectorKey(s) === area).length,
  0
);
assert(areaTotal === allHokkaidoStations.length, "14地域の合計は北海道の観測所数と一致する");
assert(getHokkaidoArea({ prefecture: "東京都", precNo: "11" }) === null, "北海道以外の観測所はnullを返す");

const soyaOnly = { ...noFilters, selectedPrefectures: new Set(["宗谷"]) };
const soyaCount = computeVisibleStations(data.stations, soyaOnly).length;
assert(soyaCount > 0 && soyaCount < allHokkaidoStations.length, "宗谷地域だけで絞り込むと北海道全体よりは少なくなる");

// --- キーワード検索はすべての軸の件数に効く --------------------------------

const keywordOnly = { ...noFilters, keyword: "札幌" };
const keyword = buildFacetCounts(data.stations, keywordOnly);
const keywordTotal = computeVisibleStations(data.stations, keywordOnly).length;
assert(keywordTotal > 0, "テスト用キーワードでヒットする観測所がある");
assert(
  [...keyword.prefectureCounts.values()].reduce((a, b) => a + b, 0) === keywordTotal,
  "キーワードは都道府県の件数にも効く"
);
assert(
  [...keyword.stationTypeCounts.values()].reduce((a, b) => a + b, 0) === keywordTotal,
  "キーワードは種別の件数にも効く"
);

// --- 南極・昭和基地の収録内容 ---------------------------------------------

const syowa = data.stations.find((s) => s.name === "昭和基地");
assert(!!syowa, "昭和基地が観測所マスタに収録されている");
assert(syowa.prefecture === "南極" && syowa.region === "antarctica", "昭和基地は地方「南極」に属する");
assert(!!data.regions.find((r) => r.id === "antarctica"), "regionsマスタに南極が定義されている");
assert(syowa.lat < -60 && syowa.lon > 0, "昭和基地の緯度経度が南半球（東経）の値になっている");
assert(syowa.precNo === "99" && syowa.blockNo === "89532", "気象庁の地点番号（prec_no=99 / block_no=89532）を持つ");
assert(syowa.stationType === "気象台等", "昭和基地は気象台等として扱う");
assert(
  !syowa.elements.includes("precipitation"),
  "昭和基地は降水量を観測していないため観測要素に含めない"
);
assert(syowa.elements.includes("temperature"), "昭和基地の観測要素に気温が含まれる");

const antarcticaOnly = { ...noFilters, selectedPrefectures: new Set(["南極"]) };
assert(
  computeVisibleStations(data.stations, antarcticaOnly).length === 1,
  "南極で絞り込むと昭和基地の1件だけになる"
);

console.log("\nAll facet-count tests passed.");
