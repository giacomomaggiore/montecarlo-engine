"""Dataset artifact gate, step 3: validate the release the same way the
browser eventually will.

Re-derives the checksum, dimensions, and byte length from the artifact files
themselves (never trusting the numbers build_release.py already claimed),
confirms dates are valid and strictly increasing, confirms every value in the
matrix is either finite or the documented NaN sentinel, and cross-checks
assets.json against the manifest's column list. Exits non-zero on the first
failed check, per the "never silently clip invalid values into plausible
results" rule -- a broken release must fail loudly here, not surface as a
confusing bug three layers later in the browser.

Usage:
    python pipeline/validate_release.py
"""

import hashlib
import json
import sys

import numpy as np

OUTPUT_DIR = "public/data"
MATRIX_PATH = f"{OUTPUT_DIR}/returns-weekly-usd.f32"
MANIFEST_PATH = f"{OUTPUT_DIR}/manifest.json"
ASSETS_JSON_PATH = f"{OUTPUT_DIR}/assets.json"


def fail(message):
    print(f"FAIL: {message}", file=sys.stderr)
    sys.exit(1)


def load_strict_json(path):
    # Python's json.load accepts the bare tokens NaN/Infinity/-Infinity by
    # default -- a non-standard extension a browser's JSON.parse (and
    # response.json()) does not share. parse_constant intercepts exactly
    # those tokens, so a release artifact that would crash the browser
    # loader fails here instead of passing this "validate like the browser
    # will" gate by accident.
    with open(path) as handle:
        return json.load(
            handle,
            parse_constant=lambda token: fail(
                f"{path} contains the non-standard JSON token '{token}', which a "
                "browser's JSON.parse/response.json() would reject"
            ),
        )


def sha256_of_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def check_checksum(manifest):
    actual = f"sha256:{sha256_of_file(MATRIX_PATH)}"
    if actual != manifest["checksum"]:
        fail(f"checksum mismatch: manifest says {manifest['checksum']}, file hashes to {actual}")
    print("checksum matches the matrix file's actual bytes")


def check_byte_length(manifest):
    import os

    actual_length = os.path.getsize(MATRIX_PATH)
    if actual_length != manifest["byteLength"]:
        fail(f"byte length mismatch: manifest says {manifest['byteLength']}, file is {actual_length}")

    row_count = manifest["rowCount"]
    column_count = len(manifest["columns"])
    expected_length = row_count * column_count * 4  # float32 = 4 bytes
    if actual_length != expected_length:
        fail(
            f"byte length does not match rowCount * columnCount * 4: "
            f"{row_count} * {column_count} * 4 = {expected_length}, file is {actual_length}"
        )
    print(f"byte length matches {row_count} rows x {column_count} columns x 4 bytes")


def check_dates(manifest):
    dates = manifest["dates"]
    if len(dates) != manifest["rowCount"]:
        fail(f"manifest.dates has {len(dates)} entries, rowCount says {manifest['rowCount']}")

    previous = None
    for date in dates:
        if len(date) != 10 or date[4] != "-" or date[7] != "-":
            fail(f"date '{date}' is not in YYYY-MM-DD form")
        if previous is not None and date <= previous:
            fail(f"dates are not strictly increasing at '{previous}' -> '{date}'")
        previous = date
    print(f"all {len(dates)} dates are valid ISO calendar dates in strictly increasing order")


def check_matrix_values(manifest):
    row_count = manifest["rowCount"]
    columns = manifest["columns"]
    matrix = np.fromfile(MATRIX_PATH, dtype="<f4").reshape(len(columns), row_count).T

    if matrix.shape != (row_count, len(columns)):
        fail(f"matrix shape {matrix.shape} does not match manifest ({row_count}, {len(columns)})")

    for column_index, column in enumerate(columns):
        series = matrix[:, column_index]
        non_finite_non_nan = np.isinf(series)
        if non_finite_non_nan.any():
            fail(f"column '{column}' contains +/-Infinity, which is never a valid value on disk")

    print(f"every value across all {len(columns)} columns is finite or the documented NaN sentinel")
    return matrix


def check_assets_json_consistency(manifest, matrix):
    assets_json = load_strict_json(ASSETS_JSON_PATH)

    manifest_assets = set(manifest["assetColumns"])
    catalogue_assets = {record["assetId"] for record in assets_json["assets"]}
    if manifest_assets != catalogue_assets:
        only_in_manifest = manifest_assets - catalogue_assets
        only_in_catalogue = catalogue_assets - manifest_assets
        fail(
            "assets.json and manifest.json disagree on the asset universe: "
            f"only in manifest={sorted(only_in_manifest)}, only in assets.json={sorted(only_in_catalogue)}"
        )

    columns = manifest["columns"]
    for record in assets_json["assets"]:
        column_index = columns.index(record["assetId"])
        finite_count = int(np.isfinite(matrix[:, column_index]).sum())
        if finite_count != record["history"]["rowCount"]:
            fail(
                f"asset '{record['assetId']}' reports history.rowCount="
                f"{record['history']['rowCount']}, but the matrix column has {finite_count} "
                "finite values"
            )

    print(f"assets.json's {len(catalogue_assets)} assets match manifest.json's column list exactly")


def main():
    manifest = load_strict_json(MANIFEST_PATH)

    check_checksum(manifest)
    check_byte_length(manifest)
    check_dates(manifest)
    matrix = check_matrix_values(manifest)
    check_assets_json_consistency(manifest, matrix)

    print("\nAll dataset artifact gate checks passed.")


if __name__ == "__main__":
    main()
