/**
 * regionSelector.js
 * ------------------------------------------------------------
 * 地方（北海道・東北・関東 …）単位、および都道府県単位で
 * 観測所を一括選択できるチェックボックスUI。
 *
 *   initRegionSelector({
 *     container: HTMLElement,
 *     regions: Region[],                     // stations.json の regions
 *     hokkaidoSubAreas?: HokkaidoSubArea[],   // stations.json の hokkaidoSubAreas（省略時は北海道を1件のまま表示）
 *     stationCounts: Map<prefecture, number>, // 都道府県（北海道は宗谷・上川等の地域）ごとの観測所数
 *     initialSelected?: Set<string>,          // 初期選択（URLクエリ復元用。省略時は未選択）
 *     onChange: (selectedPrefectures: Set<string>) => void,
 *   }) -> { updateCounts(newCounts: Map<prefecture, number>): void }
 *
 *   戻り値の updateCounts() で、チェック状態や開閉状態を保ったまま
 *   「(件数)」だけを差し替えられる（他の絞り込み条件に連動して件数を更新するため。フェーズ10）。
 *
 * 選択状態の正は「都道府県名（または北海道の地域名）の集合（selected）」。
 * 地方チェックボックス・「全国」チェックボックスは、
 * この集合から導出される表示上の状態（checked / indeterminate）に過ぎない。
 * 何も選択されていない状態 = 絞り込みなし（全観測所を表示）として扱う。
 *
 * 北海道は面積が広く1都道府県のままでは絞り込みの単位として粗いため、hokkaidoSubAreas が
 * 渡された場合は宗谷・上川など14地域を選択肢に持つ1枚のカードとして表示する
 * （フェーズ23で導入・フェーズ24で2枚組から1枚に統合。station.prefecture自体は「北海道」の
 * まま変わらず、filterEngine.js の regionSelectorKey() が北海道の観測所をprecNoから
 * 地域名に変換して照合する）。
 */

import { h } from "../utils/helpers.js";

/** 北海道の地域カードを1枚にまとめた表示用リストを作る */
function buildDisplayRegions(regions, hokkaidoSubAreas) {
  return regions.flatMap((region) => {
    if (region.id === "hokkaido" && hokkaidoSubAreas && hokkaidoSubAreas.length > 0) {
      const allAreas = hokkaidoSubAreas.flatMap((sub) => sub.areas);
      return [{ id: region.id, name: region.name, prefectures: allAreas }];
    }
    return [region];
  });
}

export function initRegionSelector({ container, regions, hokkaidoSubAreas, stationCounts, initialSelected, onChange }) {
  container.innerHTML = "";

  const displayRegions = buildDisplayRegions(regions, hokkaidoSubAreas);

  const selected = new Set(initialSelected ?? []); // 選択中の都道府県名（北海道は地域名）
  const prefectureCheckboxes = new Map(); // prefName -> <input>
  const regionCheckboxes = new Map(); // regionId -> <input>
  const prefectureLabels = new Map(); // prefName -> <label>（件数の差し替え用）
  const regionLabels = new Map(); // regionId -> <label>（件数の差し替え用）
  let counts = stationCounts;
  let allCheckbox; // 「すべて一括選択」＝南極（昭和基地）を含む全地域
  let japanCheckbox; // 「47都道府県一括選択」＝南極を除く全地域

  const countFor = (prefName) => counts.get(prefName) ?? 0;
  const regionCount = (region) => region.prefectures.reduce((sum, p) => sum + countFor(p), 0);
  const totalPrefectureCount = displayRegions.reduce((sum, r) => sum + r.prefectures.length, 0);
  // 南極（昭和基地）は都道府県ではないため、「47都道府県一括選択」の対象からは除く
  const japanRegions = displayRegions.filter((r) => r.id !== "antarctica");
  const japanPrefectureCount = japanRegions.reduce((sum, r) => sum + r.prefectures.length, 0);

  function emitChange() {
    onChange(new Set(selected));
  }

  function updateRegionCheckboxState(region) {
    const cb = regionCheckboxes.get(region.id);
    if (!cb) return;
    const total = region.prefectures.length;
    const checkedCount = region.prefectures.filter((p) => selected.has(p)).length;
    cb.checked = total > 0 && checkedCount === total;
    cb.indeterminate = checkedCount > 0 && checkedCount < total;
  }

  function updateAllCheckboxState() {
    const checkedCount = selected.size;
    allCheckbox.checked = totalPrefectureCount > 0 && checkedCount === totalPrefectureCount;
    allCheckbox.indeterminate = checkedCount > 0 && checkedCount < totalPrefectureCount;
  }

  function updateJapanCheckboxState() {
    const checkedCount = japanRegions.reduce(
      (sum, r) => sum + r.prefectures.filter((p) => selected.has(p)).length,
      0
    );
    japanCheckbox.checked = japanPrefectureCount > 0 && checkedCount === japanPrefectureCount;
    japanCheckbox.indeterminate = checkedCount > 0 && checkedCount < japanPrefectureCount;
  }

  function refreshDerivedStates() {
    displayRegions.forEach(updateRegionCheckboxState);
    updateAllCheckboxState();
    updateJapanCheckboxState();
  }

  function setPrefectureSelected(prefName, checked) {
    if (checked) {
      selected.add(prefName);
    } else {
      selected.delete(prefName);
    }
    const cb = prefectureCheckboxes.get(prefName);
    if (cb) cb.checked = checked;
  }

  function setRegionSelected(region, checked) {
    region.prefectures.forEach((prefName) => setPrefectureSelected(prefName, checked));
  }

  // --- 「47都道府県一括選択」「すべて一括選択」+ クリアボタン ---------------
  const controls = h("div", { class: "region-controls" });
  const allGroup = h("div", { class: "region-controls__all-group" });

  japanCheckbox = document.createElement("input");
  japanCheckbox.type = "checkbox";
  japanCheckbox.className = "region-controls__checkbox";
  japanCheckbox.id = "region-select-japan";
  japanCheckbox.addEventListener("change", () => {
    japanRegions.forEach((region) => setRegionSelected(region, japanCheckbox.checked));
    refreshDerivedStates();
    emitChange();
  });

  const japanLabel = h(
    "label",
    { for: "region-select-japan", class: "region-controls__label" },
    `47都道府県一括選択（${japanPrefectureCount}）`
  );

  allCheckbox = document.createElement("input");
  allCheckbox.type = "checkbox";
  allCheckbox.className = "region-controls__checkbox";
  allCheckbox.id = "region-select-all";
  allCheckbox.addEventListener("change", () => {
    displayRegions.forEach((region) => setRegionSelected(region, allCheckbox.checked));
    refreshDerivedStates();
    emitChange();
  });

  // 南極（昭和基地）を収録しているため「47都道府県」ではなく「地域」と数える
  const allLabel = h(
    "label",
    { for: "region-select-all", class: "region-controls__label" },
    `すべて一括選択（全 ${totalPrefectureCount} 地域）`
  );

  allGroup.append(japanCheckbox, japanLabel, allCheckbox, allLabel);

  const clearButton = h(
    "button",
    {
      type: "button",
      class: "region-controls__clear",
      onClick: () => {
        selected.clear();
        prefectureCheckboxes.forEach((cb) => (cb.checked = false));
        refreshDerivedStates();
        emitChange();
      },
    },
    "選択をクリア"
  );

  controls.append(allGroup, clearButton);
  container.append(controls);

  // --- 地方ごとのグループ ---------------------------------------------
  const list = h("div", { class: "region-list" });

  /** 1地域（地方 / 北海道）分のカードDOMを作る */
  function buildRegionGroup(region) {
    const groupId = `region-${region.id}`;
    const group = h("div", { class: "region-group" });

    const regionCb = document.createElement("input");
    regionCb.type = "checkbox";
    regionCb.className = "region-group__checkbox";
    regionCb.id = groupId;
    regionCb.addEventListener("change", () => {
      setRegionSelected(region, regionCb.checked);
      refreshDerivedStates();
      emitChange();
    });
    regionCheckboxes.set(region.id, regionCb);

    const toggleBtn = h(
      "button",
      {
        type: "button",
        class: "region-group__toggle",
        "aria-expanded": "true",
        "aria-label": `${region.name}の都道府県一覧を折りたたむ`,
      },
      "−"
    );

    const regionLabel = h(
      "label",
      { for: groupId, class: "region-group__label" },
      `${region.name} (${regionCount(region)})`
    );
    regionLabels.set(region.id, regionLabel);

    const header = h("div", { class: "region-group__header" }, [regionCb, regionLabel, toggleBtn]);

    const prefList = h("ul", { class: "prefecture-list" });

    region.prefectures.forEach((prefName) => {
      const prefId = `pref-${region.id}-${prefName}`;
      const prefCb = document.createElement("input");
      prefCb.type = "checkbox";
      prefCb.className = "prefecture-item__checkbox";
      prefCb.id = prefId;
      prefCb.checked = selected.has(prefName);
      prefCb.addEventListener("change", () => {
        setPrefectureSelected(prefName, prefCb.checked);
        updateRegionCheckboxState(region);
        updateAllCheckboxState();
        emitChange();
      });
      prefectureCheckboxes.set(prefName, prefCb);

      const prefLabel = h(
        "label",
        { for: prefId, class: "prefecture-item__label" },
        ` ${prefName} (${countFor(prefName)})`
      );
      prefectureLabels.set(prefName, prefLabel);

      const li = h("li", { class: "prefecture-item" }, [prefCb, prefLabel]);
      li.classList.toggle("prefecture-item--empty", countFor(prefName) === 0);
      prefList.append(li);
    });

    toggleBtn.addEventListener("click", () => {
      const expanded = toggleBtn.getAttribute("aria-expanded") === "true";
      toggleBtn.setAttribute("aria-expanded", String(!expanded));
      toggleBtn.textContent = expanded ? "+" : "−";
      prefList.hidden = expanded;
    });

    group.append(header, prefList);
    return group;
  }

  displayRegions.forEach((region) => list.append(buildRegionGroup(region)));

  container.append(list);
  refreshDerivedStates();

  /** 他の絞り込み条件が変わったとき、チェック状態・開閉状態を保ったまま「(件数)」だけ更新する */
  function updateCounts(newCounts) {
    counts = newCounts ?? new Map();
    displayRegions.forEach((region) => {
      const regionLabel = regionLabels.get(region.id);
      if (regionLabel) regionLabel.textContent = `${region.name} (${regionCount(region)})`;

      region.prefectures.forEach((prefName) => {
        const prefLabel = prefectureLabels.get(prefName);
        if (!prefLabel) return;
        prefLabel.textContent = ` ${prefName} (${countFor(prefName)})`;
        prefLabel.parentElement?.classList.toggle("prefecture-item--empty", countFor(prefName) === 0);
      });
    });
  }

  return { updateCounts };
}
