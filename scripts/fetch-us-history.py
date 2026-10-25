"""Refresh the frozen research dataset. Requires internet; never run during tests.

FRED redistributes BEA, BLS, and Federal Reserve series. These are revised series,
not real-time vintages. Keeping raw CSV bytes and hashes makes a run reproducible.
"""
import concurrent.futures
import datetime
import hashlib
import json
import csv
import io
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1] / "data/history/us-1960-1985"
SERIES = {
    "GDPC1": ("BEA", "quarterly", "billions of chained 2017 dollars, SA annual rate"),
    "CPIAUCSL": ("BLS", "monthly", "index 1982-1984=100, seasonally adjusted"),
    "UNRATE": ("BLS", "monthly", "percent of civilian labor force, seasonally adjusted"),
    "FEDFUNDS": ("Federal Reserve", "monthly", "percent per year, effective federal funds rate"),
    "CLF16OV": ("BLS", "monthly", "thousands, civilian labor force age 16+, seasonally adjusted"),
    "WPU0561": ("BLS", "monthly", "index 1982=100, domestic crude petroleum PPI, not seasonally adjusted"),
}


def fetch(item):
    name, (producer, frequency, units) = item
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={name}&cosd=1959-01-01&coed=1985-12-31"
    request = urllib.request.Request(url, headers={"User-Agent": "Uchrony historical model evaluation"})
    with urllib.request.urlopen(request, timeout=90) as response:
        data = response.read()
    if not data.startswith(b"observation_date,") or len(data.splitlines()) < 100:
        raise ValueError(f"Unexpected response for {name}")
    rows = list(csv.DictReader(io.StringIO(data.decode("utf-8"))))
    expected = 108 if frequency == "quarterly" else 324
    if len(rows) != expected or any(not row[name] or row[name] == "." for row in rows):
        raise ValueError(f"Missing or unexpected observations for {name}")
    return data, {"id": name, "producer": producer, "frequency": frequency, "units": units,
            "url": url, "source": f"https://fred.stlouisfed.org/series/{name}",
            "sha256": hashlib.sha256(data).hexdigest(), "observations": len(data.splitlines()) - 1}


if __name__ == "__main__":
    ROOT.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        downloads = list(executor.map(fetch, SERIES.items()))
    # Fetch every series successfully before replacing any frozen input.
    series = [metadata for _, metadata in downloads]
    manifest = {"retrievedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "vintage": "Latest revised observations at retrieval; not a real-time information set.",
                "calibration": ["1960-01-01", "1969-12-31"],
                "evaluation": ["1970-01-01", "1985-12-31"], "series": series}
    for data, metadata in downloads:
        (ROOT / f"{metadata['id']}.csv").write_bytes(data)
    (ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))
