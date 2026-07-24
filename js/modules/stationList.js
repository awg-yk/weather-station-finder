/**
 * stationList.js
 * ------------------------------------------------------------
 * 観測所一覧をテーブルとして描画するモジュール。
 * フェーズ1では store.visibleStations をそのまま表示するだけだが、
 * フェーズ2/3で地域・要素フィルタが store を更新するたびに
 * 再描画されるよう、store.subscribe に接続する設計にしている。
 */

import { h } from "../utils/helpers.js";
import { buildJmaStationLink, buildJmaPrefectureLink } from "./exporter.js";

/**
 * 観測要素タグは要素ごとに色分けする（CSS側の .tag--<id> と対応。凡例は観測要素フィルタのドット）。
 * 観測所ごとに観測している要素が異なるため、単純に並べると要素が抜けた分だけ後続のタグが
 * 詰めて表示され、列が揃って見えない。elementLabelMap の並び順（=観測要素マスタの並び順）で
 * 6要素ぶんの枠を必ず用意し、観測していない要素は見えないプレースホルダーにすることで
 * どの行でも同じ要素が同じ横位置に来るようにしている。
 */
function renderElementTags(elementIds, elementLabelMap) {
  const owned = new Set(elementIds);
  const wrap = h("div", { class: "element-tags" });
  [...elementLabelMap.keys()].forEach((id) => {
    if (owned.has(id)) {
      const label = elementLabelMap.get(id) ?? id;
      wrap.append(h("span", { class: `tag tag--${id}` }, label));
    } else {
      wrap.append(h("span", { class: "tag tag--empty", "aria-hidden": "true" }));
    }
  });
  return wrap;
}

/**
 * 地点名セル。気象庁「過去の気象データ検索」の当該地点ページへのリンクにする。
 * 地点番号が確定していない7地点は、都道府県までを選択済みのページへ案内する
 * （どのリンクも必ず有効なページに着地するようにしている）。
 */
function renderNameCell(station) {
  const stationUrl = buildJmaStationLink(station);
  if (stationUrl) {
    return h(
      "a",
      {
        class: "station-table__name station-table__name--link",
        href: stationUrl,
        target: "_blank",
        rel: "noopener noreferrer",
        title: `気象庁「過去の気象データ検索」で${station.name}のデータを開く`,
      },
      `${station.name} ↗`
    );
  }

  const prefectureUrl = buildJmaPrefectureLink(station);
  if (prefectureUrl) {
    const candidates = station.blockNoAmbiguousCandidates?.join(" / ") ?? "";
    return h(
      "a",
      {
        class: "station-table__name station-table__name--link station-table__name--ambiguous",
        href: prefectureUrl,
        target: "_blank",
        rel: "noopener noreferrer",
        title: `気象庁側に同名で複数の地点番号（${candidates}）があり自動判定を保留しています。都道府県の地点選択ページを開くので、地図から地点を選んでください。`,
      },
      `${station.name} ↗*`
    );
  }

  return h("span", { class: "station-table__name" }, station.name);
}

/** フォーマット済みの観測期間（YYYY-MM-DD → 「1961年1月〜2002年2月」等）。欠測は「?」で埋める */
function formatPeriod(isoDate) {
  if (!isoDate) return "?";
  const [y, m] = isoDate.split("-");
  return `${y}年${Number(m)}月`;
}

/** 地点名セルの本体に、廃止済み観測所であれば「廃止」タグと観測期間を添える（フェーズ16） */
function renderNameCellWithStatus(station) {
  const nameCell = renderNameCell(station);
  if (!station.discontinued) return nameCell;

  return h("div", {}, [
    nameCell,
    h("span", { class: "station-table__discontinued-badge" }, "廃止"),
    h(
      "span",
      { class: "station-table__discontinued-period" },
      `観測期間: ${formatPeriod(station.observedFrom)}〜${formatPeriod(station.observedTo)}`
    ),
  ]);
}

/** 地点コードのセル。左端に「一覧から除外する」✕ボタンを添える（除外方式）。
 *  ✕クリックは行選択（行クリック）に伝播させない。 */
function renderIdCell(station, onExcludeStation) {
  const removeBtn = h(
    "button",
    {
      type: "button",
      class: "row-remove",
      title: `${station.name} を観測所一覧（ダウンロード対象）から除外する`,
      "aria-label": `${station.name} を一覧から除外`,
      onClick: (event) => {
        event.stopPropagation();
        onExcludeStation?.(station.id);
      },
    },
    "✕"
  );
  return h("div", { class: "id-cell" }, [
    removeBtn,
    h("span", { class: "station-table__id mono" }, station.id),
  ]);
}

/** 行クリック（または行にフォーカスしてEnter/Space）で observeStation を選択状態にする。
 *  地図のマーカーをクリックしたときと同じ store.selectedStationId を介した相互連携（フェーズ15）。 */
function renderRow(station, elementLabelMap, regionLabelMap, selectedStationId, onSelectStation, onExcludeStation) {
  const isSelected = station.id === selectedStationId;
  const selectRow = () => onSelectStation?.(station.id);
  const rowClass = [
    "station-table__row",
    isSelected && "station-table__row--selected",
    station.discontinued && "station-table__row--discontinued",
  ]
    .filter(Boolean)
    .join(" ");
  return h(
    "tr",
    {
      class: rowClass,
      tabindex: "0",
      "aria-selected": isSelected ? "true" : "false",
      onClick: selectRow,
      onKeydown: (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectRow();
        }
      },
    },
    [
      h("td", {}, renderIdCell(station, onExcludeStation)),
      h("td", {}, renderNameCellWithStatus(station)),
      h("td", {}, h("span", { class: "station-table__kana" }, station.kana ?? "")),
      h("td", {}, station.prefecture),
      h("td", {}, regionLabelMap.get(station.region) ?? station.region),
      h("td", { class: "station-table__num" }, h("span", { class: "mono" }, formatNumber(station.alt, 0))),
      h("td", { class: "station-table__num" }, h("span", { class: "mono" }, formatNumber(station.lat, 4))),
      h("td", { class: "station-table__num" }, h("span", { class: "mono" }, formatNumber(station.lon, 4))),
      h("td", {}, renderElementTags(station.elements, elementLabelMap)),
      h("td", {}, h("span", { class: "badge-type" }, station.stationType)),
    ]
  );
}

/** 数値を固定小数桁で表示する（欠測は「—」）。緯度経度は4桁≒10m精度で十分 */
function formatNumber(value, digits) {
  return typeof value === "number" ? value.toFixed(digits) : "—";
}

export function renderStationTable(
  container,
  stations,
  { elementLabelMap, regionLabelMap, selectedStationId = null, onSelectStation, onExcludeStation } = {}
) {
  container.innerHTML = "";

  if (stations.length === 0) {
    container.append(h("div", { class: "empty-state" }, "条件に一致する観測所がありません。"));
    return;
  }

  const table = h("table", { class: "station-table" });
  const thead = h("thead", {}, h("tr", {}, [
    h("th", {}, "地点コード"),
    h("th", {}, "地点名"),
    h("th", {}, "かな"),
    h("th", {}, "都道府県"),
    h("th", {}, "地方"),
    h("th", { class: "station-table__num" }, "標高(m)"),
    h("th", { class: "station-table__num" }, "緯度"),
    h("th", { class: "station-table__num" }, "経度"),
    h("th", {}, "観測要素"),
    h("th", {}, "種別"),
  ]));

  const tbody = h("tbody", {});
  let selectedRow = null;
  stations.forEach((station) => {
    const row = renderRow(station, elementLabelMap, regionLabelMap, selectedStationId, onSelectStation, onExcludeStation);
    if (station.id === selectedStationId) selectedRow = row;
    tbody.append(row);
  });

  table.append(thead, tbody);
  container.append(table);

  // 地図のマーカークリックで選択された行を、一覧のスクロール位置に入れる（jsdomにはscrollIntoViewが無いため任意呼び出し）
  selectedRow?.scrollIntoView?.({ block: "nearest" });
}

export function renderLoading(container, message = "観測所データを読み込み中...") {
  container.innerHTML = "";
  container.append(h("div", { class: "loading-state" }, message));
}

export function renderError(container, message) {
  container.innerHTML = "";
  container.append(h("div", { class: "empty-state" }, message));
}
