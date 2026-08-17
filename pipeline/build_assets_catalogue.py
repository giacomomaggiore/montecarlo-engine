"""Dataset artifact gate, step 1: build the editable asset metadata catalogue.

Turns pipeline/etf_metadata.csv (currency/exchange/instrument-type lookups
already captured from Yahoo Finance) into pipeline/metadata/assets.csv, the
one row per assetId source-of-truth table the README's Asset Metadata
Catalogue section describes. Also writes pipeline/metadata/fx_routes.csv,
the companion FX-route table.

Usage:
    python pipeline/build_assets_catalogue.py

Re-running this script regenerates assets.csv from etf_metadata.csv plus the
decisions encoded below (universe filter, proxy backfills, name lookups). Once
regenerated, assets.csv is meant to be hand-edited going forward (e.g. filling
in ISIN/TER once that research happens) without needing to re-run this script.
"""

import csv
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from fetch_etf_data import fetch_chart_json  # reuse the tested Yahoo fetch helper

import pandas as pd

ETF_METADATA_PATH = "pipeline/etf_metadata.csv"
ASSETS_CSV_PATH = "pipeline/metadata/assets.csv"
FX_ROUTES_CSV_PATH = "pipeline/metadata/fx_routes.csv"
FUND_NAMES_CACHE_PATH = "pipeline/metadata/fund_names_cache.csv"
DATA_DIR = "data"

# v1 is a USD-only release. Excluding every non-USD-quoted ticker here means
# every included asset has returnCurrency == exposureCurrency == USD, so the
# FX-conversion formula in the README's FX Conversion section is the
# identity (X_t / X_t-1 == 1) and fx_routes.csv can stay empty for this
# release. FUTURE contracts are excluded because their roll/margin economics
# do not fit the simple "adjusted-close total return" model every other
# asset here uses. INDEX (^SPGSCI) is excluded because it is a benchmark,
# not something an investor can actually buy.
EXCLUDED_INSTRUMENT_TYPES = {"FUTURE", "INDEX"}

# Empirically discovered by correlating each _spliced file's pre-original-
# inception segment against every other return series in data/ (see LOG.MD
# for the exact correlation values, all ~1.0000). This is the pipeline's
# proxy/backfill record — required by the README so the Educational route
# can disclose which pre-inception years are a proxy, not the fund's own
# history.
PROXY_BACKFILLS = {
    "EMLC": {
        "proxyAssetId": "PREMX",
        "method": "asset-class-proxy",
        "rationale": (
            "PREMX (T. Rowe Price Emerging Markets Bond Fund) extends EMLC's "
            "history back to 1994-12-30; return series match exactly (correlation "
            "1.0000) over the overlapping period, confirming PREMX was the source."
        ),
    },
    "GLD": {
        "proxyAssetId": "GC=F",
        "method": "asset-class-proxy",
        "rationale": (
            "GC=F (COMEX gold futures) extends GLD's history back to 2000-08-30; "
            "return series match exactly (correlation 1.0000) over the overlapping "
            "period, confirming GC=F was the source."
        ),
    },
    "GSG": {
        "proxyAssetId": "^SPGSCI",
        "method": "index-level-backfill",
        "rationale": (
            "^SPGSCI (the S&P GSCI index GSG itself tracks) extends GSG's history "
            "back to 1984-01-03; return series match exactly (correlation 1.0000) "
            "over the overlapping period."
        ),
    },
    "HYG": {
        "proxyAssetId": "VWEHX",
        "method": "asset-class-proxy",
        "rationale": (
            "VWEHX (Vanguard High-Yield Corporate Fund) extends HYG's history back "
            "to 1980-01-02; return series match exactly (correlation 1.0000) over "
            "the overlapping period."
        ),
    },
    "IEMG": {
        "proxyAssetId": "VEIEX",
        "method": "asset-class-proxy",
        "rationale": (
            "VEIEX (Vanguard Emerging Markets Stock Index Fund) extends IEMG's "
            "history back to 1994-05-04; return series match exactly (correlation "
            "1.0000) over the overlapping period."
        ),
    },
    "PFF": {
        "proxyAssetId": "PREFX",
        "method": "asset-class-proxy",
        "rationale": (
            "PREFX extends PFF's history back to 2000-12-29; return series match "
            "exactly (correlation 1.0000) over the overlapping period, so PREFX's "
            "pre-2007 prices behaved like a preferred-securities fund regardless of "
            "what it is called today. Caveat: Yahoo currently reports PREFX's name "
            "as 'T. Rowe Price Tax-Efficient Equity', which does not describe a "
            "preferred-securities strategy -- mutual fund tickers are sometimes "
            "reused after a merger or strategy change, so today's name may not "
            "describe the 2000-2007 fund this correlation was measured against. "
            "The proxy relationship rests on the measured return correlation, not "
            "on the current name; PREFX's own assetClass/name in this catalogue "
            "should be treated as unverified pending manual research."
        ),
    },
    "SGOV": {
        "proxyAssetId": "BIL",
        "method": "asset-class-proxy",
        "rationale": (
            "BIL (SPDR Bloomberg 1-3 Month T-Bill ETF) extends SGOV's history back "
            "to 2000-07-03; return series match exactly (correlation 1.0000) over "
            "the overlapping period."
        ),
    },
    "VNQI": {
        "proxyAssetId": "CSRSX",
        "method": "asset-class-proxy",
        "rationale": (
            "CSRSX (Cohen & Steers Realty Shares) extends VNQI's history back to "
            "1991-07-01; return series match exactly (correlation 1.0000) over the "
            "overlapping period. Note this proxy is a US REIT fund standing in for "
            "an international-REIT ETF's pre-inception years -- an imperfect "
            "asset-class match flagged here for a future research pass."
        ),
    },
    "VNQ": {
        "proxyAssetId": "VGSIX",
        "method": "asset-class-proxy",
        "rationale": (
            "VGSIX (Vanguard REIT Index Fund) extends VNQ's history back to "
            "1996-05-13; return series match exactly (correlation 1.0000) over the "
            "overlapping period."
        ),
    },
}

# A small, transparent keyword classifier, not a researched taxonomy. Every
# fund's longName is checked against these phrases in order; the first match
# wins. This is a deliberately coarse, disclosed placeholder (see LOG.MD) --
# it is far cheaper and more honest than leaving assetClass blank, but a
# future pass should replace it with real per-fund research.
ASSET_CLASS_KEYWORDS = [
    ("crypto", ["bitcoin", "ethereum"]),
    ("commodity", ["gold", "silver", "commodity", "commodities", "gsci"]),
    ("real-estate", ["real estate", "reit", "realty"]),
    ("cash", ["t-bill", "treasury bill", "ultra short", "0-3 month"]),
    ("preferred-equity", ["preferred"]),
    (
        "bond",
        [
            "bond",
            "treasury",
            "aggregate",
            "high-yield",
            "high yield",
            "mortgage-backed",
            "mbs",
            "tips",
            "inflation-protected",
            "corporate",
        ],
    ),
    ("alternative", ["managed futures", "long/short", "merger", "multi-strategy", "hedge"]),
    ("equity", []),  # fallback: everything else is treated as an equity fund/stock
]

REGION_KEYWORDS = [
    ("emerging-markets", ["emerging markets"]),
    ("international", ["international", "developed markets", "ex-us", "ex us", "europe", "eafe"]),
    ("global", ["world", "global", "total world"]),
    ("us", []),  # fallback: this universe is overwhelmingly US-domestic in focus
]


def load_universe():
    metadata = pd.read_csv(ETF_METADATA_PATH)
    universe = metadata[
        (metadata["currency"] == "USD")
        & (~metadata["instrument_type"].isin(EXCLUDED_INSTRUMENT_TYPES))
    ].copy()
    return universe.sort_values("ticker").reset_index(drop=True)


def load_name_cache():
    if not os.path.exists(FUND_NAMES_CACHE_PATH):
        return {}
    with open(FUND_NAMES_CACHE_PATH, newline="") as handle:
        return {row["ticker"]: row["longName"] for row in csv.DictReader(handle)}


def save_name_cache(cache):
    with open(FUND_NAMES_CACHE_PATH, "w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["ticker", "longName"])
        for ticker, name in sorted(cache.items()):
            writer.writerow([ticker, name])


def fetch_long_name(ticker):
    # meta.longName/shortName come back on the same chart endpoint
    # fetch_etf_data.py already uses for prices, so this needs no new API.
    chart_json = fetch_chart_json(ticker)
    meta = chart_json["chart"]["result"][0]["meta"]
    return meta.get("longName") or meta.get("shortName") or ticker


def resolve_long_names(tickers):
    cache = load_name_cache()
    missing = [ticker for ticker in tickers if ticker not in cache]

    for ticker in missing:
        print(f"Looking up fund name for {ticker}...", file=sys.stderr)
        try:
            cache[ticker] = fetch_long_name(ticker)
        except Exception as error:
            # A missing name is a cosmetic gap, not a data-correctness failure --
            # fall back to the ticker itself rather than aborting the whole
            # catalogue build over one flaky lookup.
            print(f"  name lookup failed for {ticker}: {error}", file=sys.stderr)
            cache[ticker] = ticker
        time.sleep(0.4)

    if missing:
        save_name_cache(cache)

    return cache


def classify(keyword_table, text):
    lowered = text.lower()
    for label, keywords in keyword_table:
        if any(keyword in lowered for keyword in keywords):
            return label
    return keyword_table[-1][0]


def load_etf_universe_aum():
    aum_path = os.path.join(DATA_DIR, "etf_universe.csv")
    aum_table = pd.read_csv(aum_path)
    return dict(zip(aum_table["ticker"], aum_table["aum"]))


def build_asset_row(ticker, row, long_name, aum_by_ticker):
    proxy = PROXY_BACKFILLS.get(ticker)
    asset_class = classify(ASSET_CLASS_KEYWORDS, long_name)
    region = classify(REGION_KEYWORDS, long_name)

    return {
        "assetId": ticker,
        "ticker": ticker,
        "name": long_name,
        "assetClass": asset_class,
        "region": region,
        "sourceSymbol": ticker,
        "provider": "yahoo-finance-chart-api",
        "listingExchange": row["exchange"],
        "listingCurrency": row["currency"],
        "exposureCurrency": row["currency"],
        "returnCurrency": row["currency"],
        "fxTreatment": "unhedged",
        "isCurrencyHedged": False,
        "isin": "",
        "domicile": "",
        "category": "",
        "distributionPolicy": "",
        "replicationMethod": "",
        "inceptionDate": row["first_date"],
        "aum": aum_by_ticker.get(ticker, ""),
        "terAnnual": "",
        "terAsOf": "",
        "terSource": "",
        "proxyAssetId": proxy["proxyAssetId"] if proxy else "",
        "proxySpliceDate": row["first_date"] if proxy else "",
        "proxyMethod": proxy["method"] if proxy else "",
        "proxyRationale": proxy["rationale"] if proxy else "",
    }


ASSETS_CSV_COLUMNS = [
    "assetId",
    "ticker",
    "name",
    "assetClass",
    "region",
    "sourceSymbol",
    "provider",
    "listingExchange",
    "listingCurrency",
    "exposureCurrency",
    "returnCurrency",
    "fxTreatment",
    "isCurrencyHedged",
    "isin",
    "domicile",
    "category",
    "distributionPolicy",
    "replicationMethod",
    "inceptionDate",
    "aum",
    "terAnnual",
    "terAsOf",
    "terSource",
    "proxyAssetId",
    "proxySpliceDate",
    "proxyMethod",
    "proxyRationale",
]

FX_ROUTES_CSV_COLUMNS = [
    "quoteCurrency",
    "baseCurrency",
    "routeType",
    "quoteOrientation",
    "provider",
    "sourceSymbol",
    "retrievalDate",
    "transformation",
]


def main():
    universe = load_universe()
    long_names = resolve_long_names(universe["ticker"].tolist())
    aum_by_ticker = load_etf_universe_aum()

    rows = [
        build_asset_row(row["ticker"], row, long_names[row["ticker"]], aum_by_ticker)
        for _, row in universe.iterrows()
    ]

    os.makedirs(os.path.dirname(ASSETS_CSV_PATH), exist_ok=True)
    with open(ASSETS_CSV_PATH, "w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=ASSETS_CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} asset rows to {ASSETS_CSV_PATH}")

    # No row is written here for v1: every included asset is USD-quoted, so
    # quoteCurrency == baseCurrency == USD and the FX formula is the identity.
    # The header alone keeps the schema ready for the first asset that is not
    # USD-quoted (a future EUR release, or a newly added non-USD ticker).
    with open(FX_ROUTES_CSV_PATH, "w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(FX_ROUTES_CSV_COLUMNS)
    print(f"Wrote empty (header-only) {FX_ROUTES_CSV_PATH} -- v1 universe is USD-quoted only")


if __name__ == "__main__":
    main()
