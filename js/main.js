/**
 * main.js — エントリーポイント
 * ------------------------------------------------------------
 *   1. data/stations.json を読み込む
 *   2. store（状態管理）に格納する
 *   3. regionSelector / elementFilter を初期化し、変化を store に反映する
 *   4. filterEngine で visibleStations を再計算する（applyFilters）
 *   5. stationList モジュールで一覧をテーブル描画する
 *   6. ステータスバーに件数を表示する
 */

import { store } from "./modules/stateManager.js";
import { renderStationTable, renderLoading, renderError } from "./modules/stationList.js";
import { initRegionSelector } from "./modules/regionSelector.js";
import { initElementFilter } from "./modules/elementFilter.js";
import { initTypeFilter } from "./modules/typeFilter.js";
import { initDiscontinuedFilter } from "./modules/discontinuedFilter.js";
import { initKeywordSearch } from "./modules/keywordSearch.js";
import { paginate, renderPagination } from "./modules/pagination.js";
import { computeVisibleStations, buildFacetCounts, buildStationTypeCounts } from "./modules/filterEngine.js";
import { exportStationsAsCSV, stationsToCsv } from "./modules/exporter.js";
import { initMapView } from "./modules/mapView.js";
import { parseStateFromUrl, syncUrlWithState } from "./modules/urlState.js";
import { buildElementLabelMap, buildRegionLabelMap } from "./utils/helpers.js";

const tableContainer = document.getElementById("station-table-container");
const paginationContainer = document.getElementById("pagination-container");
const regionSelectorContainer = document.getElementById("region-selector-container");
const elementFilterContainer = document.getElementById("element-filter-container");
const typeFilterContainer = document.getElementById("type-filter-container");
const discontinuedFilterContainer = document.getElementById("discontinued-filter-container");
const keywordSearchContainer = document.getElementById("keyword-search-container");
const mapViewContainer = document.getElementById("map-view-container");
const statusCount = document.getElementById("status-count");
const exportCsvBtn = document.getElementById("export-csv-btn");
const copyColabBtn = document.getElementById("copy-colab-btn");
const listSummary = document.getElementById("list-summary");
const selectAllCb = document.getElementById("select-all-cb");

let elementLabelMap = new Map();
let regionLabelMap = new Map();
let filterUIs = { region: null, element: null, type: null, discontinued: null }; // 各絞り込みUIのハンドル（件数の更新に使う）

/** 「観測所一覧（＝ダウンロード対象）」＝ 絞り込み結果からユーザーが除外した地点を差し引いたもの（除外方式）。
 *  一覧テーブル・エクスポートの両方でこの結果を使う。 */
function effectiveStations(state) {
  if (!state.excludedIds || state.excludedIds.size === 0) return state.visibleStations;
  return state.visibleStations.filter((s) => !state.excludedIds.has(s.id));
}

/** store の状態から filterEngine に渡す絞り込み条件を取り出す */
function filtersFromState(state) {
  return {
    selectedPrefectures: state.selectedPrefectures,
    selectedElements: state.selectedElements,
    elementLogic: state.elementLogic,
    selectedStationTypes: state.selectedStationTypes,
    keyword: state.keyword,
  };
}

/** 絞り込みの母集団。既定では廃止済み観測所も含む。「廃止済みの観測地点を含めない」を
 *  チェックしたときだけ discontinuedStations を除外する（フェーズ16・21）。 */
function effectivePool(state) {
  return state.includeDiscontinued ? [...state.allStations, ...state.discontinuedStations] : state.allStations;
}

/** 各絞り込みUIの「(件数)」を、他の絞り込み条件を反映した件数に更新する（フェーズ10）。
 *  例: 地域で北海道だけ選ぶと、観測要素・種別の件数が北海道の中での件数になる。
 *  廃止済み観測所の件数は「含める/含めない」自身の状態に関わらず、他の軸と同じ数え方
 *  （地域・観測要素・種別・検索語だけを反映）にする（フェーズ21）。 */
function refreshFacetCounts(allStations, filters, discontinuedStations) {
  const { prefectureCounts, elementCounts, stationTypeCounts } = buildFacetCounts(allStations, filters);
  filterUIs.region?.updateCounts(prefectureCounts);
  filterUIs.element?.updateCounts(elementCounts);
  filterUIs.type?.updateCounts(stationTypeCounts);
  filterUIs.discontinued?.updateCount(computeVisibleStations(discontinuedStations, filters).length);
}

/** allStations / selectedPrefectures / selectedElements / selectedStationTypes / keyword の現在値から
 *  visibleStations を再計算する。絞り込み条件が変わったときは、存在しないページを見続けないよう1ページ目に戻す。 */
function applyFilters({ resetPage = true } = {}) {
  const state = store.getState();
  const filters = filtersFromState(state);
  const pool = effectivePool(state);
  const visibleStations = computeVisibleStations(pool, filters);
  // 絞り込みが変わると選択中の観測所が表示から外れうるので、ページ同様に選択も解除する（フェーズ15）
  store.setState({ visibleStations, ...(resetPage ? { page: 1, selectedStationId: null } : {}) });
  refreshFacetCounts(pool, filters, state.discontinuedStations);
}

/** 一覧の行クリックで呼ばれる選択ハンドラ（地図マーカー側は mapView.js が同じ store.selectedStationId を
 *  直接更新するので、一覧・地図どちらの操作でも最終的にここと同じ状態を共有する。フェーズ15） */
function selectStation(stationId) {
  store.setState({ selectedStationId: stationId });
}

/** 除外集合を更新する小さなヘルパー（購読を確実に発火させるため毎回新しい Set を作る）。 */
function setExcluded(mutate) {
  const next = new Set(store.getState().excludedIds);
  mutate(next);
  store.setState({ excludedIds: next });
}

/** 観測所一覧（ダウンロード対象）から1件除外する（一覧の✕・地図の「リストから外す」）。 */
function excludeStation(stationId) {
  setExcluded((set) => set.add(stationId));
}

/** 除外を取り消して一覧に戻す（地図の「リストに戻す」）。 */
function includeStation(stationId) {
  setExcluded((set) => set.delete(stationId));
}

/** 一覧チェック／地図マーカー操作用: 現在の状態に応じて選択/解除をトグルする。 */
function toggleStation(stationId) {
  if (store.getState().excludedIds.has(stationId)) {
    includeStation(stationId);
  } else {
    excludeStation(stationId);
  }
}

/** 複数地点をまとめて除外/選択する（地図のクラスタ一括操作用）。excluded=true で外す。 */
function setManyExcluded(ids, excluded) {
  const next = new Set(store.getState().excludedIds);
  for (const id of ids) {
    if (excluded) next.add(id);
    else next.delete(id);
  }
  store.setState({ excludedIds: next });
}

/** 「表示中をすべて選択」トグル: 現在の絞り込み結果すべてを選択（除外解除）または解除（除外）する。 */
function setAllVisible(selected) {
  const state = store.getState();
  const next = new Set(state.excludedIds);
  for (const s of state.visibleStations) {
    if (selected) next.delete(s.id);
    else next.add(s.id);
  }
  store.setState({ excludedIds: next });
}

/**
 * 地域・観測要素・種別・検索ボックスのUIを、与えられた初期選択値で構築する。
 * 初期選択値は、URLクエリから復元した絞り込み条件（共有リンクからのアクセス対応）。
 */
function initFilterUIs(data, initialValues) {
  const initialPool = initialValues.includeDiscontinued
    ? [...data.stations, ...data.discontinuedStations]
    : data.stations;

  // 初期表示の件数も、URLクエリ由来の絞り込みを反映した値にする
  const facetCounts = buildFacetCounts(initialPool, {
    selectedPrefectures: initialValues.prefectures,
    selectedElements: initialValues.elements,
    elementLogic: initialValues.elementLogic,
    selectedStationTypes: initialValues.stationTypes,
    keyword: initialValues.keyword,
  });

  filterUIs.region = initRegionSelector({
    container: regionSelectorContainer,
    regions: data.regions,
    hokkaidoSubAreas: data.hokkaidoSubAreas,
    stationCounts: facetCounts.prefectureCounts,
    initialSelected: initialValues.prefectures,
    onChange: (selectedPrefectures) => {
      store.setState({ selectedPrefectures });
      applyFilters();
    },
  });

  filterUIs.element = initElementFilter({
    container: elementFilterContainer,
    elements: data.elements,
    stationCounts: facetCounts.elementCounts,
    initialSelected: initialValues.elements,
    initialMode: initialValues.elementLogic,
    clearButtonSlot: document.getElementById("element-filter-clear-container"),
    onChange: (selectedElements, elementLogic) => {
      store.setState({ selectedElements, elementLogic });
      applyFilters();
    },
  });

  // 選択肢そのもの（気象官署／アメダス）は全観測所から作り、件数だけ絞り込み連動にする
  // （件数0の種別も選択肢として残しておくため）
  filterUIs.type = initTypeFilter({
    container: typeFilterContainer,
    stationTypes: [...buildStationTypeCounts(data.stations).keys()],
    stationCounts: facetCounts.stationTypeCounts,
    initialSelected: initialValues.stationTypes,
    clearButtonSlot: document.getElementById("type-filter-clear-container"),
    onChange: (selectedStationTypes) => {
      store.setState({ selectedStationTypes });
      applyFilters();
    },
  });

  initKeywordSearch({
    container: keywordSearchContainer,
    initialKeyword: initialValues.keyword,
    onChange: (keyword) => {
      store.setState({ keyword });
      applyFilters();
    },
  });

  // チェックボックスは「除外する」向き（checked=true が includeDiscontinued=false に対応）
  filterUIs.discontinued = initDiscontinuedFilter({
    container: discontinuedFilterContainer,
    count: computeVisibleStations(data.discontinuedStations, {
      selectedPrefectures: initialValues.prefectures,
      selectedElements: initialValues.elements,
      elementLogic: initialValues.elementLogic,
      selectedStationTypes: initialValues.stationTypes,
      keyword: initialValues.keyword,
    }).length,
    initialChecked: !initialValues.includeDiscontinued,
    onChange: (excludeDiscontinued) => {
      store.setState({ includeDiscontinued: !excludeDiscontinued });
      applyFilters();
    },
  });
}

exportCsvBtn.addEventListener("click", () => {
  const state = store.getState();
  const exported = exportStationsAsCSV(effectiveStations(state), { elementLabelMap, regionLabelMap });
  if (!exported) {
    const previousText = statusCount.textContent;
    statusCount.textContent = "エクスポート対象の観測所がありません（絞り込み条件・除外を確認してください）";
    setTimeout(() => {
      statusCount.textContent = previousText;
    }, 3000);
  }
});

selectAllCb?.addEventListener("change", () => setAllVisible(selectAllCb.checked));

/** クリップボードにテキストをコピーする（HTTPSでは navigator.clipboard、非対応時は execCommand にフォールバック）。 */
async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* フォールバックへ */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** 現在の観測所一覧（除外を反映）を、ダウンロードと同じCSV形式でクリップボードへコピーする。
 *  Colabのノートブックに貼り付ければ、ファイルの保存・アップロードなしで地点リストを渡せる（③）。 */
copyColabBtn?.addEventListener("click", async () => {
  const list = effectiveStations(store.getState());
  if (list.length === 0) {
    flashButton(copyColabBtn, "対象がありません", "1. Colab用にコピー");
    return;
  }
  const csv = stationsToCsv(list, { elementLabelMap, regionLabelMap });
  const ok = await copyTextToClipboard(csv);
  flashButton(copyColabBtn, ok ? `コピーしました（${list.length}件）` : "コピーに失敗しました", "1. Colab用にコピー");
});

/** ボタンのラベルを一時的に切り替えて操作結果を知らせる。 */
function flashButton(button, message, restore) {
  button.textContent = message;
  button.disabled = true;
  setTimeout(() => {
    button.textContent = restore;
    button.disabled = false;
  }, 1800);
}

// store の状態が変わるたびに一覧・ページネーションを再描画する
store.subscribe((state) => {
  if (state.status === "loading") {
    renderLoading(tableContainer);
    statusCount.textContent = "読み込み中...";
    paginationContainer.innerHTML = "";
    return;
  }

  if (state.status === "error") {
    renderError(tableContainer, state.errorMessage);
    statusCount.textContent = "エラー";
    paginationContainer.innerHTML = "";
    return;
  }

  syncUrlWithState(state); // フェーズ7: 絞り込み条件をURLクエリに反映（履歴は汚さない）

  // チェックボックス方式: 絞り込み結果はすべて表示し、チェックの有無で対象を選ぶ
  const filtered = state.visibleStations;
  const { items, page, totalPages, total } = paginate(filtered, state.page, state.pageSize);
  const poolTotal = effectivePool(state).length;

  renderStationTable(tableContainer, items, {
    elementLabelMap,
    regionLabelMap,
    selectedStationId: state.selectedStationId,
    onSelectStation: selectStation,
    excludedIds: state.excludedIds,
    onToggleStation: toggleStation,
  });

  renderPagination(paginationContainer, {
    page,
    pageSize: state.pageSize,
    total,
    // 手動でのページ送りは、直前の選択行が別ページに残ったままにならないよう選択も解除する
    onPageChange: (nextPage) => store.setState({ page: nextPage, selectedStationId: null }),
  });

  // 選択件数の表示と「表示中をすべて選択」チェックの状態
  const excludedInVisible = filtered.reduce((n, s) => n + (state.excludedIds?.has(s.id) ? 1 : 0), 0);
  const selectedCount = filtered.length - excludedInVisible;
  if (listSummary) {
    listSummary.textContent = filtered.length > 0 ? `選択 ${selectedCount} / 絞り込み ${filtered.length} 件` : "";
  }
  if (selectAllCb) {
    selectAllCb.checked = filtered.length > 0 && excludedInVisible === 0;
    selectAllCb.indeterminate = excludedInVisible > 0 && selectedCount > 0;
  }

  if (total === 0) {
    statusCount.textContent = `0 観測所を表示中（全 ${poolTotal} 件）`;
  } else {
    const start = (page - 1) * state.pageSize + 1;
    const end = Math.min(page * state.pageSize, total);
    statusCount.textContent = `${start}〜${end}件 / 絞り込み ${total}件（選択 ${selectedCount}件・全 ${poolTotal} 件中）・${page}/${totalPages}ページ`;
  }
});

async function init() {
  try {
    const response = await fetch("data/stations.json");
    if (!response.ok) {
      throw new Error(`データの取得に失敗しました（HTTP ${response.status}）`);
    }
    const data = await response.json();

    elementLabelMap = buildElementLabelMap(data.elements);
    regionLabelMap = buildRegionLabelMap(data.regions);

    // フェーズ7: URLクエリから初期の絞り込み状態を復元する（共有リンクからのアクセス対応）
    const urlState = parseStateFromUrl(new URLSearchParams(window.location.search));

    store.setState({
      allStations: data.stations,
      visibleStations: data.stations, // applyFilters() で絞り込み結果に更新される
      discontinuedStations: data.discontinuedStations ?? [],
      includeDiscontinued: urlState.includeDiscontinued,
      selectedPrefectures: urlState.prefectures,
      selectedElements: urlState.elements,
      elementLogic: urlState.elementLogic,
      selectedStationTypes: urlState.stationTypes,
      keyword: urlState.keyword,
      page: urlState.page,
      status: "ready",
    });

    initFilterUIs(data, {
      prefectures: urlState.prefectures,
      elements: urlState.elements,
      elementLogic: urlState.elementLogic,
      stationTypes: urlState.stationTypes,
      keyword: urlState.keyword,
      includeDiscontinued: urlState.includeDiscontinued,
    });

    initMapView({
      container: mapViewContainer,
      store,
      elementLabelMap,
      onToggleStation: toggleStation,
      onSetExcluded: setManyExcluded,
    });

    // URLに絞り込み条件が含まれていた場合、その条件で visibleStations を計算する
    // （ページ番号はURL由来のものを保持したいので resetPage: false）
    applyFilters({ resetPage: false });
  } catch (err) {
    console.error(err);
    store.setState({
      status: "error",
      errorMessage:
        "観測所データの読み込みに失敗しました。ローカルサーバー経由で開いているかご確認ください（例: python -m http.server）。",
    });
  }
}

init();
