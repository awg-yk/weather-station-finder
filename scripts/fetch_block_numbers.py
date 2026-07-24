"""
scripts/fetch_block_numbers.py
------------------------------------------------------------
気象庁「過去の気象データ検索」(etrn) の都道府県・地方選択ページから、
各観測所の precNo（都府県・地方番号）/ blockNo（地点番号）を収集する。

【なぜこのスクリプトが必要か】
data/stations.json は amedastable.json（アメダス観測網用の地点番号 = amdno）
から構築されているが、amdno と etrn の precNo/blockNo は別の採番体系で、
機械的に変換できない（例: 東京は amdno=44132 だが etrn block_no=47662）。
そのため、etrn 側のページを直接読んで precNo/blockNo を集める必要がある。

【実行環境についての注意】
このスクリプトは www.data.jma.go.jp への外部アクセスが必要なため、
サンドボックス環境（このプロジェクトを生成したAIの実行環境）からは
実行できない。お手元のPC等、通常のインターネットアクセスがある環境で
実行してほしい。

事前準備:
  pip install beautifulsoup4

実行方法:
  python3 scripts/fetch_block_numbers.py --output data/block_numbers.json

処理内容:
  1. 気象庁が定義する precNo（都府県・地方番号、北海道は14地方に細分）
     一覧をこのスクリプト内にハードコードしておく（PREC_NO_TABLE）
  2. 各 precNo について
       https://www.data.jma.go.jp/obd/stats/etrn/select/prefecture.php
         ?prec_no={precNo}&block_no=&year=&month=&day=&view=
     を取得し、地図イメージマップ（<map><area>）から
     各観測所の blockNo（hrefのblock_noパラメータ）と地点名（alt属性）を抽出する
  3. サーバー負荷に配慮し、リクエスト間に待機時間を入れる
  4. 結果を [{precNo, blockNo, name, prefName}, ...] としてJSONに保存する

【出力後にやること】
  scripts/merge_block_numbers.py で data/stations.json とマージする。

【既知の制約・要検証事項】
  - このスクリプトはページの<area>タグのhref/alt属性を前提にパースしている。
    気象庁側のページ構造が変わっている場合は動作しない可能性があるため、
    まず1つのprec_noだけで試して出力内容を確認することを推奨する
    （--only 44 のように起動すると東京都のみ取得できる）。
  - 地点名の表記が data/stations.json 側（amedastable.json由来）と
    完全一致しない場合がある（読み仮名の有無、旧称など）。
    その場合は merge_block_numbers.py の出力する「unmatched」リストを見て
    手動で名寄せ表を補ってほしい。
"""

import argparse
import json
import re
import time
import urllib.request
from urllib.parse import urljoin, parse_qs, urlparse

try:
    from bs4 import BeautifulSoup
except ImportError:
    raise SystemExit("beautifulsoup4 が必要です: pip install beautifulsoup4")

BASE_URL = "https://www.data.jma.go.jp/obd/stats/etrn/select/prefecture.php"
USER_AGENT = "weather-station-finder-data-tool/1.0 (research use; contact via GitHub repo)"

# 気象庁 precNo（都府県・地方番号）一覧。
# 北海道は14地方（宗谷・上川・留萌・石狩・空知・後志・網走／北見／紋別・根室・
# 釧路・十勝・胆振・日高・渡島・檜山）に細分されている。
PREC_NO_TABLE = {
    11: "宗谷地方", 12: "上川地方", 13: "留萌地方", 14: "石狩地方",
    15: "空知地方", 16: "後志地方", 17: "網走・北見・紋別地方", 18: "根室地方",
    19: "釧路地方", 20: "十勝地方", 21: "胆振地方", 22: "日高地方",
    23: "渡島地方", 24: "檜山地方",
    31: "青森県", 32: "秋田県", 33: "岩手県", 34: "宮城県", 35: "山形県", 36: "福島県",
    40: "茨城県", 41: "栃木県", 42: "群馬県", 43: "埼玉県", 44: "東京都",
    45: "千葉県", 46: "神奈川県",
    48: "長野県", 49: "山梨県", 50: "静岡県", 51: "愛知県", 52: "岐阜県", 53: "三重県",
    54: "新潟県", 55: "富山県", 56: "石川県", 57: "福井県",
    60: "滋賀県", 61: "京都府", 62: "大阪府", 63: "兵庫県", 64: "奈良県", 65: "和歌山県",
    66: "岡山県", 67: "広島県", 68: "島根県", 69: "鳥取県",
    71: "徳島県", 72: "香川県", 73: "愛媛県", 74: "高知県",
    81: "山口県", 82: "福岡県", 83: "大分県", 84: "長崎県", 85: "佐賀県",
    86: "熊本県", 87: "宮崎県", 88: "鹿児島県",
    91: "沖縄県",
    # 99: 南極（このアプリの対象外なので除外）
}

# 北海道の14地方はすべて data/stations.json 上の prefecture では「北海道」に統一する
HOKKAIDO_PREC_NOS = set(range(11, 25))


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def extract_stations(html: str, prec_no: int, pref_name: str):
    soup = BeautifulSoup(html, "html.parser")
    results = []
    for area in soup.find_all("area"):
        href = area.get("href", "")
        name = area.get("alt", "").strip()
        if not href or not name:
            continue
        qs = parse_qs(urlparse(href).query)
        block_no = qs.get("block_no", [None])[0]
        href_prec_no = qs.get("prec_no", [None])[0]
        if not block_no:
            continue
        # 「◯◯全地点」のような一括選択用リンクは実観測所ではないので除外する
        if block_no == "00" or "全地点" in name or "全観測所" in name:
            continue
        results.append(
            {
                "precNo": href_prec_no or str(prec_no),
                "blockNo": block_no,
                "name": name,
                "prefName": pref_name,
            }
        )
    return results


def main():
    parser = argparse.ArgumentParser(description="Fetch precNo/blockNo station numbers from JMA etrn pages")
    parser.add_argument("--output", default="data/block_numbers.json")
    parser.add_argument("--only", type=int, default=None, help="単一のprec_noのみ取得して試す（動作確認用）")
    parser.add_argument("--delay", type=float, default=1.0, help="リクエスト間の待機秒数")
    args = parser.parse_args()

    targets = {args.only: PREC_NO_TABLE[args.only]} if args.only else PREC_NO_TABLE

    all_results = []
    for prec_no, area_name in targets.items():
        pref_name = "北海道" if prec_no in HOKKAIDO_PREC_NOS else area_name
        url = f"{BASE_URL}?prec_no={prec_no}&block_no=&year=&month=&day=&view="
        print(f"fetching prec_no={prec_no} ({area_name}) ...")
        try:
            html = fetch(url)
        except Exception as e:
            print(f"  !! failed: {e}")
            continue
        stations = extract_stations(html, prec_no, pref_name)
        print(f"  -> {len(stations)} stations")
        all_results.extend(stations)
        time.sleep(args.delay)

    # 同一地点が地方境界の都合で重複することがあるので (precNo, blockNo) で重複排除
    seen = set()
    deduped = []
    for s in all_results:
        key = (s["precNo"], s["blockNo"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(s)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(deduped, f, ensure_ascii=False, indent=2)

    print(f"\ntotal unique stations: {len(deduped)}")
    print(f"written to {args.output}")


if __name__ == "__main__":
    main()
