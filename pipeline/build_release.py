"""Dataset artifact gate, step 2: build the USD weekly release artifacts.

Reads pipeline/metadata/assets.csv (the catalogue build_assets_catalogue.py
produced) plus the raw price/macro CSVs in data/, and writes the three
artifacts the browser will eventually load:

    public/data/returns-weekly-usd.f32   little-endian float32 return matrix
    public/data/manifest.json            schema/checksum/dimensions/offsets
    public/data/assets.json              the user-facing asset catalogue

Usage:
    python pipeline/build_release.py

This script only ever reads data/ and pipeline/metadata/, and only ever
writes public/data/ -- nothing under src/ is touched. The browser-side
loader that turns these files into an AlignedDataset is separate, future
work; this gate's job is producing one complete, checksummed, auditable
data contract for that loader to eventually read.
"""

import hashlib
import json
import os

import numpy as np
import pandas as pd

ASSETS_CSV_PATH = "pipeline/metadata/assets.csv"
DATA_DIR = "data"
OUTPUT_DIR = "public/data"
MATRIX_FILENAME = "returns-weekly-usd.f32"

# Every weekly series in this release is resampled onto the same Sunday-
# ending calendar week, so two series' weekly dates only ever line up if
# they truly fall in the same real-world week. Mixing week-ending
# conventions (e.g. Friday for one series, Sunday for another) would make
# every date comparison below silently wrong.
WEEK_ANCHOR = "W-SUN"

RISK_FREE_PRICE_PATH = os.path.join(DATA_DIR, "EFFR_CASH.csv")
CPI_PATH = os.path.join(DATA_DIR, "FRED_CPIAUCSL.csv")

SCHEMA_VERSION = "dataset-manifest-v1"
DATASET_VERSION = "usd-weekly-v1"


def load_price_series(csv_path, value_column="adj close"):
    frame = pd.read_csv(csv_path, parse_dates=["date"])
    frame = frame.set_index("date").sort_index()
    return frame[value_column]


def weekly_simple_returns(price_series):
    # "Last valid observation in each calendar week" (Dataset Format rule):
    # resample to one price per week, then a plain percentage change turns
    # consecutive week-ending prices into that week's simple total return.
    # No forward-filling happens here -- a week with zero source
    # observations resamples to NaN and pct_change correctly propagates NaN
    # rather than reusing a stale prior price.
    weekly_price = price_series.resample(WEEK_ANCHOR).last()
    return weekly_price.pct_change()


def load_asset_return_series(asset_row):
    # A proxied asset's backfilled + real history is already stitched into
    # one CSV (data/<assetId>_spliced.csv) by an earlier offline step; using
    # it here is exactly how the README's asset-class-proxy backfill is
    # meant to reach the return matrix -- one continuous series per asset,
    # with the proxy years disclosed in assets.json, not a second column.
    has_proxy = bool(asset_row["proxyAssetId"]) and not pd.isna(asset_row["proxyAssetId"])
    filename = f"{asset_row['assetId']}_spliced.csv" if has_proxy else f"{asset_row['assetId']}.csv"
    price_series = load_price_series(os.path.join(DATA_DIR, filename))
    return weekly_simple_returns(price_series)


def load_risk_free_weekly_returns():
    # EFFR_CASH is already a compounding index of the actual daily effective
    # fed funds rate (started at 1.0 and grown by (1 + EFFR/365) every day),
    # not a raw annualized percentage. Its own weekly pct_change is therefore
    # already the effective weekly risk-free *return* directly -- no
    # separate annualized-rate-to-periodic-rate conversion is needed, unlike
    # the raw FRED_EFFR.csv percentage series this release does not use.
    price_series = load_price_series(RISK_FREE_PRICE_PATH)
    return weekly_simple_returns(price_series)


def load_weekly_inflation_increments(weekly_dates):
    # Financial Rules: convert monthly CPI into weekly *log*-inflation
    # increments with one documented, deterministic rule. Here: compute each
    # month's log CPI growth once, then split it evenly across however many
    # rows of the already-built weekly date grid fall in that month. This
    # changes frequency (monthly -> weekly) without inventing any new
    # economic information -- summing a month's weekly increments back
    # together reproduces exactly that month's original log growth.
    cpi = load_price_series(CPI_PATH, value_column="CPIAUCSL")
    monthly_log_growth = np.log(cpi).diff()

    weekly_dates = pd.DatetimeIndex(weekly_dates)
    week_month = weekly_dates.to_period("M")
    weeks_per_month = week_month.value_counts()

    increments = pd.Series(np.nan, index=weekly_dates)
    for month, growth in monthly_log_growth.items():
        month_period = pd.Period(month, freq="M")
        if pd.isna(growth) or month_period not in weeks_per_month.index:
            continue
        share = growth / weeks_per_month[month_period]
        increments[week_month == month_period] = share

    return increments


def build_return_matrix(asset_returns, risk_free_returns):

    # The release ships every asset's own available history rather than the
    # intersection across all 98 assets -- the 260-week common-history
    # minimum is a *runtime* check the browser applies to whatever 1-6
    # assets a user actually picks (see validateAlignedDataset), not a
    # pipeline-side requirement to shrink the whole universe down to its
    # newest member's inception date.
    all_series = list(asset_returns.values()) + [risk_free_returns]
    weekly_dates = sorted(set().union(*(series.index for series in all_series)))
    weekly_dates = pd.DatetimeIndex(weekly_dates)

    inflation = load_weekly_inflation_increments(weekly_dates)

    asset_ids = sorted(asset_returns)  # deterministic column order
    columns = asset_ids + ["CPI_INFLATION", "RISK_FREE_RATE"]

    matrix = np.full((len(weekly_dates), len(columns)), np.nan, dtype=np.float32)
    for column_index, asset_id in enumerate(asset_ids):
        matrix[:, column_index] = asset_returns[asset_id].reindex(weekly_dates).to_numpy(dtype=np.float32)
    matrix[:, len(asset_ids)] = inflation.reindex(weekly_dates).to_numpy(dtype=np.float32)
    matrix[:, len(asset_ids) + 1] = risk_free_returns.reindex(weekly_dates).to_numpy(dtype=np.float32)

    return weekly_dates, columns, matrix


def write_matrix_file(matrix, output_path):
    # Column-major layout: every column is one contiguous run of rowCount
    # float32 values, matching the manifest's byteOffsets below. This is the
    # same "typed arrays for large simulation data" principle the app's
    # runtime already uses -- a future loader can wrap one column's bytes
    # directly in a Float32Array with no per-value parsing.
    with open(output_path, "wb") as handle:
        handle.write(np.asfortranarray(matrix).tobytes(order="F"))


def sha256_of_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_manifest(weekly_dates, columns, asset_ids, checksum, byte_length):
    row_count = len(weekly_dates)
    bytes_per_column = row_count * 4  # float32 = 4 bytes

    return {
        "schemaVersion": SCHEMA_VERSION,
        "datasetVersion": DATASET_VERSION,
        "checksum": f"sha256:{checksum}",
        "frequency": "weekly",
        "baseCurrency": "USD",
        "dtype": "float32",
        "byteOrder": "little-endian",
        "layout": "column-major",
        "rowCount": row_count,
        "dates": [date.strftime("%Y-%m-%d") for date in weekly_dates],
        "columns": columns,
        "assetColumns": asset_ids,
        "specialColumns": {"inflation": "CPI_INFLATION", "riskFreeRate": "RISK_FREE_RATE"},
        "byteOffsets": {
            column: column_index * bytes_per_column for column_index, column in enumerate(columns)
        },
        "byteLength": byte_length,
        "units": {
            "assetReturns": "simple periodic return, decimal fraction (0.01 = 1%)",
            "inflation": "weekly log-CPI increment (natural log), decimal fraction",
            "riskFreeRate": (
                "simple periodic return implied by the compounding EFFR cash index, "
                "decimal fraction"
            ),
        },
        "unavailableValue": "NaN",
        "provenance": {
            "priceSource": "Yahoo Finance chart API (adjusted close)",
            "inflationSource": "FRED CPIAUCSL (monthly, not seasonally adjusted -> weekly log increments)",
            "riskFreeSource": "EFFR_CASH (a compounding daily-EFFR total-return index)",
            "totalReturnInterpretation": (
                "adjusted-close values already include reinvested dividends/distributions "
                "where the source provides them; this release does not add a second "
                "dividend adjustment"
            ),
            "weekAnchor": WEEK_ANCHOR,
            "tradingCalendar": "source exchange calendar, implicit in each ticker's own trading days",
        },
    }


def none_if_blank(value):
    # pandas represents a blank CSV cell as float NaN, and NaN is truthy in
    # Python (`nan or None` returns nan, not None), so the natural-looking
    # `row["field"] or None` silently keeps NaN instead of falling back.
    # json.dump then writes the bare token `NaN`, which is not valid JSON --
    # a browser's `response.json()` throws on it. pd.isna() is the correct
    # check for "this cell was blank," independent of truthiness.
    if pd.isna(value):
        return None
    return value


def build_assets_json(assets, weekly_returns_by_asset, weekly_dates):
    records = []
    for _, row in assets.iterrows():
        returns = weekly_returns_by_asset[row["assetId"]].reindex(weekly_dates).dropna()
        proxy = None
        if row["proxyAssetId"] and not pd.isna(row["proxyAssetId"]):
            proxy = {
                "proxyAssetId": row["proxyAssetId"],
                "spliceDate": row["proxySpliceDate"],
                "method": row["proxyMethod"],
                "rationale": row["proxyRationale"],
            }

        records.append(
            {
                "assetId": row["assetId"],
                "ticker": row["ticker"],
                "name": row["name"],
                "assetClass": row["assetClass"],
                "region": row["region"],
                "sourceSymbol": row["sourceSymbol"],
                "provider": row["provider"],
                "listingExchange": row["listingExchange"],
                "listingCurrency": row["listingCurrency"],
                "exposureCurrency": row["exposureCurrency"],
                "returnCurrency": row["returnCurrency"],
                "fxTreatment": row["fxTreatment"],
                "isCurrencyHedged": bool(row["isCurrencyHedged"]),
                "isin": none_if_blank(row["isin"]),
                "domicile": none_if_blank(row["domicile"]),
                "region_detail": None,
                "category": none_if_blank(row["category"]),
                "distributionPolicy": none_if_blank(row["distributionPolicy"]),
                "replicationMethod": none_if_blank(row["replicationMethod"]),
                "inceptionDate": none_if_blank(row["inceptionDate"]),
                "aum": None if pd.isna(row["aum"]) or row["aum"] == "" else float(row["aum"]),
                "terAnnual": None,
                "terAsOf": None,
                "terSource": None,
                "proxy": proxy,
                "history": {
                    "firstDate": returns.index.min().strftime("%Y-%m-%d") if len(returns) else None,
                    "lastDate": returns.index.max().strftime("%Y-%m-%d") if len(returns) else None,
                    "rowCount": int(len(returns)),
                    "meetsWeeklyMinimum": bool(len(returns) >= 260),
                },
            }
        )

    return {
        "schemaVersion": "assets-catalogue-v1",
        "datasetVersion": DATASET_VERSION,
        "baseCurrency": "USD",
        "assets": records,
    }


def main():
    assets = pd.read_csv(ASSETS_CSV_PATH, keep_default_na=False, na_values=[""])
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    weekly_returns_by_asset = {
        row["assetId"]: load_asset_return_series(row) for _, row in assets.iterrows()
    }
    risk_free_returns = load_risk_free_weekly_returns()
    weekly_dates, columns, matrix = build_return_matrix(weekly_returns_by_asset, risk_free_returns)
    asset_ids = sorted(weekly_returns_by_asset)

    matrix_path = os.path.join(OUTPUT_DIR, MATRIX_FILENAME)
    write_matrix_file(matrix, matrix_path)
    checksum = sha256_of_file(matrix_path)
    byte_length = os.path.getsize(matrix_path)

    manifest = build_manifest(weekly_dates, columns, asset_ids, checksum, byte_length)
    with open(os.path.join(OUTPUT_DIR, "manifest.json"), "w") as handle:
        json.dump(manifest, handle, indent=2, allow_nan=False)

    assets_json = build_assets_json(assets, weekly_returns_by_asset, weekly_dates)
    with open(os.path.join(OUTPUT_DIR, "assets.json"), "w") as handle:
        json.dump(assets_json, handle, indent=2, allow_nan=False)

    print(f"Wrote {matrix_path} ({byte_length} bytes, {len(weekly_dates)} rows x {len(columns)} columns)")
    print(f"Checksum: sha256:{checksum}")
    print(f"Wrote {OUTPUT_DIR}/manifest.json and {OUTPUT_DIR}/assets.json")


if __name__ == "__main__":
    main()
