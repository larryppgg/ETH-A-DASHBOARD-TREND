#!/usr/bin/env python3
import json
import math
import os
import time
import subprocess
import urllib.request
from urllib.parse import urlparse
from urllib.error import HTTPError, URLError
from datetime import datetime, timezone, timedelta
import re

FRED_KEY = "a2c8da09c18aaaa2e9f30289114b5573"
ENV_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".env"))
DEFAULT_DOH = ""
DOH_RESOLVERS = [
    ("dns.google", "8.8.8.8"),
    ("cloudflare-dns.com", "1.1.1.1"),
]
DNS_CACHE = {}

REQUIRED_FIELDS = [
    "dxy5d",
    "dxy3dUp",
    "us2yWeekBp",
    "fciUpWeeks",
    "etf10d",
    "etf5d",
    "etf1d",
    "prevEtfExtremeOutflow",
    "stablecoin30d",
    "exchStableDelta",
    "policyWindow",
    "preMeeting2y",
    "current2y",
    "preMeetingDxy",
    "currentDxy",
    "crowdingIndex",
    "liquidationUsd",
    "longWicks",
    "reverseFishing",
    "shortFailure",
    "exchBalanceTrend",
    "floatDensity",
    "mcapElasticity",
    "mcapGrowth",
    "volumeConfirm",
    "rsdScore",
    "lstcScore",
    "mappingRatioDown",
    "netIssuanceHigh",
    "cognitivePotential",
    "liquidityPotential",
    "onchainReflexivity",
    "sentimentThreshold",
    "topo",
    "spectral",
    "roughPath",
    "deltaES",
    "trendMomentum",
    "divergence",
    "distributionGateCount",
    "rrpChange",
    "tgaChange",
    "srfChange",
    "ism",
]

# Half-life governance (days). Stale threshold uses 2x half-life (aligns with frontend policy).
HALF_LIFE_DAYS = {
    "dxy5d": 3,
    "dxy3dUp": 3,
    "us2yWeekBp": 3,
    "fciUpWeeks": 14,
    "etf1d": 2,
    "etf5d": 4,
    "etf10d": 7,
    "stablecoin30d": 10,
    "exchStableDelta": 5,
    "exchBalanceTrend": 7,
    "liquidationUsd": 2,
    "crowdingIndex": 4,
    "longWicks": 4,
    "reverseFishing": 4,
    "shortFailure": 4,
    "mcapGrowth": 4,
    "mcapElasticity": 5,
    "floatDensity": 30,
    "rsdScore": 20,
    "mappingRatioDown": 20,
    "lstcScore": 14,
    "netIssuanceHigh": 14,
    "trendMomentum": 3,
    "divergence": 3,
    "topo": 5,
    "spectral": 5,
    "roughPath": 5,
    "deltaES": 3,
    "rrpChange": 5,
    "tgaChange": 5,
    "srfChange": 7,
    "ism": 45,
    "distributionGateCount": 30,
    "ethSpotPrice": 2,
    "cexTvl": 7,
}

AUTO_JSON_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "src", "data", "auto.json")
)

PROXY_CANDIDATES = ["direct"]


def load_env(path):
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip()
            if key and key not in os.environ:
                os.environ[key] = value


load_env(ENV_PATH)


def load_proxy_candidates():
    candidates = []
    for key in ("PROXY_PRIMARY", "PROXY_FALLBACK"):
        value = (os.environ.get(key) or "").strip()
        if value and value not in candidates:
            candidates.append(value)
    for key in ("HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY"):
        value = (os.environ.get(key) or "").strip()
        if value and value not in candidates:
            candidates.append(value)
    if "direct" not in candidates:
        candidates.append("direct")
    return candidates


PROXY_CANDIDATES = load_proxy_candidates()


def build_request(url):
    req = urllib.request.Request(url)
    req.add_header("User-Agent", "Mozilla/5.0 (compatible; ETH-A-Dashboard/1.0)")
    return req


def open_url(req, timeout=20):
    last_exc = None
    for proxy in PROXY_CANDIDATES:
        try:
            if proxy.lower() == "direct":
                return urllib.request.urlopen(req, timeout=timeout)
            if not (proxy.startswith("http://") or proxy.startswith("https://")):
                raise RuntimeError(f"Unsupported proxy scheme: {proxy}")
            handler = urllib.request.ProxyHandler({"http": proxy, "https": proxy})
            opener = urllib.request.build_opener(handler)
            return opener.open(req, timeout=timeout)
        except Exception as exc:
            last_exc = exc
            continue
    raise last_exc


def probe_proxy(url="https://api.coingecko.com/api/v3/ping"):
    trace = []
    for proxy in PROXY_CANDIDATES:
        try:
            text, error = curl_probe(url, proxy, timeout=6)
            if text:
                trace.append({"proxy": proxy, "ok": True, "status": 200})
            else:
                trace.append({"proxy": proxy, "ok": False, "error": error or "curl failed"})
        except Exception as exc:
            trace.append({"proxy": proxy, "ok": False, "error": str(exc)})
    return trace


def fetch_json(url):
    for proxy in PROXY_CANDIDATES:
        text = curl_fetch(url, proxy)
        if text:
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                continue
    return {}


def fetch_text(url):
    for proxy in PROXY_CANDIDATES:
        text = curl_fetch(url, proxy)
        if text:
            return text
    return ""


def curl_fetch(url, proxy=None, timeout=6):
    cmd = ["curl", "-sSL", "--connect-timeout", str(timeout), "--max-time", str(timeout)]
    parsed = urlparse(url)
    host = parsed.hostname
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    if host:
        ip = resolve_host(host)
        if ip:
            cmd += ["--resolve", f"{host}:{port}:{ip}"]
    if proxy and proxy.lower() != "direct":
        cmd += ["--proxy", proxy]
    cmd.append(url)
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 5)
    except Exception:
        return ""
    if result.returncode != 0:
        return ""
    return result.stdout.strip()


def resolve_host(host):
    if host in DNS_CACHE:
        return DNS_CACHE[host]
    for resolver_host, resolver_ip in DOH_RESOLVERS:
        url = f"https://{resolver_host}/resolve?name={host}&type=A"
        cmd = [
            "curl",
            "-sS",
            "--connect-timeout",
            "5",
            "--max-time",
            "5",
            "--resolve",
            f"{resolver_host}:443:{resolver_ip}",
            url,
        ]
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=8)
        except Exception:
            continue
        if result.returncode != 0 or not result.stdout:
            continue
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError:
            continue
        answers = payload.get("Answer") or []
        for answer in answers:
            if answer.get("type") == 1 and answer.get("data"):
                DNS_CACHE[host] = answer["data"]
                return DNS_CACHE[host]
    DNS_CACHE[host] = None
    return None


def parse_date_like(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str) and re.match(r"^\d{4}-\d{2}-\d{2}$", value):
        try:
            return datetime.fromisoformat(value + "T23:59:59+00:00")
        except Exception:
            return None
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except Exception:
            return None
    try:
        return datetime.fromtimestamp(float(value), tz=timezone.utc)
    except Exception:
        return None


def resolve_half_life_days(key):
    return HALF_LIFE_DAYS.get(key, 7)


def is_stale(observed_at, as_of, key):
    observed = parse_date_like(observed_at)
    as_of_dt = parse_date_like(as_of) or datetime.now(timezone.utc)
    if not observed:
        return False
    age_days = max(0.0, (as_of_dt - observed).total_seconds() / 86400.0)
    return age_days > resolve_half_life_days(key) * 2


def load_previous_snapshot(path=AUTO_JSON_PATH):
    try:
        if not path or not os.path.exists(path):
            return None
        with open(path, "r", encoding="utf-8") as fp:
            return json.load(fp)
    except Exception:
        return None


def backfill_from_previous(payload, previous, as_of_date=None):
    if not payload or not previous:
        return []
    data = payload.get("data") or {}
    sources = payload.get("sources") or {}
    field_obs = payload.get("fieldObservedAt") or {}
    field_fetch = payload.get("fieldFetchedAt") or {}
    field_upd = payload.get("fieldUpdatedAt") or {}
    missing = list(payload.get("missing") or [])

    prev_data = previous.get("data") or {}
    prev_sources = previous.get("sources") or {}
    prev_obs = previous.get("fieldObservedAt") or {}
    prev_upd = previous.get("fieldUpdatedAt") or {}

    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    as_of = as_of_date or payload.get("targetDate") or payload.get("generatedAt") or now_iso
    keys = list(dict.fromkeys(REQUIRED_FIELDS + ["ethSpotPrice", "cexTvl"]))

    filled = []
    for key in keys:
        if data.get(key) is not None:
            continue
        prev_val = prev_data.get(key)
        if prev_val is None:
            continue
        observed_at = prev_obs.get(key) or prev_upd.get(key) or previous.get("generatedAt")
        if is_stale(observed_at, as_of, key):
            continue
        data[key] = prev_val
        sources[key] = prev_sources.get(key) or sources.get(key) or "Local cache"
        field_obs[key] = observed_at
        field_upd[key] = observed_at
        field_fetch[key] = now_iso
        if key in missing:
            missing.remove(key)
        filled.append(key)

    if filled:
        errors = payload.get("errors")
        if not isinstance(errors, list):
            errors = []
        errors.append("Local cache fallback: " + ", ".join(filled))
        payload["errors"] = errors

    payload["data"] = data
    payload["sources"] = sources
    payload["fieldObservedAt"] = field_obs
    payload["fieldFetchedAt"] = field_fetch
    payload["fieldUpdatedAt"] = field_upd
    payload["missing"] = missing
    return filled


def curl_probe(url, proxy=None, timeout=6):
    cmd = ["curl", "-sSL", "--connect-timeout", str(timeout), "--max-time", str(timeout)]
    parsed = urlparse(url)
    host = parsed.hostname
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    if host:
        ip = resolve_host(host)
        if ip:
            cmd += ["--resolve", f"{host}:{port}:{ip}"]
    if proxy and proxy.lower() != "direct":
        cmd += ["--proxy", proxy]
    cmd.append(url)
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 5)
    except Exception as exc:
        return "", str(exc)
    if result.returncode != 0:
        return "", (result.stderr or "").strip()
    return result.stdout.strip(), ""


def fred_series_csv(series_id, limit=10, target_date=None):
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}"
    try:
        text = fetch_text(url)
    except Exception:
        return []
    rows = []
    for line in text.splitlines():
        if not line or line.startswith("DATE"):
            continue
        parts = line.split(",")
        if len(parts) < 2 or parts[1] in (".", ""):
            continue
        try:
            rows.append({"date": parts[0], "value": float(parts[1])})
        except ValueError:
            continue
    if not rows:
        return []
    if target_date:
        target = parse_iso_date(target_date)
        if target:
            rows = [item for item in rows if parse_iso_date(item.get("date")) and parse_iso_date(item.get("date")) <= target]
    return list(reversed(rows[-limit:]))


def fred_series(series_id, limit=10, target_date=None):
    url = (
        "https://api.stlouisfed.org/fred/series/observations"
        f"?series_id={series_id}&api_key={FRED_KEY}&file_type=json&sort_order=desc&limit={limit}"
    )
    if target_date:
        url = f"{url}&observation_end={target_date}"
    try:
        data = fetch_json(url)
    except RuntimeError:
        return fred_series_csv(series_id, limit, target_date)
    observations = data.get("observations") if isinstance(data, dict) else None
    if not observations:
        return fred_series_csv(series_id, limit, target_date)
    return [
        {"date": item["date"], "value": float(item["value"])}
        for item in observations
        if item.get("value") not in (".", None)
    ]


def percent_change(latest, previous):
    if previous == 0:
        return 0.0
    return (latest - previous) / previous * 100


def consecutive_up(values, count):
    if len(values) < count + 1:
        return False
    for i in range(count):
        if values[i]["value"] <= values[i + 1]["value"]:
            return False
    return True


def delta(values, offset=5):
    if len(values) <= offset:
        return 0.0
    return values[0]["value"] - values[offset]["value"]


def parse_iso_date(value):
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def index_for_date(series, target_date):
    if not series:
        return 0
    if not target_date:
        return 0
    target = parse_iso_date(target_date)
    if not target:
        return 0
    for idx, item in enumerate(series):
        item_date = parse_iso_date(item.get("date"))
        if item_date and item_date <= target:
            return idx
    return max(len(series) - 1, 0)


def date_key_from_ts(ts_value):
    try:
        return datetime.fromtimestamp(float(ts_value), timezone.utc).date().isoformat()
    except Exception:
        return None


def normalize_farside_date(value):
    if not value:
        return None
    raw = value.strip()
    if re.match(r"\d{4}-\d{2}-\d{2}", raw):
        return raw[:10]
    raw = raw.split()[0] + " " + raw.split()[1] + " " + raw.split()[2] if len(raw.split()) >= 3 else raw
    for fmt in ("%d %b %Y", "%d %B %Y"):
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def pick_series_window(series, target_date, length):
    if not series:
        return []
    idx = index_for_date(series, target_date)
    return series[idx : idx + length]


def pick_series_value(series, target_date):
    if not series:
        return None
    idx = index_for_date(series, target_date)
    if idx >= len(series):
        return None
    return series[idx].get("value")


def build_chart_series(series):
    points = []
    for item in series or []:
        if len(item) < 2:
            continue
        date_key = date_key_from_ts(item[0] / 1000)
        if not date_key:
            continue
        points.append({"date": date_key, "value": float(item[1])})
    points.sort(key=lambda item: item["date"], reverse=True)
    return points


def chart_value_at_date(series, target_date):
    points = build_chart_series(series)
    if not points:
        return None, None
    idx = index_for_date(points, target_date)
    current = points[idx]["value"] if idx < len(points) else None
    prev = points[idx + 1]["value"] if idx + 1 < len(points) else None
    return current, prev


def fetch_macro(target_date=None):
    missing = []
    dxy = fred_series("DTWEXBGS", 7, target_date)
    dgs2 = fred_series("DGS2", 7, target_date)
    nfci = fred_series("NFCI", 6, target_date)
    rrp = fred_series("RRPONTSYD", 7, target_date)
    tga = fred_series("WTREGEN", 7, target_date)
    srf = fred_series("SRFTRD", 7, target_date)
    ism = fred_series("NAPM", 3, target_date)
    dff = fred_series("DFF", 7, target_date)
    if not dxy:
        missing.append("dxy5d")
        missing.append("dxy3dUp")
    if not dgs2:
        missing.append("us2yWeekBp")
        missing.append("preMeeting2y")
        missing.append("current2y")
    if not nfci:
        missing.append("fciUpWeeks")
    if not rrp:
        missing.append("rrpChange")
    if not tga:
        missing.append("tgaChange")
    if not srf:
        missing.append("srfChange")
    if not ism:
        missing.append("ism")
    if not dff:
        missing.append("policyWindow")

    current2y = dgs2[0]["value"] if dgs2 else 0
    pre2y = dgs2[2]["value"] if len(dgs2) > 2 else current2y
    current_dxy = dxy[0]["value"] if dxy else 0
    pre_dxy = dxy[2]["value"] if len(dxy) > 2 else current_dxy

    policy_window = False
    if len(dff) >= 3:
        recent_change = dff[0]["value"] != dff[1]["value"] or dff[1]["value"] != dff[2]["value"]
        policy_window = recent_change

    fci_up = 0
    if len(nfci) >= 3:
        if nfci[0]["value"] > nfci[1]["value"]:
            fci_up = 1
            if nfci[1]["value"] > nfci[2]["value"]:
                fci_up = 2

    data = {
        "dxy5d": percent_change(dxy[0]["value"], dxy[5]["value"]) if len(dxy) > 5 else None,
        "dxy3dUp": consecutive_up(dxy, 3) if dxy else None,
        "us2yWeekBp": (current2y - (dgs2[5]["value"] if len(dgs2) > 5 else current2y)) * 100 if dgs2 else None,
        "fciUpWeeks": fci_up if nfci else None,
        "policyWindow": policy_window,
        "preMeeting2y": pre2y if dgs2 else None,
        "current2y": current2y if dgs2 else None,
        "preMeetingDxy": pre_dxy if dxy else None,
        "currentDxy": current_dxy if dxy else None,
        "rrpChange": delta(rrp, 5) if rrp else None,
        "tgaChange": delta(tga, 5) if tga else None,
        "srfChange": delta(srf, 5) if srf else None,
        "ism": ism[0]["value"] if ism else None,
    }
    sources = {
        "dxy5d": "FRED: DTWEXBGS",
        "dxy3dUp": "FRED: DTWEXBGS",
        "us2yWeekBp": "FRED: DGS2",
        "fciUpWeeks": "FRED: NFCI",
        "policyWindow": "FRED: DFF recent change",
        "preMeeting2y": "FRED: DGS2 (t-2)",
        "current2y": "FRED: DGS2 (latest)",
        "preMeetingDxy": "FRED: DTWEXBGS (t-2)",
        "currentDxy": "FRED: DTWEXBGS (latest)",
        "rrpChange": "FRED: RRPONTSYD",
        "tgaChange": "FRED: WTREGEN",
        "srfChange": "FRED: SRFTRD",
        "ism": "FRED: NAPM",
    }
    def stamp(series, idx=0):
        if not series or idx >= len(series):
            return None
        date_value = series[idx].get("date")
        return f"{date_value}T00:00:00Z" if date_value else None

    observed_at = {
        "dxy5d": stamp(dxy, 0),
        "dxy3dUp": stamp(dxy, 0),
        "us2yWeekBp": stamp(dgs2, 0),
        "fciUpWeeks": stamp(nfci, 0),
        "policyWindow": stamp(dff, 0),
        "preMeeting2y": stamp(dgs2, 2),
        "current2y": stamp(dgs2, 0),
        "preMeetingDxy": stamp(dxy, 2),
        "currentDxy": stamp(dxy, 0),
        "rrpChange": stamp(rrp, 0),
        "tgaChange": stamp(tga, 0),
        "srfChange": stamp(srf, 0),
        "ism": stamp(ism, 0),
    }
    return data, sources, missing, {"observedAt": observed_at}


def fetch_defillama(target_date=None):
    data = fetch_json("https://stablecoins.llama.fi/stablecoincharts/all")
    if not isinstance(data, list) or not data:
        return ({}, {}, ["stablecoin30d"])
    points = [
        {
            "date": date_key_from_ts(item.get("date")),
            "value": (item.get("totalCirculatingUSD") or {}).get("peggedUSD", 0),
        }
        for item in data
        if item.get("date")
    ]
    points = [item for item in points if item.get("date") is not None]
    points.sort(key=lambda item: item["date"], reverse=True)
    if not points:
        return ({}, {}, ["stablecoin30d"])
    idx = index_for_date(points, target_date) if target_date else 0
    latest = points[idx]["value"]
    prior_idx = idx + 30 if idx + 30 < len(points) else min(len(points) - 1, idx)
    prior = points[prior_idx]["value"]
    stablecoin30d = percent_change(latest, prior)
    observed_date = points[idx].get("date")
    observed_stamp = f"{observed_date}T00:00:00Z" if observed_date else None
    return (
        {"stablecoin30d": stablecoin30d, "totalStableNow": latest, "totalStableAgo": prior},
        {"stablecoin30d": "DefiLlama: stablecoincharts/all"},
        [],
        {"observedAt": {"stablecoin30d": observed_stamp}},
    )


def fetch_stablecoin_eth(target_date=None):
    data = fetch_json("https://stablecoins.llama.fi/stablecoincharts/ethereum")
    if not isinstance(data, list) or not data:
        return ({}, {}, ["mappingRatioDown"])
    points = [
        {
            "date": date_key_from_ts(item.get("date")),
            "value": (item.get("totalCirculatingUSD") or {}).get("peggedUSD", 0),
        }
        for item in data
        if item.get("date")
    ]
    points = [item for item in points if item.get("date") is not None]
    points.sort(key=lambda item: item["date"], reverse=True)
    if not points:
        return ({}, {}, ["mappingRatioDown"])
    idx = index_for_date(points, target_date) if target_date else 0
    latest = points[idx]["value"]
    prior_idx = idx + 30 if idx + 30 < len(points) else min(len(points) - 1, idx)
    prior = points[prior_idx]["value"]
    observed_date = points[idx].get("date")
    observed_stamp = f"{observed_date}T00:00:00Z" if observed_date else None
    return (
        {"ethStableNow": latest, "ethStableAgo": prior},
        {
            "ethStableNow": "DefiLlama: stablecoincharts/ethereum",
            "ethStableAgo": "DefiLlama: stablecoincharts/ethereum",
        },
        [],
        {"observedAt": {"ethStableNow": observed_stamp, "ethStableAgo": observed_stamp}},
    )


def parse_number(value):
    if not value:
        return 0
    raw = value.strip()
    if raw in ("-", "—", "–"):
        return 0
    return float(raw.replace("(", "-").replace(")", "").replace(",", ""))


def parse_money(value):
    if value is None:
        return 0
    raw = value.strip().replace(",", "")
    match = re.match(r"([-\d.]+)\s*([KMB]?)", raw, re.IGNORECASE)
    if not match:
        return 0
    number = float(match.group(1))
    unit = match.group(2).upper()
    if unit == "K":
        return number * 1_000
    if unit == "M":
        return number * 1_000_000
    if unit == "B":
        return number * 1_000_000_000
    return number


def parse_farside_table(text):
    rows = []
    for line in text.split("\n"):
        if not line.strip().startswith("|"):
            continue
        parts = [cell.strip() for cell in line.split("|")]
        if len(parts) > 3 and (
            re.search(r"\d{4}-\d{2}-\d{2}", parts[1]) or re.search(r"\d{2}\s\w{3}\s\d{4}", parts[1])
        ):
            rows.append(parts)
    if len(rows) <= 0:
        return []
    parsed = [{"date": row[1], "total": parse_number(row[-2])} for row in rows if row[1]]
    return list(reversed(parsed[-30:]))


def parse_farside_rows(text):
    rows = []
    for line in text.split("\n"):
        if not line.strip().startswith("|"):
            continue
        parts = [cell.strip() for cell in line.split("|") if cell.strip()]
        if not parts:
            continue
        if re.search(r"\d{4}-\d{2}-\d{2}", parts[0]) or re.search(r"\d{2}\s\w{3}\s\d{4}", parts[0]):
            values = [parse_number(val) for val in parts[1:]]
            if len(values) < 2:
                continue
            total = values[-1]
            components = values[:-1]
            rows.append({"date": parts[0], "total": total, "sum": sum(components)})
    return rows

def is_cloudflare_blocked(text):
    if not text:
        return True
    lowered = text.lower()
    return "just a moment" in lowered or "cf-browser-verification" in lowered or "cloudflare" in lowered


def fetch_farside_source(url, label):
    errors = []
    direct_text = fetch_text(url)
    direct_blocked = is_cloudflare_blocked(direct_text)
    direct_parsed = parse_farside_table(direct_text)
    if direct_blocked or not direct_parsed:
        if direct_blocked:
            errors.append(f"{label} direct blocked, fallback to jina")
        jina_text = fetch_text(f"https://r.jina.ai/{url}")
        jina_parsed = parse_farside_table(jina_text)
        if jina_parsed:
            rows = parse_farside_rows(jina_text)
            if rows:
                delta = abs(rows[0]["total"] - rows[0]["sum"])
                if delta > 0.1:
                    errors.append(f"{label} total mismatch vs components: {delta:.2f}")
            return jina_parsed, f"{label} (Jina)", errors
    if direct_parsed:
        try:
            jina_text = fetch_text(f"https://r.jina.ai/{url}")
            jina_parsed = parse_farside_table(jina_text)
        except Exception:
            jina_parsed = []
        if jina_parsed:
            delta = abs(direct_parsed[0]["total"] - jina_parsed[0]["total"])
            if delta > 0.1:
                errors.append(f"{label} direct vs jina mismatch: {delta:.2f}")
        rows = parse_farside_rows(direct_text)
        if rows:
            delta = abs(rows[0]["total"] - rows[0]["sum"])
            if delta > 0.1:
                errors.append(f"{label} total mismatch vs components: {delta:.2f}")
        return direct_parsed, label, errors
    return [], None, errors


def fetch_farside(target_date=None):
    urls = [
        ("https://farside.co.uk/ethereum-etf-flow/", "Farside: ethereum-etf-flow"),
        ("https://farside.co.uk/bitcoin-etf-flow/", "Farside: bitcoin-etf-flow"),
    ]
    parsed = []
    source = None
    errors = []
    for url, label in urls:
        parsed, source, extra_errors = fetch_farside_source(url, label)
        errors.extend(extra_errors)
        if parsed:
            break
    series = []
    for item in parsed:
        date_key = normalize_farside_date(item.get("date"))
        if not date_key:
            continue
        series.append({"date": date_key, "total": item.get("total", 0)})
    series.sort(key=lambda item: item["date"], reverse=True)
    if target_date and series:
        idx = index_for_date(series, target_date)
        window = series[idx : idx + 10]
        etf1d = series[idx]["total"] if idx < len(series) else 0
        etf5d = sum(item["total"] for item in window[:5])
        etf10d = sum(item["total"] for item in window[:10])
        prev_val = series[idx + 1]["total"] if idx + 1 < len(series) else 0
        prev_extreme = prev_val <= -180
        obs_date = series[idx]["date"] if idx < len(series) else None
    else:
        etf1d = parsed[0]["total"] if parsed else 0
        etf5d = sum(item["total"] for item in parsed[:5])
        etf10d = sum(item["total"] for item in parsed[:10])
        prev_extreme = False
        obs_date = series[0]["date"] if series else None

    obs_stamp = f"{obs_date}T00:00:00Z" if obs_date else None
    return (
        {
            "etf1d": etf1d,
            "etf5d": etf5d,
            "etf10d": etf10d,
            "prevEtfExtremeOutflow": prev_extreme,
        },
        {
            "etf1d": source or "Farside: 未获取",
            "etf5d": source or "Farside: 未获取",
            "etf10d": source or "Farside: 未获取",
            "prevEtfExtremeOutflow": "Derived: prior day ETF extreme",
        },
        [] if parsed else ["etf1d", "etf5d", "etf10d"],
        {
            "errors": errors,
            "observedAt": {
                "etf1d": obs_stamp,
                "etf5d": obs_stamp,
                "etf10d": obs_stamp,
                "prevEtfExtremeOutflow": obs_stamp,
            },
        },
    )


def fetch_coingecko_market(target_date=None):
    if target_date:
        history_date = datetime.strptime(target_date, "%Y-%m-%d").strftime("%d-%m-%Y")
        url = f"https://api.coingecko.com/api/v3/coins/ethereum/history?date={history_date}"
        data = fetch_json(url)
        market = data.get("market_data", {}) if isinstance(data, dict) else {}
        eth_spot = (market.get("current_price") or {}).get("usd", 0)
        market_cap = (market.get("market_cap") or {}).get("usd", 0)
        volume_24h = (market.get("total_volume") or {}).get("usd", 0)
        circulating = market.get("circulating_supply") or 0
        total_supply = market.get("total_supply") or circulating or 1
        float_density = circulating / total_supply if total_supply else 1
        chart = fetch_json(
            "https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=365"
        )
        mcap_now, mcap_prev = chart_value_at_date(chart.get("market_caps"), target_date) if chart else (None, None)
        mcap_change = percent_change(mcap_now, mcap_prev) / 100 if mcap_now and mcap_prev else 0
        volume_now, _prev_vol = chart_value_at_date(chart.get("total_volumes"), target_date) if chart else (None, None)
        volume_24h = volume_now or volume_24h
        mcap_elasticity = market_cap / volume_24h if volume_24h else 0
        return (
            {
                "ethSpotPrice": eth_spot,
                "mcapGrowth": mcap_change,
                "mcapElasticity": mcap_elasticity,
                "floatDensity": float_density,
                "trendMomentum": 0,
                "divergence": 0,
            },
            {
                "ethSpotPrice": "CoinGecko: history current_price.usd",
                "mcapGrowth": "CoinGecko: market_chart (1d)",
                "mcapElasticity": "CoinGecko: market_cap / volume",
                "floatDensity": "CoinGecko: circulating / total_supply",
                "trendMomentum": "CoinGecko: history (placeholder)",
                "divergence": "CoinGecko: history (placeholder)",
            },
            [],
        )
    url = (
        "https://api.coingecko.com/api/v3/coins/ethereum"
        "?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false"
    )
    data = fetch_json(url)
    if not isinstance(data, dict) or not data.get("market_data"):
        return ({}, {}, ["mcapGrowth", "mcapElasticity", "floatDensity", "trendMomentum", "divergence"])
    market = data.get("market_data", {})
    eth_spot = market.get("current_price", {}).get("usd", 0)
    market_cap = market.get("market_cap", {}).get("usd", 0)
    volume_24h = market.get("total_volume", {}).get("usd", 0)
    mcap_change = (market.get("market_cap_change_percentage_24h") or 0) / 100
    circulating = market.get("circulating_supply", 0)
    total_supply = market.get("total_supply") or circulating or 1
    float_density = circulating / total_supply if total_supply else 1
    trend_momentum = ((market.get("price_change_percentage_7d") or 0) / 100 + 1) / 2
    divergence = abs((market.get("price_change_percentage_24h") or 0) / 100)
    mcap_elasticity = market_cap / volume_24h if volume_24h else 0
    return (
        {
            "ethSpotPrice": eth_spot,
            "mcapGrowth": mcap_change,
            "mcapElasticity": mcap_elasticity,
            "floatDensity": float_density,
            "trendMomentum": trend_momentum,
            "divergence": divergence,
        },
        {
            "ethSpotPrice": "CoinGecko: current_price.usd",
            "mcapGrowth": "CoinGecko: market_cap_change_percentage_24h",
            "mcapElasticity": "CoinGecko: market_cap / volume_24h",
            "floatDensity": "CoinGecko: circulating / total_supply",
            "trendMomentum": "CoinGecko: price_change_percentage_7d",
            "divergence": "CoinGecko: price_change_percentage_24h",
        },
        [],
    )


def fetch_coinglass_liquidations(target_date=None):
    url = "https://open-api-v4.coinglass.com/api/futures/liquidation/aggregated-history?symbol=BTC&interval=1d"
    data = fetch_json(url)
    if data.get("code") == "0" and data.get("data"):
        series = data["data"]
        if target_date:
            picked = None
            for item in reversed(series):
                ts = item.get("time") or item.get("timestamp") or item.get("createTime")
                date_key = date_key_from_ts(float(ts) / 1000) if ts else None
                if date_key and date_key <= target_date:
                    picked = item
                    break
            latest = picked or series[-1]
        else:
            latest = series[-1]
        liquidation = float(latest.get("aggregated_long_liquidation_usd", 0)) + float(
            latest.get("aggregated_short_liquidation_usd", 0)
        )
        return (
            {"liquidationUsd": liquidation},
            {"liquidationUsd": "Coinglass open-api: aggregated-history"},
            [],
        )
    html = fetch_text("https://www.coinglass.com/liquidations")
    match = re.search(r"total liquidations comes in at \$([\d.,]+[KMB]?)", html, re.IGNORECASE)
    if match:
        liquidation = parse_money(match.group(1))
        return (
            {"liquidationUsd": liquidation},
            {"liquidationUsd": "Coinglass web: /liquidations"},
            [],
        )
    return ({}, {}, ["liquidationUsd"])


def fetch_exchange_proxy(target_date=None):
    data = fetch_json("https://api.coingecko.com/api/v3/exchanges/binance")
    volume_btc = data.get("trade_volume_24h_btc", 0) or 0
    exch_balance_trend = (volume_btc and (volume_btc ** 0.5) / 1000) or 0
    exch_stable_delta = exch_balance_trend
    return (
        {"exchBalanceTrend": exch_balance_trend, "exchStableDelta": exch_stable_delta},
        {
            "exchBalanceTrend": "CoinGecko: binance trade_volume_24h_btc",
            "exchStableDelta": "CoinGecko: binance trade_volume_24h_btc",
        },
        [],
    )


def fetch_defillama_cex(target_date=None):
    data = fetch_json("https://api.llama.fi/cexs")
    if not isinstance(data, dict) or not data.get("cexs"):
        return ({}, {}, ["exchBalanceTrend", "exchStableDelta"])
    cexs = data.get("cexs", [])
    total_inflow_1m = 0.0
    total_inflow_1w = 0.0
    total_tvl = 0.0
    for item in cexs:
        total_inflow_1m += float(item.get("inflows_1m") or 0)
        total_inflow_1w += float(item.get("inflows_1w") or 0)
        total_tvl += float(item.get("currentTvl") or 0)
    return (
        {"exchBalanceTrend": total_inflow_1m, "exchStableDelta": total_inflow_1w, "cexTvl": total_tvl},
        {
            "exchBalanceTrend": "DefiLlama: /cexs inflows_1m (sum)",
            "exchStableDelta": "DefiLlama: /cexs inflows_1w (sum)",
            "cexTvl": "DefiLlama: /cexs currentTvl (sum)",
        },
        [],
    )


def fetch_coingecko_ohlc(target_date=None):
    days = 365 if target_date else 30
    ohlc = fetch_json(
        f"https://api.coingecko.com/api/v3/coins/ethereum/ohlc?vs_currency=usd&days={days}"
    )
    chart = fetch_json(
        f"https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days={days}"
    )
    if not isinstance(ohlc, list) or not ohlc:
        return ({}, {}, ["crowdingIndex", "longWicks", "reverseFishing", "shortFailure", "volumeConfirm"])
    ohlc_points = []
    for item in ohlc:
        date_key = date_key_from_ts(item[0] / 1000)
        if not date_key:
            continue
        ohlc_points.append(
            {
                "date": date_key,
                "open": float(item[1]),
                "high": float(item[2]),
                "low": float(item[3]),
                "close": float(item[4]),
            }
        )
    ohlc_points.sort(key=lambda item: item["date"], reverse=True)
    volume_map = {}
    for item in chart.get("total_volumes") or []:
        date_key = date_key_from_ts(item[0] / 1000)
        if not date_key:
            continue
        volume_map[date_key] = float(item[1])
    volumes = [volume_map.get(item["date"], 0.0) for item in ohlc_points]
    idx = index_for_date(ohlc_points, target_date) if target_date else 0
    idx = min(idx, len(ohlc_points) - 1)
    latest = ohlc_points[idx]
    latest_open = latest["open"]
    latest_close = latest["close"]
    latest_high = latest["high"]
    latest_low = latest["low"]
    prev_window = volumes[idx + 1 : idx + 8]
    avg_volume = sum(prev_window) / max(len(prev_window), 1)
    wick_ratio = (latest_high - max(latest_open, latest_close)) / max(latest_high - latest_low, 1)
    trend_momentum = (
        (latest_close - ohlc_points[idx + 7]["close"]) / ohlc_points[idx + 7]["close"]
        if idx + 7 < len(ohlc_points)
        else 0
    )
    divergence = (
        abs((latest_close - ohlc_points[idx + 1]["close"]) / ohlc_points[idx + 1]["close"])
        if idx + 1 < len(ohlc_points)
        else 0
    )
    crowding_index = min(100, 50 + abs(trend_momentum) * 500)
    long_wicks = wick_ratio > 0.4
    reverse_fishing = latest_close < latest_open and volumes[idx] > avg_volume * 1.5
    short_failure = latest_close > latest_open and (latest_close - latest_low) / max(latest_high - latest_low, 1) > 0.6
    volume_confirm = volumes[idx] >= avg_volume * 1.2
    close_window = [item["close"] for item in ohlc_points[idx : idx + 30]]
    volume_window = volumes[idx : idx + 30]
    obs_date = ohlc_points[idx].get("date") if idx < len(ohlc_points) else None
    obs_stamp = f"{obs_date}T00:00:00Z" if obs_date else None
    return (
        {
            "trendMomentum": trend_momentum,
            "divergence": divergence,
            "crowdingIndex": crowding_index,
            "longWicks": long_wicks,
            "reverseFishing": reverse_fishing,
            "shortFailure": short_failure,
            "volumeConfirm": volume_confirm,
            "_closeSeries": close_window,
            "_volumeSeries": volume_window,
        },
        {
            "trendMomentum": "CoinGecko: ohlc (365d)" if target_date else "CoinGecko: ohlc (30d)",
            "divergence": "CoinGecko: ohlc (365d)" if target_date else "CoinGecko: ohlc (30d)",
            "crowdingIndex": "CoinGecko: ohlc (365d)" if target_date else "CoinGecko: ohlc (30d)",
            "longWicks": "CoinGecko: ohlc (365d)" if target_date else "CoinGecko: ohlc (30d)",
            "reverseFishing": "CoinGecko: ohlc (365d)" if target_date else "CoinGecko: ohlc (30d)",
            "shortFailure": "CoinGecko: ohlc (365d)" if target_date else "CoinGecko: ohlc (30d)",
            "volumeConfirm": "CoinGecko: market_chart total_volumes",
        },
        [],
        {
            "observedAt": {
                "trendMomentum": obs_stamp,
                "divergence": obs_stamp,
                "crowdingIndex": obs_stamp,
                "longWicks": obs_stamp,
                "reverseFishing": obs_stamp,
                "shortFailure": obs_stamp,
                "volumeConfirm": obs_stamp,
            }
        },
    )


def fetch_rwa_protocols(target_date=None):
    data = fetch_json("https://api.llama.fi/protocols")
    if not isinstance(data, list):
        return ({}, {}, ["rsdScore", "mappingRatioDown"])
    total = 0.0
    eth_total = 0.0
    for item in data:
        if item.get("category") != "RWA":
            continue
        tvl = float(item.get("tvl") or 0)
        total += tvl
        chain_tvls = item.get("chainTvls") or {}
        eth_total += float(chain_tvls.get("Ethereum") or 0)
    if total <= 0:
        return ({}, {}, ["rsdScore"])
    return (
        {"rwaShareEth": eth_total / total},
        {"rwaShareEth": "DefiLlama: protocols (RWA)"},
        [],
    )


def fetch_eth_fees(target_date=None):
    data = fetch_json("https://api.llama.fi/summary/fees/ethereum")
    if not isinstance(data, dict) or not data:
        return ({}, {}, ["lstcScore", "netIssuanceHigh"])
    total7d = float(data.get("total7d") or 0)
    total30d = float(data.get("total30d") or 0)
    return (
        {"fee7d": total7d, "fee30d": total30d},
        {"fee7d": "DefiLlama: fees/ethereum", "fee30d": "DefiLlama: fees/ethereum"},
        [],
    )


def fetch_fear_greed(target_date=None):
    data = fetch_json("https://api.alternative.me/fng/?limit=1&format=json")
    try:
        value = float(data.get("data", [{}])[0].get("value"))
        return ({"fearGreed": value}, {"fearGreed": "Alternative.me: FNG"}, [])
    except Exception:
        return ({}, {}, ["sentimentThreshold"])


def fetch_distribution_gate(target_date=None):
    url = (
        "https://api.gdeltproject.org/api/v2/doc/doc?"
        "query=crypto%20ETF%20OR%20crypto%20ETP%20OR%20crypto%20ETNs"
        "&mode=ArtList&format=json&maxrecords=100&sort=HybridRel"
    )
    data = fetch_json(url)
    articles = data.get("articles") if isinstance(data, dict) else None
    if not articles:
        return (
            {"distributionGateCount": 0},
            {"distributionGateCount": "GDELT: crypto ETF/ETP news (30d)"},
            [],
        )
    institutions = [
        "Vanguard",
        "Bank of America",
        "BofA",
        "Morgan Stanley",
        "Fidelity",
        "Charles Schwab",
        "Schwab",
        "BlackRock",
        "JPMorgan",
        "Goldman",
        "UBS",
        "Citi",
        "Citigroup",
        "TD Ameritrade",
    ]
    found = set()
    for item in articles:
        title = (item.get("title") or "").lower()
        for name in institutions:
            if name.lower() in title:
                found.add(name)
    return (
        {"distributionGateCount": len(found)},
        {"distributionGateCount": "GDELT: crypto ETF/ETP news (30d)"},
        [],
    )


def clamp(value, low=0.0, high=1.0):
    return max(low, min(high, value))


def compute_tridomain(closes):
    if not closes or len(closes) < 10:
        return {}
    returns = []
    for i in range(len(closes) - 1):
        prev = closes[i + 1]
        if prev == 0:
            continue
        returns.append((closes[i] - prev) / prev)
    if not returns:
        return {}
    return_30d = closes[0] / closes[-1] - 1 if closes[-1] else 0
    return_7d = closes[0] / closes[min(7, len(closes) - 1)] - 1 if closes[-1] else 0
    avg = sum(returns) / len(returns)
    var = sum((r - avg) ** 2 for r in returns) / max(len(returns) - 1, 1)
    vol = math.sqrt(var)
    topo = clamp(abs(return_30d) / 0.2) * (1 - clamp(vol / 0.1))
    spectral = clamp(abs(return_7d) / (abs(return_30d) + 1e-6))
    worst = sorted(returns)[: max(1, int(len(returns) * 0.1))]
    es = abs(sum(worst) / len(worst))
    delta_es = clamp(es / 0.1)
    rough_path = clamp(1 - delta_es)
    return {"topo": topo, "spectral": spectral, "roughPath": rough_path, "deltaES": delta_es}


def compute_potentials(data):
    trend = data.get("trendMomentum", 0) or 0
    divergence = data.get("divergence", 0) or 0
    stable30d = data.get("stablecoin30d", 0) or 0
    etf10d = data.get("etf10d", 0) or 0
    rrp_change = data.get("rrpChange", 0) or 0
    mcap_elasticity = data.get("mcapElasticity", 0) or 0
    float_density = data.get("floatDensity", 1) or 1

    cognitive = clamp(0.5 + trend * 1.2 - divergence * 2)
    stable_norm = clamp(stable30d / 10, -1, 1)
    etf_norm = clamp(etf10d / 500, -1, 1)
    liquidity = clamp(0.5 + stable_norm * 0.2 + etf_norm * 0.2 - (0.1 if rrp_change > 0 else 0))
    elasticity_norm = clamp(mcap_elasticity / 50, 0, 2)
    reflex = clamp(1 - elasticity_norm * 0.3 + (1 - float_density) * 0.2)
    if "fearGreed" in data:
        threshold = clamp(0.4 + (data["fearGreed"] / 250), 0.3, 0.8)
    else:
        threshold = None
    return {
        "cognitivePotential": cognitive,
        "liquidityPotential": liquidity,
        "onchainReflexivity": reflex,
        "sentimentThreshold": threshold,
    }


def merge(*blocks):
    data = {}
    sources = {}
    missing = []
    for block in blocks:
        data.update(block[0])
        sources.update(block[1])
        missing.extend(block[2])
    return data, sources, missing


def strip_none(data):
    return {k: v for k, v in data.items() if v is not None}


def today_key():
    return datetime.now(timezone.utc).date().isoformat()


def shift_date_iso(date_value, days):
    parsed = parse_iso_date(date_value)
    if not parsed:
        return None
    return (parsed + timedelta(days=days)).isoformat()


def build_field_timestamps(data, sources, target_date, generated_at, observed_overrides=None):
    observed = {}
    fetched = {}
    field_updated = {}
    fallback = generated_at
    overrides = observed_overrides or {}
    if target_date:
        fallback = f"{target_date}T00:00:00Z"
    for key in data.keys():
        source = (sources or {}).get(key, "")
        stamp = fallback
        if source.startswith("FRED:") and target_date:
            stamp = f"{target_date}T00:00:00Z"
        if "(t-2)" in source and target_date:
            shifted = shift_date_iso(target_date, -2)
            stamp = f"{shifted}T00:00:00Z" if shifted else stamp
        if "(latest)" in source:
            stamp = generated_at
        if "Derived:" in source and target_date:
            stamp = f"{target_date}T00:00:00Z"
        if overrides.get(key):
            stamp = overrides[key]
        observed[key] = stamp
        fetched[key] = generated_at
        field_updated[key] = stamp
    return observed, fetched, field_updated


def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", dest="target_date", default=None)
    parser.add_argument("--output", dest="output_path", default=os.path.join("src", "data", "auto.json"))
    args = parser.parse_args(argv if argv is not None else [])
    target_date = args.target_date
    errors = []
    observed_overrides = {}

    def merge_observed(meta):
        if not isinstance(meta, dict):
            return
        obs = meta.get("observedAt") or {}
        if not isinstance(obs, dict):
            return
        for key, stamp in obs.items():
            if key and stamp:
                observed_overrides[key] = stamp

    def safe_call(name, func, missing_keys):
        try:
            result = func(target_date)
            if not isinstance(result, tuple):
                return result
            if len(result) == 3:
                return result
            if len(result) == 4:
                data, sources, missing, extra = result
                extra_errors = []
                if isinstance(extra, dict):
                    merge_observed(extra)
                    extra_errors = extra.get("errors") or []
                else:
                    extra_errors = extra or []
                if extra_errors:
                    errors.extend([f"{name}: {err}" for err in extra_errors])
                return data, sources, missing
            if len(result) == 5:
                data, sources, missing, meta, extra_errors = result
                if isinstance(meta, dict):
                    merge_observed(meta)
                    meta_errors = meta.get("errors") or []
                    if meta_errors:
                        errors.extend([f"{name}: {err}" for err in meta_errors])
                if extra_errors:
                    errors.extend([f"{name}: {err}" for err in extra_errors])
                return data, sources, missing
            return result[:3]
        except Exception as exc:
            errors.append(f"{name}: {exc}")
            return {}, {}, missing_keys

    macro = safe_call(
        "FRED(macro)",
        fetch_macro,
        [
            "dxy5d",
            "dxy3dUp",
            "us2yWeekBp",
            "fciUpWeeks",
            "policyWindow",
            "preMeeting2y",
            "current2y",
            "preMeetingDxy",
            "currentDxy",
            "rrpChange",
            "tgaChange",
            "srfChange",
            "ism",
        ],
    )
    stable = safe_call("DefiLlama(stablecoin)", fetch_defillama, ["stablecoin30d"])
    stable_eth = safe_call("DefiLlama(stablecoin_eth)", fetch_stablecoin_eth, ["mappingRatioDown"])
    etf = safe_call("Farside(ETF)", fetch_farside, ["etf1d", "etf5d", "etf10d"])
    market = safe_call(
        "CoinGecko(market)",
        fetch_coingecko_market,
        ["mcapGrowth", "mcapElasticity", "floatDensity", "trendMomentum", "divergence"],
    )
    liquidation = safe_call("Coinglass(liquidation)", fetch_coinglass_liquidations, ["liquidationUsd"])
    cex = safe_call("DefiLlama(CEX)", fetch_defillama_cex, ["exchBalanceTrend", "exchStableDelta"])
    if cex[2]:
        proxy = safe_call("CoinGecko(CEX proxy)", fetch_exchange_proxy, cex[2])
        if proxy[0]:
            errors.append("CEX: DefiLlama unavailable, fallback to exchange proxy")
            cex = proxy
    klines = safe_call(
        "CoinGecko(OHLC)",
        fetch_coingecko_ohlc,
        ["crowdingIndex", "longWicks", "reverseFishing", "shortFailure", "volumeConfirm"],
    )
    rwa = safe_call("DefiLlama(RWA)", fetch_rwa_protocols, ["rsdScore"])
    fees = safe_call("DefiLlama(Fees)", fetch_eth_fees, ["lstcScore", "netIssuanceHigh"])
    sentiment = safe_call("AltMe(FNG)", fetch_fear_greed, ["sentimentThreshold"])
    dist_gate = safe_call("GDELT(Distribution)", fetch_distribution_gate, ["distributionGateCount"])

    data, sources, missing = merge(
        macro,
        stable,
        stable_eth,
        etf,
        market,
        liquidation,
        cex,
        klines,
        rwa,
        fees,
        sentiment,
        dist_gate,
    )
    missing = []

    closes = data.get("_closeSeries") or []
    tridomain = compute_tridomain(closes)
    if tridomain:
        data.update(tridomain)
        sources.update(
            {
                "topo": "Derived: price structure (Binance klines)",
                "spectral": "Derived: price cycle ratio (Binance klines)",
                "roughPath": "Derived: tail risk ES (Binance klines)",
                "deltaES": "Derived: tail risk ES (Binance klines)",
            }
        )
    data.update(compute_potentials(data))
    sources.update(
        {
            "cognitivePotential": "Derived: trendMomentum/divergence",
            "liquidityPotential": "Derived: stablecoin/ETF/RRP",
            "onchainReflexivity": "Derived: elasticity/float",
            "sentimentThreshold": "Alternative.me FNG",
        }
    )

    if "totalStableNow" in data and "totalStableAgo" in data and "ethStableNow" in data and "ethStableAgo" in data:
        total_now = data["totalStableNow"] or 1
        total_ago = data["totalStableAgo"] or 1
        eth_now = data["ethStableNow"] or 0
        eth_ago = data["ethStableAgo"] or 0
        share_now = eth_now / total_now
        share_ago = eth_ago / total_ago
        share_change = share_now - share_ago
        mapping_ratio_down = share_change < 0
        rwa_share = data.get("rwaShareEth") or 0
        rsd_score = clamp(((share_now + rwa_share) / 2) * 10, 0, 10)
        data.update({"rsdScore": rsd_score, "mappingRatioDown": mapping_ratio_down})
        sources.update(
            {
                "rsdScore": "Derived: stablecoin share + RWA share (DefiLlama)",
                "mappingRatioDown": "Derived: ETH stablecoin share 30d",
            }
        )
        stable_stamp = observed_overrides.get("ethStableNow") or observed_overrides.get("stablecoin30d")
        if stable_stamp:
            observed_overrides["mappingRatioDown"] = stable_stamp
            observed_overrides["rsdScore"] = stable_stamp

    if "fee7d" in data and "fee30d" in data:
        fee7d = data["fee7d"] or 0
        fee30d = data["fee30d"] or 0
        weekly_avg = fee30d / 4 if fee30d else 0
        lstc_score = clamp((fee7d / weekly_avg) if weekly_avg else 0, 0, 1) * 10
        net_issuance_high = fee7d < (weekly_avg * 0.6 if weekly_avg else 0)
        data.update({"lstcScore": lstc_score, "netIssuanceHigh": net_issuance_high})
        sources.update(
            {
                "lstcScore": "Derived: ETH fees (DefiLlama)",
                "netIssuanceHigh": "Derived: low fees imply high net issuance",
            }
        )

    if target_date and target_date != today_key():
        errors.append("历史日期回抓：部分来源仅支持最新数据，已使用最新值补齐。")

    data.pop("_closeSeries", None)
    data.pop("_volumeSeries", None)
    data.pop("totalStableNow", None)
    data.pop("totalStableAgo", None)
    data.pop("ethStableNow", None)
    data.pop("ethStableAgo", None)
    data.pop("rwaShareEth", None)
    data.pop("fee7d", None)
    data.pop("fee30d", None)
    data.pop("fearGreed", None)
    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    data = strip_none(data)

    for key in REQUIRED_FIELDS:
        if key not in data or data.get(key) is None:
            missing.append(key)

    previous = load_previous_snapshot()
    if previous:
        skeleton = {
            "generatedAt": generated_at,
            "targetDate": target_date,
            "data": data,
            "sources": sources,
            "fieldObservedAt": {},
            "fieldFetchedAt": {},
            "fieldUpdatedAt": {},
            "missing": missing,
            "errors": errors,
        }
        filled = backfill_from_previous(skeleton, previous, as_of_date=target_date or generated_at)
        if filled:
            for key in filled:
                stamp = (skeleton.get("fieldObservedAt") or {}).get(key)
                if stamp:
                    observed_overrides[key] = stamp
        data = skeleton.get("data") or data
        sources = skeleton.get("sources") or sources
        missing = skeleton.get("missing") or missing
        errors = skeleton.get("errors") or errors

    field_observed_at, field_fetched_at, field_updated_at = build_field_timestamps(
        data, sources, target_date, generated_at, observed_overrides
    )
    payload = {
        "generatedAt": generated_at,
        "targetDate": target_date,
        "data": data,
        "sources": sources,
        "fieldObservedAt": field_observed_at,
        "fieldFetchedAt": field_fetched_at,
        "fieldUpdatedAt": field_updated_at,
        "missing": sorted(set(missing)),
        "proxyTrace": probe_proxy(),
        "errors": errors,
    }
    with open(args.output_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    import sys

    main(sys.argv[1:])
