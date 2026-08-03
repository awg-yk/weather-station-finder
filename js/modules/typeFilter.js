/**
 * typeFilter.js
 * ------------------------------------------------------------
 * 観測所の種別（気象台等／アメダス）で絞り込むチェックボックスUI。
 *
 *   initTypeFilter({
 *     container: HTMLElement,
 *     stationTypes: string[],                 // 例: ["気象台等", "アメダス"]
 *     stationCounts?: Map<stationType, number>,
 *     initialSelected?: Set<string>,          // 初期選択（URLクエリ・プリセット復元用）
 *     clearButtonSlot?: HTMLElement,          // 「選択をクリア」の描画先（省略時はパネル本文内。フェーズ23）
 *     onChange: (selected: Set<string>) => void,
 *   }) -> { updateCounts(newCounts: Map<stationType, number>): void }
 *
 *   戻り値の updateCounts() で、UIを作り直さずに「(件数)」だけを差し替えられる
 *   （他の絞り込み条件に連動して件数を更新するため。フェーズ10）。
 *
 * 選択状態の正は「選択中の種別の集合（selected）」。
 * 何も選択されていない状態 = 絞り込みなし（全観測所を表示）として扱う
 * （regionSelector / elementFilter と同じ方針）。
 * 種別は排他ではなく複数選択可（両方選択 = 絞り込みなしと同義）。
 */

import { h } from "../utils/helpers.js";

export function initTypeFilter({ container, stationTypes, stationCounts, initialSelected, clearButtonSlot, onChange }) {
  container.innerHTML = "";

  const selected = new Set(initialSelected ?? []);
  const checkboxes = new Map();
  const labelSpans = new Map(); // stationType -> <span>（件数の差し替え用）
  let counts = stationCounts ?? null;

  const countFor = (type) => (counts ? counts.get(type) ?? 0 : null);
  const labelTextFor = (type) => {
    const count = countFor(type);
    return count === null ? type : `${type} (${count})`;
  };

  function emitChange() {
    onChange(new Set(selected));
  }

  const clearButton = h(
    "button",
    {
      type: "button",
      class: "element-controls__clear",
      onClick: () => {
        if (selected.size === 0) return;
        selected.clear();
        checkboxes.forEach((cb) => (cb.checked = false));
        emitChange();
      },
    },
    "選択をクリア"
  );

  if (clearButtonSlot) {
    clearButtonSlot.innerHTML = "";
    clearButtonSlot.append(clearButton);
  } else {
    const controls = h("div", { class: "element-controls" }, [clearButton]);
    container.append(controls);
  }

  const list = h("div", { class: "element-list" });

  stationTypes.forEach((type) => {
    const id = `type-${type}`;
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "element-item__checkbox";
    cb.id = id;
    cb.checked = selected.has(type);
    cb.addEventListener("change", () => {
      if (cb.checked) {
        selected.add(type);
      } else {
        selected.delete(type);
      }
      emitChange();
    });
    checkboxes.set(type, cb);

    const labelSpan = h("span", { class: "element-item__label" }, labelTextFor(type));
    labelSpans.set(type, labelSpan);

    const item = h("label", { for: id, class: "element-item" }, [cb, labelSpan]);
    item.classList.toggle("element-item--empty", countFor(type) === 0);
    list.append(item);
  });

  container.append(list);

  /** 他の絞り込み条件が変わったとき、チェック状態を保ったまま「(件数)」だけ更新する */
  function updateCounts(newCounts) {
    counts = newCounts ?? null;
    stationTypes.forEach((type) => {
      const labelSpan = labelSpans.get(type);
      if (!labelSpan) return;
      labelSpan.textContent = labelTextFor(type);
      labelSpan.parentElement?.classList.toggle("element-item--empty", countFor(type) === 0);
    });
  }

  return { updateCounts };
}
