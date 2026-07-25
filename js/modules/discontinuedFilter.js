/**
 * discontinuedFilter.js
 * ------------------------------------------------------------
 * 「廃止済みの観測地点を含めない」単一のチェックボックスUI（フェーズ16・21）。
 *
 * 廃止済み観測所は既定で一覧・地図・件数集計に含まれる。このチェックボックスは
 * 「除外する」というオプトアウト操作を表すため、チェック済み＝除外という向きにしてある
 * （地域・観測要素・種別フィルタとは逆に、既定で絞り込みが効いている状態）。
 * regionSelector/elementFilter/typeFilter のような集合ベースの選択状態は使わず、
 * 真偽値ひとつだけを扱う。
 *
 *   initDiscontinuedFilter({
 *     container: HTMLElement,
 *     count: number,                 // 現在の他の絞り込み条件に該当する廃止済み観測所の件数（表示用）
 *     initialChecked?: boolean,      // true=除外する（チェック済み）
 *     onChange: (checked: boolean) => void, // checked=true は「除外する」
 *   }) -> { updateCount(newCount: number): void }
 *
 *   戻り値の updateCount() で、チェック状態を保ったまま「(件数)」だけを差し替えられる
 *   （他の絞り込み条件に連動して件数を更新するため。フェーズ21）。
 */

import { h } from "../utils/helpers.js";

export function initDiscontinuedFilter({ container, count, initialChecked = false, onChange }) {
  container.innerHTML = "";

  let currentCount = count;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "discontinued-filter__checkbox";
  checkbox.id = "discontinued-filter-checkbox";
  checkbox.checked = initialChecked;
  checkbox.addEventListener("change", () => onChange(checkbox.checked));

  const labelSpan = h("span", {}, ` 廃止済みの観測地点を除外 (${currentCount}件)`);

  const label = h(
    "label",
    { for: "discontinued-filter-checkbox", class: "discontinued-filter__label" },
    [checkbox, labelSpan]
  );

  container.append(label);

  /** 他の絞り込み条件が変わったとき、チェック状態を保ったまま「(件数)」だけ更新する */
  function updateCount(newCount) {
    currentCount = newCount;
    labelSpan.textContent = ` 廃止済みの観測地点を除外 (${currentCount}件)`;
  }

  return { updateCount };
}
