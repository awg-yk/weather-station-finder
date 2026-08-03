/**
 * mapView.js
 * ------------------------------------------------------------
 * Leaflet地図に現在の絞り込み結果（store.visibleStations）を
 * マーカーとして描画するモジュール（フェーズ6: 地図表示）。
 *
 * 設計方針:
 *   - store.subscribe() して visibleStations が変わったときだけ再描画する
 *     （ページ切り替えでは visibleStations 自体は変化しないので再描画しない）
 *   - 気象台等／アメダスを色分けしたマーカー（円形マーカー・低コスト）
 *   - 全国選択時は1,000件超になるため Leaflet.markercluster でクラスタリング
 *     （読み込まれていない場合は通常のレイヤーグループにフォールバック）
 *   - ポップアップの中身は buildPopupHtml() として純粋関数に分離し、
 *     Leaflet無しでもユニットテストできるようにしてある
 *   - ページをスクロールしただけで地図が勝手にズーム／移動しないよう、
 *     地図の操作には Ctrl（macOSは⌘）を要求する（下記「操作方法」参照）
 *
 * 操作方法（意図しない地図の移動を防ぐためのジェスチャ制御）:
 *   - ホイールでの拡大縮小: Ctrl（または⌘）を押しながら。押していないときは
 *     ページが普通にスクロールし、代わりに操作ヒントを表示する
 *   - ドラッグでの移動: Ctrl（または⌘）を押している間だけ有効
 *   - タッチ端末: 1本指はページのスクロール、2本指で地図の拡大縮小・移動
 *   - Ctrlを使わない操作: 左上の ＋／− ボタン、ダブルクリック、
 *     右上の「検索結果に合わせる」ボタン、地図フォーカス中の矢印キー
 *
 * 前提: Leaflet / Leaflet.markercluster は index.html 側で
 *       vendor/leaflet/ から読み込み、window.L としてグローバルに存在すること
 *       （フェーズ18でCDN依存を解消し、npm配布物をリポジトリに同梱する方式に変更した）。
 */

import { buildJmaStationLink, buildJmaPrefectureLink } from "./exporter.js";

const STATION_TYPE_COLORS = {
  気象台等: "#1C7C8C", // --color-teal
  アメダス: "#E8A33D", // --color-amber
};
const DEFAULT_MARKER_COLOR = "#5B6672"; // --color-ink-soft
const DISCONTINUED_MARKER_COLOR = "#9AA1AA"; // --color-border-strong寄りの薄いグレー（フェーズ16）

/** 観測所種別からマーカー色を返す（テスト容易にするため独立関数）。
 *  廃止済み観測所は種別に関わらずグレー表示にする（フェーズ16）。 */
export function getMarkerColor(station) {
  if (station?.discontinued) return DISCONTINUED_MARKER_COLOR;
  return STATION_TYPE_COLORS[station?.stationType] ?? DEFAULT_MARKER_COLOR;
}

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

/**
 * マーカーのポップアップに表示するHTML文字列を組み立てる。
 * Leafletに依存しない純粋関数（ユニットテスト対象）。
 */
export function buildPopupHtml(station, { elementLabelMap } = {}) {
  const elementNames = (station.elements ?? [])
    .map((id) => elementLabelMap?.get(id) ?? id)
    .join("・");
  const jmaLink = buildJmaStationLink(station);
  const prefectureLink = buildJmaPrefectureLink(station);
  // 廃止済み観測所は、precNo/blockNoが確定していればリンクに加えて観測期間も表示する（フェーズ19）
  const discontinuedPeriod = station.discontinued
    ? `<br><span class="map-popup__no-link">廃止済み観測所（観測期間: ${escapeHtml(
        station.observedFrom ?? "?"
      )} 〜 ${escapeHtml(station.observedTo ?? "?")}）</span>`
    : "";

  let jmaLinkHtml;
  if (jmaLink) {
    jmaLinkHtml = `<a href="${jmaLink}" target="_blank" rel="noopener noreferrer">気象庁の観測データを見る ↗</a>${discontinuedPeriod}`;
  } else if (station.discontinued) {
    // 廃止済みでprecNo/blockNoが未確定の場合は、リンクの代わりに観測期間だけを表示する
    jmaLinkHtml = `<span class="map-popup__no-link">廃止済み観測所（観測期間: ${escapeHtml(
      station.observedFrom ?? "?"
    )} 〜 ${escapeHtml(station.observedTo ?? "?")}）。地点番号未確定のため気象庁ページへのリンクはありません。</span>`;
  } else if (prefectureLink) {
    jmaLinkHtml = `<a href="${prefectureLink}" target="_blank" rel="noopener noreferrer">都道府県の地点選択ページを開く ↗</a><br><span class="map-popup__no-link">（気象庁側に同名で複数の地点番号${escapeHtml(
      station.blockNoAmbiguousCandidates?.length ? `（${station.blockNoAmbiguousCandidates.join(" / ")}）` : ""
    )}があり自動判定を保留中）</span>`;
  } else {
    jmaLinkHtml = `<span class="map-popup__no-link">気象庁リンク未収録</span>`;
  }

  const coords =
    typeof station.lat === "number" && typeof station.lon === "number"
      ? `${station.lat.toFixed(4)}, ${station.lon.toFixed(4)}`
      : "—";

  return [
    '<div class="map-popup">',
    `<p class="map-popup__title">${escapeHtml(station.name)}`,
    `<span class="map-popup__kana">（${escapeHtml(station.kana ?? "")}）</span></p>`,
    `<p class="map-popup__meta">${escapeHtml(station.prefecture)} ／ ${escapeHtml(
      station.stationType ?? ""
    )} ／ 標高 ${escapeHtml(station.alt ?? "—")} m</p>`,
    `<p class="map-popup__meta">緯度経度 ${escapeHtml(coords)} ／ 地点コード ${escapeHtml(station.id ?? "—")}</p>`,
    `<p class="map-popup__elements">${escapeHtml(elementNames || "観測要素データなし")}</p>`,
    `<p class="map-popup__link">${jmaLinkHtml}</p>`,
    "</div>",
  ].join("");
}

/**
 * 地図操作を許可する修飾キー（Windows/Linux: Ctrl、macOS: ⌘）が押されているか。
 * Leaflet非依存の純粋関数（ユニットテスト対象）。
 */
export function isMapGestureModifier(event) {
  return Boolean(event && (event.ctrlKey || event.metaKey));
}

/**
 * 地域・観測要素・種別・検索語のいずれかが実際に選択/入力されているか。
 * 「廃止済み観測所を含める」は既定の状態でありユーザーによる絞り込みではないため、
 * ここでは判定に使わない（フェーズ22。以前は visibleStations.length と allStations.length
 * の比較で判定していたが、廃止済み観測所が既定で母集団に加わるようになったことで
 * 絞り込みなしでも両者が食い違うようになり、初期表示で誤って地図全体を南極まで
 * fitBoundsしてしまう不具合があった）。
 */
export function hasActiveFilters(state) {
  return Boolean(
    state.selectedPrefectures?.size > 0 ||
      state.selectedElements?.size > 0 ||
      state.selectedStationTypes?.size > 0 ||
      (state.keyword && state.keyword.trim() !== "")
  );
}

/** 実行環境に合わせた修飾キーの表示名を返す（ヒント文言用） */
function modifierKeyLabel() {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent ?? "";
  return /Mac|iPhone|iPad|iPod/.test(ua) ? "⌘（command）" : "Ctrl";
}

/**
 * 地図の上に重ねる操作ヒント（「Ctrl + ホイールで拡大縮小できます」等）を作り、
 * 表示関数 showHint(message) を返す。同じメッセージ中の連続呼び出しは表示時間だけ延長する。
 */
function createGestureHint(L, container) {
  const hint = L.DomUtil.create("div", "map-gesture-hint", container);
  hint.setAttribute("aria-hidden", "true");
  let hideTimer = null;

  return function showHint(message) {
    hint.textContent = message;
    hint.classList.add("is-visible");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => hint.classList.remove("is-visible"), 1800);
  };
}

/**
 * ページのスクロール中に地図が勝手にズーム／移動するのを防ぐためのジェスチャ制御。
 *   - ホイールズーム: Ctrl（⌘）を押している間だけ。押していなければページをスクロールさせる
 *   - ドラッグ移動  : Ctrl（⌘）を押している間だけ dragging ハンドラを有効化する
 *   - タッチ端末    : 2本指のときだけ地図操作、1本指はページのスクロール
 *
 * Leafletの scrollWheelZoom を使わず自前でズームしているのは、「Ctrl押下を検知して
 * から有効化」ではその回のイベントがLeaflet側のハンドラに届かず、
 * 1回目だけブラウザのページ拡大が起きてしまうため。
 */
function setupGestureHandling({ map, container, showHint }) {
  const modifier = modifierKeyLabel();
  let lastWheelZoomAt = 0;

  function setDraggingEnabled(enabled) {
    if (enabled === map.dragging.enabled()) return;
    if (enabled) {
      map.dragging.enable();
    } else {
      map.dragging.disable();
    }
    container.classList.toggle("map-view--gesture-active", enabled);
  }

  // --- ホイール操作 ---------------------------------------------------
  container.addEventListener(
    "wheel",
    (event) => {
      if (!isMapGestureModifier(event)) {
        showHint(`${modifier} を押しながらホイールで拡大縮小できます`);
        return; // preventDefault しない = ページが通常どおりスクロールする
      }
      event.preventDefault(); // ブラウザのページ拡大縮小を抑止

      const now = Date.now();
      if (now - lastWheelZoomAt < 80) return; // 連続イベントで飛びすぎないよう間引く
      lastWheelZoomAt = now;

      const step = map.options.zoomDelta ?? 1;
      const nextZoom = map.getZoom() + (event.deltaY < 0 ? step : -step);
      map.setZoomAround(map.mouseEventToLatLng(event), nextZoom);
    },
    { passive: false }
  );

  // --- ドラッグ操作（Ctrl押下中のみ有効） -------------------------------
  const syncDragging = (event) => setDraggingEnabled(isMapGestureModifier(event));
  container.addEventListener("mouseenter", syncDragging);
  container.addEventListener("mousemove", syncDragging);

  const onModifierKey = (event, enabled) => {
    if (event.key === "Control" || event.key === "Meta") setDraggingEnabled(enabled);
  };
  window.addEventListener("keydown", (event) => onModifierKey(event, true));
  window.addEventListener("keyup", (event) => onModifierKey(event, false));
  window.addEventListener("blur", () => setDraggingEnabled(false)); // Alt+Tab等でキー状態を取りこぼさない

  // 修飾キー無しでドラッグしようとした場合だけヒントを出す（クリックやマーカー選択では出さない）
  let pressOrigin = null;
  container.addEventListener("mousedown", (event) => {
    pressOrigin = event.button === 0 && !isMapGestureModifier(event) ? { x: event.clientX, y: event.clientY } : null;
  });
  window.addEventListener("mousemove", (event) => {
    if (!pressOrigin) return;
    if (Math.abs(event.clientX - pressOrigin.x) + Math.abs(event.clientY - pressOrigin.y) < 8) return;
    pressOrigin = null;
    showHint(`${modifier} を押しながらドラッグすると地図を動かせます`);
  });
  window.addEventListener("mouseup", () => {
    pressOrigin = null;
  });

  // --- タッチ操作（2本指のときだけ地図を動かす） -------------------------
  container.addEventListener(
    "touchstart",
    (event) => setDraggingEnabled(event.touches.length >= 2),
    { passive: true }
  );
  container.addEventListener(
    "touchmove",
    (event) => {
      if (event.touches.length === 1) showHint("2本指で地図を動かせます");
    },
    { passive: true }
  );
  container.addEventListener(
    "touchend",
    (event) => {
      if (event.touches.length < 2) setDraggingEnabled(false);
    },
    { passive: true }
  );
}

/**
 * 地図ビューを初期化し、store の変化を購読して自動描画するようにする。
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.container - 地図を描画するDOM要素
 * @param {Object} opts.store - stateManager.js の store
 * @param {Map} opts.elementLabelMap - 観測要素ID→日本語ラベルの辞書
 * @returns {Object|null} Leaflet map インスタンス（Leaflet未読み込み時はnull）
 */
export function initMapView({
  container,
  store,
  elementLabelMap,
  onToggleStation,
  onSetExcluded,
  onSelectPrefecture,
  isPrefectureActive,
}) {
  const onSelectStation = (id) => {
    const state = store.getState();
    const index = state.visibleStations.findIndex((s) => s.id === id);
    const page = index === -1 ? state.page : Math.floor(index / state.pageSize) + 1;
    store.setState({ selectedStationId: id, page });
  };

  if (typeof window === "undefined" || !window.L) {
    container.innerHTML =
      '<p class="map-view__error">地図ライブラリ(Leaflet)の読み込みに失敗しました。vendor/leaflet/ 配下のファイルが揃っているかご確認のうえ再読み込みしてください。</p>';
    return null;
  }
  const L = window.L;

  // 日本列島の範囲に固定する（大陸が見えて無駄にならないように）
  const JAPAN_BOUNDS = L.latLngBounds([24.0, 122.0], [46.5, 149.5]);

  const map = L.map(container, {
    preferCanvas: true, // 大量マーカー描画のパフォーマンス対策
    scrollWheelZoom: false, // Ctrl押下時のみ自前でズームする（setupGestureHandling）
    dragging: false, // Ctrl押下中・タッチ2本指のときだけ有効化する
    minZoom: 4,
    maxBounds: JAPAN_BOUNDS.pad(0.15), // これより外（大陸側）へはパンできない
    maxBoundsViscosity: 1.0,
  });
  map.fitBounds(JAPAN_BOUNDS); // 初期表示は日本全体

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
  }).addTo(map);

  const showHint = createGestureHint(L, container);
  setupGestureHandling({ map, container, showHint });

  // 地域を選ぶ前は地点を出さず、この案内を地図に重ねて表示する
  const emptyHint = L.DomUtil.create("div", "map-empty-hint", container);
  emptyHint.innerHTML = "地図で<b>都道府県をクリック</b>すると、<br>その地点が表示されます";

  // ── 都道府県の境界をクリックして選べるようにする（気象庁の過去DL風） ──
  //   ポリゴンはマーカーより下のペインに置き、地点マーカーのクリックを優先させる。
  map.createPane("prefectures");
  map.getPane("prefectures").style.zIndex = 250;
  const prefRenderer = L.svg({ pane: "prefectures" }); // マーカー(canvas)とは別にSVGで描く
  const polyByName = new Map(); // 都道府県名 -> Leafletレイヤー

  function prefStyle(name) {
    const active = Boolean(isPrefectureActive && isPrefectureActive(name));
    return {
      pane: "prefectures",
      color: active ? "#1C7C8C" : "#7f9aa0",
      weight: active ? 2.5 : 1,
      fillColor: active ? "#1C7C8C" : "#9fc0c6",
      fillOpacity: active ? 0.2 : 0.06,
    };
  }

  function restylePrefectures() {
    polyByName.forEach((layer, name) => layer.setStyle(prefStyle(name)));
  }

  fetch("data/prefectures.geojson")
    .then((r) => r.json())
    .then((geo) => {
      L.geoJSON(geo, {
        pane: "prefectures",
        renderer: prefRenderer,
        style: (f) => prefStyle(f.properties.name),
        onEachFeature: (f, layer) => {
          const name = f.properties.name;
          polyByName.set(name, layer);
          layer.on("click", () => onSelectPrefecture && onSelectPrefecture(name));
          layer.on("mouseover", () => layer.setStyle({ fillOpacity: 0.3, weight: 2.5 }));
          layer.on("mouseout", () => layer.setStyle(prefStyle(name)));
          layer.bindTooltip(name, { sticky: true, direction: "top" });
        },
      }).addTo(map);
    })
    .catch(() => {
      /* 境界データが無くても地図・絞り込みは従来通り使える */
    });

  // クラスタ（数字集約）は使わず、選択中の地域の地点をすべて個別マーカーで表示する
  //   （地点が重なって数字になる問題を避ける。まとめて選択は「表示中をすべて選択」で行える）。
  const markerLayer = L.layerGroup();
  markerLayer.addTo(map);

  let lastVisibleStations = null;
  let lastValidStations = []; // 「検索結果に合わせる」ボタン用に、現在描画中の観測所を保持する
  let markerById = new Map(); // 一覧の行選択との相互連携用（フェーズ15）。render()のたびに作り直す
  let stationById = new Map(); // 除外スタイル更新用に id→station を保持する
  let selectedMarker = null;

  /** 現在描画中の観測所がすべて収まるように表示範囲を合わせる */
  function fitToRenderedStations({ maxZoom = 9 } = {}) {
    if (lastValidStations.length === 0) return false;
    const bounds = L.latLngBounds(lastValidStations.map((s) => [s.lat, s.lon]));
    if (!bounds.isValid()) return false;
    map.fitBounds(bounds, { padding: [24, 24], maxZoom });
    return true;
  }

  // 「検索結果に合わせる」ボタン（Ctrl不要。絞り込み結果を見失ったときの復帰手段）
  const FitBoundsControl = L.Control.extend({
    options: { position: "topright" },
    onAdd() {
      const button = L.DomUtil.create("button", "map-fit-btn");
      button.type = "button";
      button.textContent = "検索結果に合わせる";
      button.title = "現在の絞り込み結果がすべて収まるように地図の表示範囲を合わせます";
      L.DomEvent.disableClickPropagation(button);
      L.DomEvent.on(button, "click", () => {
        if (!fitToRenderedStations({ maxZoom: 12 })) {
          showHint("表示できる観測所がありません");
        }
      });
      return button;
    },
  });
  map.addControl(new FitBoundsControl());

  /**
   * @param {Array} stations - 描画する観測所（絞り込み結果）
   * @param {boolean} isFiltered - 絞り込みが効いているか。効いていないとき（全観測所表示）は
   *   表示範囲を動かさず、初期表示（日本周辺）のままにする。南極（昭和基地）まで含めて範囲を
   *   合わせると地図が世界全体まで引いてしまうため、既定では日本周辺だけを表示する（フェーズ22）。
   *   廃止済み観測所は既定で含まれるが、それ自体はユーザーによる「絞り込み」ではないので、
   *   isFilteredの判定には含めない（地域・観測要素・種別・検索語の実際の選択状態だけで判定する）。
   */
  /** マーカーを「対象に含む（濃い＝type色）」/「外した（薄い）」で塗り分ける。 */
  function styleMarker(marker, station, isSelected) {
    marker.setStyle({
      fillColor: getMarkerColor(station),
      fillOpacity: isSelected ? 0.95 : 0.2,
      color: isSelected ? "#1B1F23" : "#fff",
      weight: isSelected ? 2 : 1,
    });
  }

  function render(stations, isFiltered) {
    markerLayer.clearLayers();
    markerById = new Map();
    stationById = new Map();
    selectedMarker = null;

    // 地域などを選ぶ前は地点を出さず、日本全体のまま案内を表示する（気象庁の過去DL風の流れ）
    if (!isFiltered) {
      lastValidStations = [];
      emptyHint.style.display = "";
      map.fitBounds(JAPAN_BOUNDS);
      return;
    }
    emptyHint.style.display = "none";

    const excluded = store.getState().excludedIds ?? new Set();
    lastValidStations = stations.filter((s) => typeof s.lat === "number" && typeof s.lon === "number");

    lastValidStations.forEach((station) => {
      const isSelected = !excluded.has(station.id); // 絞り込み結果は既定で選択済み
      const marker = L.circleMarker([station.lat, station.lon], {
        radius: 6,
        color: isSelected ? "#1B1F23" : "#fff",
        weight: isSelected ? 2 : 1,
        fillColor: getMarkerColor(station),
        fillOpacity: isSelected ? 0.95 : 0.2,
      });
      marker.bindPopup(buildPopupHtml(station, { elementLabelMap }), { maxWidth: 260 });
      marker.stationId = station.id;
      // ③ カーソルを乗せると地点情報のポップアップを表示する
      marker.on("mouseover", () => marker.openPopup());
      // クリックで対象に含める／外すをトグル（一覧はスクロールさせない）
      marker.on("click", () => onToggleStation?.(station.id));
      markerById.set(station.id, marker);
      stationById.set(station.id, station);
      markerLayer.addLayer(marker);
    });

    fitToRenderedStations();
  }

  /** 除外集合が変わったとき、変化したマーカーだけ塗り分けを更新する（全再描画は避ける）。 */
  function updateExcludedStyles(prev, next) {
    const changed = new Set();
    prev.forEach((id) => next.has(id) || changed.add(id));
    next.forEach((id) => prev.has(id) || changed.add(id));
    changed.forEach((id) => {
      const marker = markerById.get(id);
      const station = stationById.get(id);
      if (marker && station) styleMarker(marker, station, !next.has(id));
    });
  }

  /**
   * 一覧の行がクリックされたとき、対応するマーカーを目立たせて中心に寄せ、ポップアップを開く。
   */
  function focusStation(id) {
    const marker = markerById.get(id);
    if (!marker) return; // 絞り込みで現在の地図に表示されていない観測所は何もしない
    if (!markerLayer.hasLayer(marker)) return; // 除外中で地図に載っていない地点は何もしない

    if (selectedMarker && selectedMarker !== marker) {
      selectedMarker.setStyle({ radius: 6, weight: 1 });
    }
    marker.setStyle({ radius: 9, weight: 3 });
    selectedMarker = marker;

    map.panTo(marker.getLatLng());
    marker.openPopup();
  }

  let lastSelectedStationId = null;
  let lastExcludedIds = store.getState().excludedIds ?? new Set();
  let lastSelectedPrefectures = store.getState().selectedPrefectures ?? new Set();
  store.subscribe((state) => {
    if (state.status !== "ready") return;
    if (state.selectedPrefectures !== lastSelectedPrefectures) {
      lastSelectedPrefectures = state.selectedPrefectures ?? new Set();
      restylePrefectures(); // 選択中の都道府県を地図上でも強調
    }
    if (state.visibleStations !== lastVisibleStations) {
      lastVisibleStations = state.visibleStations;
      render(state.visibleStations, hasActiveFilters(state));
      lastExcludedIds = state.excludedIds ?? new Set(); // 再描画時に反映済みなので基準を更新
    } else if (state.excludedIds !== lastExcludedIds) {
      // 絞り込みは変わらず除外だけ変化 → 該当マーカーの塗り分けだけ更新する
      const prev = lastExcludedIds;
      lastExcludedIds = state.excludedIds ?? new Set();
      updateExcludedStyles(prev, lastExcludedIds);
    }
    if (state.selectedStationId !== lastSelectedStationId) {
      lastSelectedStationId = state.selectedStationId;
      if (state.selectedStationId != null) focusStation(state.selectedStationId);
    }
  });

  // 購読開始時点で既に ready 状態なら即描画する
  const initialState = store.getState();
  if (initialState.status === "ready") {
    lastVisibleStations = initialState.visibleStations;
    render(initialState.visibleStations, hasActiveFilters(initialState));
  }

  return map;
}
