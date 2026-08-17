"""Offline helper: download adjusted-close price history from Yahoo
Finance's public chart API and add a new ticker's CSV to data/, or look up
an existing ticker's currency/exchange/history length without touching its
price file.

Usage:
    python pipeline/fetch_etf_data.py add VWCE.MI SGOV --as-of 2026-08-11
    python pipeline/fetch_etf_data.py lookup VTI CSSPX.MI --output-csv pipeline/etf_metadata.csv --as-of 2025-07-25

Talks to Yahoo Finance directly over urllib instead of the yfinance
package: the chart endpoint used here (query1.finance.yahoo.com/v8/finance/
chart) returns adjusted close plus currency/exchange metadata in one
request, and avoids yfinance's separate crumb/session flow, which was
observed to rate-limit far more aggressively than this endpoint alone.
"""

import argparse
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone

import pandas as pd

CHART_API_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
USER_AGENT = "Mozilla/5.0 (compatible; monte-carlo-engine-pipeline/1.0)"
REQUEST_TIMEOUT_SECONDS = 15
MAX_ATTEMPTS = 3
RETRY_BACKOFF_SECONDS = 3
# Epoch 0 safely predates every ETF's inception; Yahoo clamps it to each
# ticker's actual first trade date automatically.
EPOCH_START = 0

METADATA_COLUMNS = [
    "ticker",
    "currency",
    "exchange",
    "instrument_type",
    "first_date",
    "last_date",
    "row_count",
    "injection_date",
    "source",
]


def fetch_chart_json(ticker, period1=EPOCH_START, period2=None, interval="1d"):
    # Yahoo's `range=max` shorthand silently downgrades to monthly
    # granularity once the full span is "too long" for daily bars (observed
    # directly: range=max&interval=1d returned dataGranularity: '1mo' for
    # VTI's 25-year history, 303 rows instead of the true ~6,325 daily
    # rows). Passing explicit period1/period2 epoch bounds instead keeps
    # interval=1d honored across the whole span — the README's "never
    # silently clip invalid values into plausible results" rule applies
    # exactly as much to a silently-downgraded date grid as to a clipped
    # number.
    if period2 is None:
        period2 = int(time.time())

    encoded_ticker = urllib.parse.quote(ticker, safe="")
    url = (
        CHART_API_URL.format(ticker=encoded_ticker)
        + f"?period1={period1}&period2={period2}&interval={interval}"
    )
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})

    last_error = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            with urllib.request.urlopen(
                request, timeout=REQUEST_TIMEOUT_SECONDS
            ) as response:
                return json.load(response)
        except (urllib.error.URLError, TimeoutError) as error:
            last_error = error
            if attempt < MAX_ATTEMPTS:
                time.sleep(RETRY_BACKOFF_SECONDS * attempt)

    raise RuntimeError(
        f"Could not fetch '{ticker}' from Yahoo Finance after {MAX_ATTEMPTS} attempts: {last_error}"
    )


def extract_series(chart_json, ticker):
    results = chart_json.get("chart", {}).get("result")
    if not results:
        api_error = chart_json.get("chart", {}).get("error")
        raise RuntimeError(f"Yahoo Finance has no chart result for '{ticker}': {api_error}")

    result = results[0]
    meta = result["meta"]
    timestamps = result.get("timestamp", [])
    adjclose = result["indicators"]["adjclose"][0]["adjclose"]

    if not timestamps:
        raise RuntimeError(f"Yahoo Finance returned zero observations for '{ticker}'.")

    granularity = meta.get("dataGranularity")
    if granularity != "1d":
        raise RuntimeError(
            f"'{ticker}' came back at '{granularity}' granularity instead of daily — "
            "refusing to silently write a coarser series than requested."
        )

    # Timestamps are UTC seconds; shifting by the exchange's own gmtoffset
    # before taking the calendar date avoids off-by-one dates for tickers
    # whose local trading day does not align with UTC midnight.
    gmt_offset_seconds = meta.get("gmtoffset", 0)
    dates = [
        datetime.fromtimestamp(ts + gmt_offset_seconds, tz=timezone.utc).date().isoformat()
        for ts in timestamps
    ]

    return {
        "dates": dates,
        "adj_close": adjclose,
        "currency": meta.get("currency", "UNKNOWN"),
        "exchange": meta.get("fullExchangeName", "UNKNOWN"),
        "instrument_type": meta.get("instrumentType", "UNKNOWN"),
    }


def drop_unpriced_rows(dates, adj_close):
    paired = [(d, p) for d, p in zip(dates, adj_close) if p is not None]
    if not paired:
        return [], []
    kept_dates, kept_prices = zip(*paired)
    return list(kept_dates), list(kept_prices)


def write_price_csv(ticker, dates, adj_close, output_dir, overwrite):
    output_path = os.path.join(output_dir, f"{ticker}.csv")
    if os.path.exists(output_path) and not overwrite:
        raise FileExistsError(
            f"{output_path} already exists. Pass --overwrite to replace curated data."
        )

    frame = pd.DataFrame({"date": dates, "adj close": adj_close})
    frame.to_csv(output_path, index=False)
    return output_path


def append_metadata_rows(metadata_path, rows):
    parent = os.path.dirname(metadata_path)
    if parent:
        os.makedirs(parent, exist_ok=True)

    file_exists = os.path.exists(metadata_path)
    with open(metadata_path, "a", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=METADATA_COLUMNS)
        if not file_exists:
            writer.writeheader()
        writer.writerows(rows)


def read_ticker_list(path):
    with open(path, newline="") as handle:
        first_line = handle.readline()
        handle.seek(0)
        if "ticker" in first_line.lower():
            reader = csv.DictReader(handle)
            return [row["ticker"].strip() for row in reader if row.get("ticker", "").strip()]
        return [line.strip() for line in handle if line.strip()]


def cmd_add(args):
    as_of = args.as_of or date.today().isoformat()
    rows = []

    for ticker in args.tickers:
        print(f"Fetching {ticker}...", file=sys.stderr)
        chart_json = fetch_chart_json(ticker)
        series = extract_series(chart_json, ticker)
        dates, prices = drop_unpriced_rows(series["dates"], series["adj_close"])
        if not dates:
            raise RuntimeError(f"'{ticker}' had no priced observations after filtering.")

        output_path = write_price_csv(ticker, dates, prices, args.output_dir, args.overwrite)
        print(
            f"  wrote {output_path} ({len(dates)} rows, {dates[0]} to {dates[-1]}, "
            f"currency={series['currency']})",
            file=sys.stderr,
        )

        rows.append(
            {
                "ticker": ticker,
                "currency": series["currency"],
                "exchange": series["exchange"],
                "instrument_type": series["instrument_type"],
                "first_date": dates[0],
                "last_date": dates[-1],
                "row_count": len(dates),
                "injection_date": as_of,
                "source": "yahoo-finance-chart-api",
            }
        )

    append_metadata_rows(args.metadata_path, rows)
    print(f"Recorded metadata for {len(rows)} ticker(s) in {args.metadata_path}", file=sys.stderr)


def cmd_lookup(args):
    tickers = list(args.tickers)
    if args.tickers_file:
        tickers.extend(read_ticker_list(args.tickers_file))
    if not tickers:
        raise SystemExit("Provide at least one ticker or --tickers-file.")

    if args.output_csv and not args.as_of:
        raise SystemExit(
            "--output-csv requires --as-of (the date this ticker's data was actually "
            "added to data/), so injection dates in the report stay honest instead of "
            "defaulting to today for data that is not new."
        )

    rows = []
    for ticker in tickers:
        try:
            chart_json = fetch_chart_json(ticker)
            series = extract_series(chart_json, ticker)
            dates, _ = drop_unpriced_rows(series["dates"], series["adj_close"])
            row = {
                "ticker": ticker,
                "currency": series["currency"],
                "exchange": series["exchange"],
                "instrument_type": series["instrument_type"],
                "first_date": dates[0] if dates else "",
                "last_date": dates[-1] if dates else "",
                "row_count": len(dates),
                "injection_date": args.as_of or "",
                "source": "yahoo-finance-chart-api",
            }
            print(
                f"{ticker}: currency={row['currency']} exchange={row['exchange']} "
                f"type={row['instrument_type']} rows={row['row_count']} "
                f"({row['first_date']}..{row['last_date']})"
            )
        except Exception as error:
            print(f"{ticker}: LOOKUP FAILED - {error}", file=sys.stderr)
            if not args.continue_on_error:
                raise
            row = {
                "ticker": ticker,
                "currency": "unresolved",
                "exchange": "unresolved",
                "instrument_type": "unresolved",
                "first_date": "",
                "last_date": "",
                "row_count": 0,
                "injection_date": args.as_of or "",
                "source": "yahoo-finance-chart-api",
            }

        rows.append(row)
        time.sleep(args.request_delay)

    if args.output_csv:
        append_metadata_rows(args.output_csv, rows)
        print(f"Wrote {len(rows)} row(s) to {args.output_csv}", file=sys.stderr)


def build_arg_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    add_parser = subparsers.add_parser(
        "add", help="Download full price history for new tickers and record their metadata."
    )
    add_parser.add_argument("tickers", nargs="+", help="Ticker symbols, e.g. VTI SGOV CSSPX.MI")
    add_parser.add_argument("--output-dir", default="data", help="Directory for <TICKER>.csv")
    add_parser.add_argument(
        "--metadata-path", default="pipeline/etf_metadata.csv", help="Metadata CSV to append to"
    )
    add_parser.add_argument(
        "--overwrite", action="store_true", help="Allow replacing an existing data/<TICKER>.csv"
    )
    add_parser.add_argument(
        "--as-of", default=None, help="Injection date to record (default: today, ISO format)"
    )
    add_parser.set_defaults(func=cmd_add)

    lookup_parser = subparsers.add_parser(
        "lookup",
        help="Look up currency/exchange/history length without writing any price data.",
    )
    lookup_parser.add_argument("tickers", nargs="*", default=[], help="Ticker symbols to check")
    lookup_parser.add_argument(
        "--tickers-file", default=None, help="CSV (with a ticker column) or newline list to add"
    )
    lookup_parser.add_argument(
        "--output-csv", default=None, help="Also append the results to this metadata CSV"
    )
    lookup_parser.add_argument(
        "--as-of", default=None, help="Injection date to record together with --output-csv"
    )
    lookup_parser.add_argument(
        "--continue-on-error",
        action="store_true",
        help="Keep checking remaining tickers if one fails to resolve",
    )
    lookup_parser.add_argument(
        "--request-delay", type=float, default=0.4, help="Seconds between requests (default: 0.4)"
    )
    lookup_parser.set_defaults(func=cmd_lookup)

    return parser


def main():
    parser = build_arg_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
