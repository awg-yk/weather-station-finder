/**
 * stateManager.js
 * ------------------------------------------------------------
 * アプリ全体の選択状態を一元管理する、ごく小さな Pub/Sub ストア。
 * フェーズ2以降で「地域選択」「観測要素フィルタ」が増えても、
 * ここに状態を足していくだけで済むようにしてある。
 *
 * 使い方:
 *   import { store } from "./stateManager.js";
 *   store.subscribe((state) => { ... });
 *   store.setState({ stations: [...] });
 */

function createStore(initialState) {
  let state = { ...initialState };
  const listeners = new Set();

  function getState() {
    return state;
  }

  function setState(partial) {
    state = { ...state, ...partial };
    listeners.forEach((listener) => listener(state));
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { getState, setState, subscribe };
}

// 扱う状態:
// - allStations: 読み込んだ観測所マスタ全件
// - visibleStations: 現在の絞り込み条件で表示すべき観測所（ページングされる前の全件）
// - selectedPrefectures: 地域選択UIで選ばれた都道府県の集合（空 = 絞り込みなし）
// - selectedElements: 観測要素フィルタUIで選ばれた観測要素IDの集合（空 = 絞り込みなし）
// - elementLogic: 観測要素フィルタの合成モード（"AND" | "OR"）
// - selectedStationTypes: 種別フィルタUIで選ばれた観測所種別の集合（空 = 絞り込みなし。フェーズ9）
// - keyword: 検索ボックスに入力された文字列（空 = 絞り込みなし）
// - page: 現在のページ番号（1始まり）
// - pageSize: 1ページあたりの表示件数
// - status: "loading" | "ready" | "error"
// - selectedStationId: 一覧の行／地図のマーカーどちらかで選択された観測所のID（未選択はnull。フェーズ15）
// - discontinuedStations: 廃止済み観測所（現行の観測所網には含まれない歴史的な地点。フェーズ16）
// - includeDiscontinued: 廃止済み観測所を一覧・地図に含めるかどうか（既定true。フェーズ21で既定を反転）
// - selectedIds: ユーザーが地図や一覧から明示的に選択した観測所IDの集合（初期は空＝何も選択なし）。
//   「観測所一覧（＝エクスポート対象）」はこの集合の地点だけを表示する（選択方式／オプトイン）。
export const store = createStore({
  allStations: [],
  visibleStations: [],
  selectedPrefectures: new Set(),
  selectedElements: new Set(),
  elementLogic: "AND",
  selectedStationTypes: new Set(),
  keyword: "",
  page: 1,
  pageSize: 15,
  status: "loading",
  errorMessage: "",
  selectedStationId: null,
  discontinuedStations: [],
  includeDiscontinued: true,
  selectedIds: new Set(),
});
