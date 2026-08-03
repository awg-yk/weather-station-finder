import { matchesKeyword, matchesTypeFilter, computeVisibleStations } from "./js/modules/filterEngine.js";
import { paginate } from "./js/modules/pagination.js";

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("OK:", msg);
}

// --- matchesKeyword -------------------------------------------------------

const tokyo = { name: "東京", kana: "とうきょう", enName: "Tokyo", prefecture: "東京都" };

assert(matchesKeyword(tokyo, "") === true, "空文字は常にマッチする（絞り込みなし）");
assert(matchesKeyword(tokyo, "   ") === true, "空白のみも絞り込みなし扱い");
assert(matchesKeyword(tokyo, "東京") === true, "地点名の部分一致でマッチする");
assert(matchesKeyword(tokyo, "とうきょう") === true, "かなの部分一致でマッチする");
assert(matchesKeyword(tokyo, "tokyo") === true, "英語名の部分一致でマッチする（大文字小文字を無視）");
assert(matchesKeyword(tokyo, "TOKYO") === true, "英語名は大文字小文字を区別しない");
assert(matchesKeyword(tokyo, "東京都") === true, "都道府県名でもマッチする");
assert(matchesKeyword(tokyo, "大阪") === false, "無関係な語句はマッチしない");

// --- computeVisibleStations（キーワード + 地域 + 要素の組み合わせ） --------

const stations = [
  { name: "東京", kana: "とうきょう", prefecture: "東京都", region: "kanto", elements: ["temperature", "wind"] },
  { name: "大阪", kana: "おおさか", prefecture: "大阪府", region: "kinki", elements: ["temperature", "snow"] },
  { name: "東大阪", kana: "ひがしおおさか", prefecture: "大阪府", region: "kinki", elements: ["temperature"] },
];

const onlyOsaka = computeVisibleStations(stations, {
  selectedPrefectures: new Set(),
  selectedElements: new Set(),
  elementLogic: "AND",
  keyword: "大阪",
});
assert(onlyOsaka.length === 2, `「大阪」検索は2件ヒット（大阪・東大阪） (実際: ${onlyOsaka.length})`);

const osakaWithSnow = computeVisibleStations(stations, {
  selectedPrefectures: new Set(),
  selectedElements: new Set(["snow"]),
  elementLogic: "AND",
  keyword: "大阪",
});
assert(osakaWithSnow.length === 1 && osakaWithSnow[0].name === "大阪", "キーワード検索と観測要素フィルタは組み合わさる（AND）");

// --- matchesTypeFilter / 種別フィルタ（フェーズ9） --------------------------

const kansho = { name: "東京", stationType: "気象台等" };
const amedas = { name: "三沢", stationType: "アメダス" };

assert(matchesTypeFilter(kansho, new Set()) === true, "未選択（空集合）は常にtrue（絞り込みなし）");
assert(matchesTypeFilter(kansho, new Set(["気象台等"])) === true, "気象台等を選択していれば気象台等はtrue");
assert(matchesTypeFilter(amedas, new Set(["気象台等"])) === false, "気象台等を選択していてもアメダスはfalse");
assert(matchesTypeFilter(amedas, new Set(["気象台等", "アメダス"])) === true, "両方選択していればどちらもtrue");

const typedStations = [
  { name: "東京", prefecture: "東京都", region: "kanto", elements: [], stationType: "気象台等" },
  { name: "三沢", prefecture: "青森県", region: "tohoku", elements: [], stationType: "アメダス" },
];

const kanshoOnly = computeVisibleStations(typedStations, {
  selectedPrefectures: new Set(),
  selectedElements: new Set(),
  elementLogic: "AND",
  selectedStationTypes: new Set(["気象台等"]),
  keyword: "",
});
assert(
  kanshoOnly.length === 1 && kanshoOnly[0].name === "東京",
  "computeVisibleStations は種別フィルタも合成する"
);

// --- paginate ---------------------------------------------------------------

const items = Array.from({ length: 125 }, (_, i) => ({ id: i + 1 }));

const p1 = paginate(items, 1, 50);
assert(p1.items.length === 50 && p1.items[0].id === 1, "1ページ目は先頭50件");
assert(p1.totalPages === 3, `125件を50件ずつ = 3ページ (実際: ${p1.totalPages})`);

const p3 = paginate(items, 3, 50);
assert(p3.items.length === 25, `最終ページは端数の25件 (実際: ${p3.items.length})`);

const pOverflow = paginate(items, 99, 50);
assert(pOverflow.page === 3, "範囲外のページ番号は最終ページにクランプされる");

const pUnderflow = paginate(items, 0, 50);
assert(pUnderflow.page === 1, "0以下のページ番号は1ページ目にクランプされる");

const pEmpty = paginate([], 1, 50);
assert(pEmpty.totalPages === 1 && pEmpty.items.length === 0, "0件でも totalPages は最低1になる（ページが消えない）");

console.log("\nAll search/pagination tests passed.");
