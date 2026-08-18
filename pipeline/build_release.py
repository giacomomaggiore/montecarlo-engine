"""Build one versioned USD dataset release.

Reads pipeline/metadata/assets.csv (the catalogue build_assets_catalogue.py
produced) plus the raw price/macro CSVs in data/, and writes the three
artifacts the browser will eventually load:

    public/data/releases/<frequency>-usd/returns-<frequency>-usd.f32
    public/data/releases/<frequency>-usd/manifest.json
    public/data/releases/<frequency>-usd/assets.json

Usage:
    python pipeline/build_release.py --frequency weekly
    python pipeline/build_release.py --frequency monthly

This script only ever reads data/ and pipeline/metadata/, and only ever
writes public/data/ -- nothing under src/ is touched. The browser-side
loader that turns these files into an AlignedDataset is separate, future
work; this gate's job is producing one complete, checksummed, auditable
data contract for that loader to eventually read.
"""

import argparse
import hashlib
import json
import os

import numpy as np
import pandas as pd

ASSETS_CSV_PATH = "pipeline/metadata/assets.csv"
DATA_DIR = "data"
RISK_FREE_PRICE_PATH = os.path.join(DATA_DIR, "EFFR_CASH.csv")
CPI_PATH = os.path.join(DATA_DIR, "FRED_CPIAUCSL.csv")

SCHEMA_VERSION = "dataset-manifest-v1"
BASE_CURRENCY = "USD"


def load_price_series(csv_path, value_column="adj close"):
    frame = pd.read_csv(csv_path, parse_dates=["date"])
    frame = frame.set_index("date").sort_index()
    return frame[value_column]


def release_settings(frequency):
    if frequency == "weekly":
        return {
            "anchor": "W-SUN",
            "dataset_version": "usd-weekly-v1",
            "output_dir": "public/data/releases/weekly-usd",
            "matrix_filename": "returns-weekly-usd.f32",
            "inflation_unit": "weekly log-CPI increment (natural log), decimal fraction",
            "risk_free_unit": "simple weekly return implied by the compounding EFFR cash index, decimal fraction",
        }
    return {
        "anchor": "ME",
        "dataset_version": "usd-monthly-v1",
        "output_dir": "public/data/releases/monthly-usd",
        "matrix_filename": "returns-monthly-usd.f32",
        "inflation_unit": "monthly log-CPI increment (natural log), decimal fraction",
        "risk_free_unit": "simple monthly return implied by the compounding EFFR cash index, decimal fraction",
    }


def periodic_simple_returns(price_series, anchor):
    # Financial intuition: the last observed adjusted close in a calendar
    # period defines its total-return level; the percentage change preserves
    # the period's investable simple return without carrying stale prices.
    # Time Complexity: O(T). Space Complexity: O(T).
    periodic_price = price_series.resample(anchor).last()
    return periodic_price.pct_change(fill_method=None)


def load_asset_return_series(asset_row, anchor):
    # A proxied asset's backfilled + real history is already stitched into
    # one CSV (data/<assetId>_spliced.csv) by an earlier offline step; using
    # it here is exactly how the README's asset-class-proxy backfill is
    # meant to reach the return matrix -- one continuous series per asset,
    # with the proxy years disclosed in assets.json, not a second column.
    has_proxy = bool(asset_row["proxyAssetId"]) and not pd.isna(asset_row["proxyAssetId"])
    filename = f"{asset_row['assetId']}_spliced.csv" if has_proxy else f"{asset_row['assetId']}.csv"
    price_series = load_price_series(os.path.join(DATA_DIR, filename))
    return periodic_simple_returns(price_series, anchor)


def load_risk_free_returns(anchor):
    # EFFR_CASH is already a compounding index of the actual daily effective
    # fed funds rate (started at 1.0 and grown by (1 + EFFR/365) every day),
    # not a raw annualized percentage. Its own weekly pct_change is therefore
    # already the effective weekly risk-free *return* directly -- no
    # separate annualized-rate-to-periodic-rate conversion is needed, unlike
    # the raw FRED_EFFR.csv percentage series this release does not use.
    price_series = load_price_series(RISK_FREE_PRICE_PATH)
    return periodic_simple_returns(price_series, anchor)


def load_inflation_increments(period_dates, frequency):
    # Financial Rules: convert monthly CPI into weekly *log*-inflation
    # increments with one documented, deterministic rule. Here: compute each
    # month's log CPI growth once, then split it evenly across however many
    # rows of the already-built weekly date grid fall in that month. This
    # changes frequency (monthly -> weekly) without inventing any new
    # economic information -- summing a month's weekly increments back
    # together reproduces exactly that month's original log growth.
    cpi = load_price_series(CPI_PATH, value_column="CPIAUCSL")
    monthly_log_growth = np.log(cpi).diff()

    period_dates = pd.DatetimeIndex(period_dates)
    if frequency == "monthly":
        return monthly_log_growth.reindex(period_dates)

    period_month = period_dates.to_period("M")
    periods_per_month = period_month.value_counts()
    increments = pd.Series(np.nan, index=period_dates)
    for month, growth in monthly_log_growth.items():
        month_period = pd.Period(month, freq="M")
        if pd.isna(growth) or month_period not in periods_per_month.index:
            continue
        share = growth / periods_per_month[month_period]
        increments[period_month == month_period] = share

    return increments


def build_return_matrix(asset_returns, risk_free_returns, frequency):

    # The release ships every asset's own available history rather than the
    # intersection across all 98 assets -- the 260-week common-history
    # minimum is a *runtime* check the browser applies to whatever 1-6
    # assets a user actually picks (see validateAlignedDataset), not a
    # pipeline-side requirement to shrink the whole universe down to its
    # newest member's inception date.
    all_series = list(asset_returns.values()) + [risk_free_returns]
    period_dates = sorted(set().union(*(series.index for series in all_series)))
    period_dates = pd.DatetimeIndex(period_dates)

    inflation = load_inflation_increments(period_dates, frequency)

    asset_ids = sorted(asset_returns)  # deterministic column order
    columns = asset_ids + ["CPI_INFLATION", "RISK_FREE_RATE"]

    matrix = np.full((len(period_dates), len(columns)), np.nan, dtype=np.float32)
    for column_index, asset_id in enumerate(asset_ids):
        matrix[:, column_index] = asset_returns[asset_id].reindex(period_dates).to_numpy(dtype=np.float32)
    matrix[:, len(asset_ids)] = inflation.reindex(period_dates).to_numpy(dtype=np.float32)
    matrix[:, len(asset_ids) + 1] = risk_free_returns.reindex(period_dates).to_numpy(dtype=np.float32)

    return period_dates, columns, matrix


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


def build_manifest(period_dates, columns, asset_ids, checksum, byte_length, frequency, settings):
    row_count = len(period_dates)
    bytes_per_column = row_count * 4  # float32 = 4 bytes

    return {
        "schemaVersion": SCHEMA_VERSION,
        "datasetVersion": settings["dataset_version"],
        "checksum": f"sha256:{checksum}",
        "frequency": frequency,
        "baseCurrency": BASE_CURRENCY,
        "matrixFileName": settings["matrix_filename"],
        "dtype": "float32",
        "byteOrder": "little-endian",
        "layout": "column-major",
        "rowCount": row_count,
        "dates": [date.strftime("%Y-%m-%d") for date in period_dates],
        "columns": columns,
        "assetColumns": asset_ids,
        "specialColumns": {"inflation": "CPI_INFLATION", "riskFreeRate": "RISK_FREE_RATE"},
        "byteOffsets": {
            column: column_index * bytes_per_column for column_index, column in enumerate(columns)
        },
        "byteLength": byte_length,
        "units": {
            "assetReturns": "simple periodic return, decimal fraction (0.01 = 1%)",
            "inflation": settings["inflation_unit"],
            "riskFreeRate": settings["risk_free_unit"],
        },
        "unavailableValue": "NaN",
        "provenance": {
            "priceSource": "Yahoo Finance chart API (adjusted close)",
            "inflationSource": (
                "FRED CPIAUCSL (monthly, not seasonally adjusted -> monthly log growth)"
                if frequency == "monthly"
                else "FRED CPIAUCSL (monthly, not seasonally adjusted -> weekly log increments)"
            ),
            "riskFreeSource": "EFFR_CASH (a compounding daily-EFFR total-return index)",
            "totalReturnInterpretation": (
                "adjusted-close values already include reinvested dividends/distributions "
                "where the source provides them; this release does not add a second "
                "dividend adjustment"
            ),
            "periodAnchor": settings["anchor"],
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


def build_assets_json(assets, returns_by_asset, period_dates, frequency, dataset_version):
    records = []
    for _, row in assets.iterrows():
        returns = returns_by_asset[row["assetId"]].reindex(period_dates).dropna()
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
                    "meetsWeeklyMinimum": bool(len(returns) >= (260 if frequency == "weekly" else 60)),
                },
            }
        )

    return {
        "schemaVersion": "assets-catalogue-v1",
        "datasetVersion": dataset_version,
        "baseCurrency": BASE_CURRENCY,
        "assets": records,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--frequency", choices=["weekly", "monthly"], required=True)
    arguments = parser.parse_args()
    frequency = arguments.frequency
    settings = release_settings(frequency)
    assets = pd.read_csv(ASSETS_CSV_PATH, keep_default_na=False, na_values=[""])
    os.makedirs(settings["output_dir"], exist_ok=True)

    returns_by_asset = {
        row["assetId"]: load_asset_return_series(row, settings["anchor"])
        for _, row in assets.iterrows()
    }
    risk_free_returns = load_risk_free_returns(settings["anchor"])
    period_dates, columns, matrix = build_return_matrix(returns_by_asset, risk_free_returns, frequency)
    asset_ids = sorted(returns_by_asset)

    matrix_path = os.path.join(settings["output_dir"], settings["matrix_filename"])
    write_matrix_file(matrix, matrix_path)
    checksum = sha256_of_file(matrix_path)
    byte_length = os.path.getsize(matrix_path)

    manifest = build_manifest(period_dates, columns, asset_ids, checksum, byte_length, frequency, settings)
    with open(os.path.join(settings["output_dir"], "manifest.json"), "w") as handle:
        json.dump(manifest, handle, indent=2, allow_nan=False)

    assets_json = build_assets_json(assets, returns_by_asset, period_dates, frequency, settings["dataset_version"])
    with open(os.path.join(settings["output_dir"], "assets.json"), "w") as handle:
        json.dump(assets_json, handle, indent=2, allow_nan=False)

    print(f"Wrote {matrix_path} ({byte_length} bytes, {len(period_dates)} rows x {len(columns)} columns)")
    print(f"Checksum: sha256:{checksum}")
    print(f"Wrote {settings['output_dir']}/manifest.json and {settings['output_dir']}/assets.json")


if __name__ == "__main__":
    main()
