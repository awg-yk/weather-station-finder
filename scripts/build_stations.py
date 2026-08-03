"""
scripts/build_stations.py
------------------------------------------------------------
気象庁の公式アメダス観測所マスタ（amedastable.json）から、
data/stations.json（このアプリの観測所マスタ）を再構築するスクリプト。

事前準備:
  1. 気象庁のアメダス観測所表をダウンロードする
       https://www.jma.go.jp/bosai/amedas/const/amedastable.json
     → このリポジトリ直下（またはお好きな場所）に保存する
  2. 都道府県境界のGeoJSONをダウンロードする（dataofjapan/land, 約13MB。
     サイズが大きいためこのリポジトリには同梱していない）
       https://raw.githubusercontent.com/dataofjapan/land/master/japan.geojson
  3. 依存ライブラリをインストールする
       pip install shapely

実行方法:
  python3 scripts/build_stations.py \
    --amedas /path/to/amedastable.json \
    --geojson /path/to/japan.geojson \
    --existing data/stations.json \
    --extra scripts/extra_stations.json \
    --output data/stations.json

処理内容:
  1. lat/lon を [度, 分] から10進度に変換
  2. 都道府県境界GeoJSON + shapely で、点(lat, lon)がどの都道府県ポリゴンに
     属するかを判定（point-in-polygon）。ポリゴンに入らない場合（沿岸部・離島の
     座標誤差など）は最近傍の都道府県を採用する
  3. 既存の regions マスタ（8地方+沖縄）から都道府県→地方の逆引きテーブルを作成
  4. elems（8桁: 気温・降水量・風向・風速・日照時間・積雪深・湿度・気圧）から
     このアプリの6要素（temperature/precipitation/wind/snow/humidity/sunshine）を
     導出する。wind は風向・風速のいずれかが1なら有効。気圧はこのアプリの要素に
     無いため無視する。気象官署（type=="A"）は、積雪センサーの有無に関わらず
     「過去の気象データ検索」で積雪の深さが選択可能なため、常にsnowを含める
     （那覇・南大東・宮古島・石垣島など、降雪の無い地域の気象官署対策）
  5. type（A〜G）から stationType を単純化する。A=気象官署、B/D/E/F/G=特別地域気象観測所
     （これらはいずれも「過去の気象データ検索」で気象官署に近い扱いを受けるため、
     このアプリでは両方まとめて「気象台等」として表示する）、C=アメダス
  6. scripts/extra_stations.json（amedastable.json に載らない観測所。現在は南極・昭和基地のみ）を
     追記し、そこで使われている地方（南極）が regions マスタに無ければ追加する

注意:
  precNo / blockNo（気象庁「過去の気象データ検索」(etrn) 用の地点番号）は、
  amedastable.json の観測所コードとは異なる採番のため、このスクリプトでは
  生成しない。正確な対応表を用意できた場合は、生成後の stations.json に
  手動 or 別スクリプトで追加することを想定している。
"""

import argparse
import json
from collections import Counter

from shapely.geometry import Point, shape

# elems の桁 -> このアプリの要素ID （None は対応要素なし = 無視）
ELEMS_INDEX_MAP = {
    0: "temperature",
    1: "precipitation",
    2: "wind",  # 風向
    3: "wind",  # 風速（風向と同じ扱い。どちらかが1ならwind=観測あり）
    4: "sunshine",
    5: "snow",
    6: "humidity",
    7: None,  # 気圧（このアプリでは扱わない）
}


def dms_to_decimal(dm):
    """[度, 分] -> 10進度"""
    deg, minute = dm
    return round(deg + minute / 60, 6)


def elems_to_element_list(elems: str, type_code: str = ""):
    ids, seen = [], set()
    for i, ch in enumerate(elems):
        target = ELEMS_INDEX_MAP.get(i)
        if target is None:
            continue
        if ch != "0" and target not in seen:  # '1'(観測) or '2'(推定値) を「観測あり」扱い
            ids.append(target)
            seen.add(target)
    # 気象官署（type=="A"）は、沖縄など降雪が無い地域でも気象庁「過去の気象データ検索」で
    # 積雪の深さが選択可能（実測は常に0cm等でも観測項目としては存在する）。
    # amedastable.json の elems は積雪センサーの有無のみを表すため、それだけでは
    # 那覇・南大東・宮古島・石垣島などが「積雪の観測なし」と誤判定されてしまう。
    if type_code == "A" and "snow" not in seen:
        insert_at = len(ids)
        for j, e in enumerate(ids):
            if e == "humidity":
                insert_at = j
                break
        ids.insert(insert_at, "snow")
    return ids


# A=気象官署、B/D/E/F/G=特別地域気象観測所（父島=D、南鳥島=E、富士山=F、秩父別=G等の
# 単独コードも含む）。いずれも通常のアメダスより観測項目が多い拠点のため、
# このアプリでは「気象台等」としてまとめて扱う。C=通常のアメダス。
KANSHO_LIKE_TYPES = {"A", "B", "D", "E", "F", "G"}


def station_type_label(type_code: str) -> str:
    return "気象台等" if type_code in KANSHO_LIKE_TYPES else "アメダス"


def load_extra_stations(path):
    """amedastable.json に載らない観測所の定義を読む。ファイルが無ければ空扱い。

    "_" で始まるキーはファイル内メモ（_comment / _note）なので取り除く。"""
    try:
        raw = json.load(open(path, encoding="utf-8"))
    except FileNotFoundError:
        print(f"note: {path} が見つからないため追加観測所なしで続行します")
        return {"extraRegions": [], "stations": []}

    stations = [{k: v for k, v in s.items() if not k.startswith("_")} for s in raw.get("stations", [])]
    return {"extraRegions": raw.get("extraRegions", []), "stations": stations}


def main():
    parser = argparse.ArgumentParser(description="Rebuild data/stations.json from JMA amedastable.json")
    parser.add_argument("--amedas", required=True, help="path to amedastable.json")
    parser.add_argument("--geojson", required=True, help="path to Japan prefecture boundary GeoJSON")
    parser.add_argument("--existing", required=True, help="path to existing stations.json (for regions/elements master)")
    parser.add_argument(
        "--extra",
        default="scripts/extra_stations.json",
        help="path to extra_stations.json (stations not present in amedastable.json)",
    )
    parser.add_argument("--output", required=True, help="path to write the rebuilt stations.json")
    args = parser.parse_args()

    amedas = json.load(open(args.amedas, encoding="utf-8"))
    geo = json.load(open(args.geojson, encoding="utf-8"))
    existing = json.load(open(args.existing, encoding="utf-8"))
    extra = load_extra_stations(args.extra)

    pref_polygons = [(f["properties"]["nam_ja"], shape(f["geometry"])) for f in geo["features"]]

    # 追加観測所が使う地方（南極など）が regions マスタに無ければ足しておく
    regions = list(existing["regions"])
    known_region_ids = {r["id"] for r in regions}
    for region in extra["extraRegions"]:
        if region["id"] not in known_region_ids:
            regions.append(region)
            known_region_ids.add(region["id"])

    pref_to_region = {}
    for region in regions:
        for pref in region["prefectures"]:
            pref_to_region[pref] = region["id"]

    stations = []
    unmatched = []

    for code, info in amedas.items():
        lat = dms_to_decimal(info["lat"])
        lon = dms_to_decimal(info["lon"])
        point = Point(lon, lat)  # GeoJSONはlon,lat順

        matched_pref = None
        for pref_name, poly in pref_polygons:
            if poly.contains(point):
                matched_pref = pref_name
                break

        if matched_pref is None:
            best_pref, best_dist = None, float("inf")
            for pref_name, poly in pref_polygons:
                d = poly.distance(point)
                if d < best_dist:
                    best_dist = d
                    best_pref = pref_name
            matched_pref = best_pref
            unmatched.append((code, info["kjName"], matched_pref, round(best_dist, 4)))

        region_id = pref_to_region.get(matched_pref)
        elements = elems_to_element_list(info["elems"], info["type"])

        stations.append(
            {
                "id": code,
                "name": info["kjName"],
                "kana": info.get("knName", ""),
                "enName": info.get("enName", ""),
                "prefecture": matched_pref,
                "region": region_id,
                "lat": lat,
                "lon": lon,
                "alt": info.get("alt"),
                "elements": elements,
                "stationType": station_type_label(info["type"]),
            }
        )

    # amedastable.json に無い観測所（南極・昭和基地など）を追記する。
    # 座標がGeoJSONの都道府県ポリゴン外なので、prefecture/region は定義側の値をそのまま使う。
    amedas_ids = {s["id"] for s in stations}
    for station in extra["stations"]:
        if station["id"] in amedas_ids:
            print(f"warn: extra station id {station['id']} は amedastable 側と重複するためスキップします")
            continue
        stations.append(station)

    stations.sort(key=lambda s: s["id"])

    # フェーズ23: 地域選択UIで北海道を14地域（振興局相当）に分割表示するための補助データ。
    # station.region/prefectureの判定には使わない（pref_to_regionは従来通り「北海道」を単一の都道府県として扱う）
    # ため、既存ファイルの値をそのまま引き継ぐだけでよい。
    output = {
        "regions": regions,
        "hokkaidoSubAreas": existing.get("hokkaidoSubAreas", []),
        "elements": existing["elements"],
        "stations": stations,
    }
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"total stations: {len(stations)} (うち追加定義: {len(extra['stations'])})")
    print(f"unmatched (nearest-neighbor fallback used): {len(unmatched)}")
    for row in unmatched:
        print("  ", row)

    pref_counts = Counter(s["prefecture"] for s in stations)
    missing_prefs = set(pref_to_region.keys()) - set(pref_counts.keys())
    print(f"\nprefecture counts: {len(pref_counts)} / {len(pref_to_region)}")
    print("prefectures with 0 stations:", missing_prefs or "(none)")


if __name__ == "__main__":
    main()
