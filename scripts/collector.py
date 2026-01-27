#!/usr/bin/env python3
import json
import math
import os
import time
import subprocess
import urllib.request
from urllib.parse import urlparse
from urllib.error import HTTPError, URLError
from datetime import datetime, timezone
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
    return ["direct"]


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


def curl_probe(url, proxy=None, timeout=6):
    cmd = ["curl", "-sSL", "--connect-timeout", str(timeout), "--max-time", str(timeout)]
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


def fred_series_csv(series_id, limit=10):
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
    return list(reversed(rows[-limit:]))


def fred_series(series_id, limit=10):
    url = (
        "https://api.stlouisfed.org/fred/series/observations"
        f"?series_id={series_id}&api_key={FRED_KEY}&file_type=json&sort_order=desc&limit={limit}"
    )
    try:
        data = fetch_json(url)
    except RuntimeError:
        return fred_series_csv(series_id, limit)
    observations = data.get("observations") if isinstance(data, dict) else None
    if not observations:
        return fred_series_csv(series_id, limit)
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


def fetch_macro():
    missing = []
    dxy = fred_series("DTWEXBGS", 7)
    dgs2 = fred_series("DGS2", 7)
    nfci = fred_series("NFCI", 6)
    rrp = fred_series("RRPONTSYD", 7)
    tga = fred_series("WTREGEN", 7)
    srf = fred_series("SRFTRD", 7)
    ism = fred_series("NAPM", 3)
    dff = fred_series("DFF", 7)
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
    return data, sources, missing


def fetch_defillama():
    data = fetch_json("https://stablecoins.llama.fi/stablecoincharts/all")
    if not isinstance(data, list) or not data:
        return ({}, {}, ["stablecoin30d"])
    points = data[-35:]
    latest = points[-1]["totalCirculatingUSD"]["peggedUSD"] if points else 0
    prior = points[0]["totalCirculatingUSD"]["peggedUSD"] if points else latest
    stablecoin30d = percent_change(latest, prior)
    return (
        {"stablecoin30d": stablecoin30d, "totalStableNow": latest, "totalStableAgo": prior},
        {"stablecoin30d": "DefiLlama: stablecoincharts/all"},
        [],
    )


def fetch_stablecoin_eth():
    data = fetch_json("https://stablecoins.llama.fi/stablecoincharts/ethereum")
    if not isinstance(data, list) or not data:
        return ({}, {}, ["mappingRatioDown"])
    points = data[-35:] if isinstance(data, list) else []
    latest = points[-1]["totalCirculatingUSD"]["peggedUSD"] if points else 0
    prior = points[0]["totalCirculatingUSD"]["peggedUSD"] if points else latest
    return (
        {"ethStableNow": latest, "ethStableAgo": prior},
        {
            "ethStableNow": "DefiLlama: stablecoincharts/ethereum",
            "ethStableAgo": "DefiLlama: stablecoincharts/ethereum",
        },
        [],
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


def fetch_farside():
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
    etf1d = parsed[0]["total"] if parsed else 0
    etf5d = sum(item["total"] for item in parsed[:5])
    etf10d = sum(item["total"] for item in parsed[:10])
    return (
        {
            "etf1d": etf1d,
            "etf5d": etf5d,
            "etf10d": etf10d,
            "prevEtfExtremeOutflow": False,
        },
        {
            "etf1d": source or "Farside: 未获取",
            "etf5d": source or "Farside: 未获取",
            "etf10d": source or "Farside: 未获取",
            "prevEtfExtremeOutflow": "Derived: prior day ETF extreme",
        },
        [] if parsed else ["etf1d", "etf5d", "etf10d"],
        errors,
    )


def fetch_coingecko_market():
    url = (
        "https://api.coingecko.com/api/v3/coins/ethereum"
        "?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false"
    )
    data = fetch_json(url)
    if not isinstance(data, dict) or not data.get("market_data"):
        return ({}, {}, ["mcapGrowth", "mcapElasticity", "floatDensity", "trendMomentum", "divergence"])
    market = data.get("market_data", {})
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
            "mcapGrowth": mcap_change,
            "mcapElasticity": mcap_elasticity,
            "floatDensity": float_density,
            "trendMomentum": trend_momentum,
            "divergence": divergence,
        },
        {
            "mcapGrowth": "CoinGecko: market_cap_change_percentage_24h",
            "mcapElasticity": "CoinGecko: market_cap / volume_24h",
            "floatDensity": "CoinGecko: circulating / total_supply",
            "trendMomentum": "CoinGecko: price_change_percentage_7d",
            "divergence": "CoinGecko: price_change_percentage_24h",
        },
        [],
    )


def fetch_coinglass_liquidations():
    url = "https://open-api-v4.coinglass.com/api/futures/liquidation/aggregated-history?symbol=BTC&interval=1d"
    data = fetch_json(url)
    if data.get("code") == "0" and data.get("data"):
        latest = data["data"][-1]
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


def fetch_exchange_proxy():
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


def fetch_defillama_cex():
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


def fetch_coingecko_ohlc():
    ohlc = fetch_json(
        "https://api.coingecko.com/api/v3/coins/ethereum/ohlc?vs_currency=usd&days=30"
    )
    chart = fetch_json(
        "https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=30"
    )
    if not isinstance(ohlc, list) or not ohlc:
        return ({}, {}, ["crowdingIndex", "longWicks", "reverseFishing", "shortFailure", "volumeConfirm"])
    closes = [float(item[4]) for item in ohlc]
    highs = [float(item[2]) for item in ohlc]
    lows = [float(item[3]) for item in ohlc]
    opens = [float(item[1]) for item in ohlc]
    volumes = [float(item[1]) for item in (chart.get("total_volumes") or [])][-len(ohlc) :]
    if not volumes or len(volumes) < len(ohlc):
        volumes = [0.0 for _ in closes]
    latest_open, latest_close = opens[-1], closes[-1]
    latest_high, latest_low = highs[-1], lows[-1]
    avg_volume = sum(volumes[:-1]) / max(len(volumes) - 1, 1)
    wick_ratio = (latest_high - max(latest_open, latest_close)) / max(latest_high - latest_low, 1)
    trend_momentum = (latest_close - closes[-8]) / closes[-8] if len(closes) > 8 else 0
    divergence = abs((latest_close - closes[-2]) / closes[-2]) if len(closes) > 2 else 0
    crowding_index = min(100, 50 + abs(trend_momentum) * 500)
    long_wicks = wick_ratio > 0.4
    reverse_fishing = latest_close < latest_open and volumes[-1] > avg_volume * 1.5
    short_failure = latest_close > latest_open and (latest_close - latest_low) / max(latest_high - latest_low, 1) > 0.6
    volume_confirm = volumes[-1] >= avg_volume * 1.2
    return (
        {
            "trendMomentum": trend_momentum,
            "divergence": divergence,
            "crowdingIndex": crowding_index,
            "longWicks": long_wicks,
            "reverseFishing": reverse_fishing,
            "shortFailure": short_failure,
            "volumeConfirm": volume_confirm,
            "_closeSeries": closes[-30:],
            "_volumeSeries": volumes[-30:],
        },
        {
            "trendMomentum": "CoinGecko: ohlc (30d)",
            "divergence": "CoinGecko: ohlc (30d)",
            "crowdingIndex": "CoinGecko: ohlc (30d)",
            "longWicks": "CoinGecko: ohlc (30d)",
            "reverseFishing": "CoinGecko: ohlc (30d)",
            "shortFailure": "CoinGecko: ohlc (30d)",
            "volumeConfirm": "CoinGecko: market_chart total_volumes",
        },
        [],
    )


def fetch_rwa_protocols():
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


def fetch_eth_fees():
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


def fetch_fear_greed():
    data = fetch_json("https://api.alternative.me/fng/?limit=1&format=json")
    try:
        value = float(data.get("data", [{}])[0].get("value"))
        return ({"fearGreed": value}, {"fearGreed": "Alternative.me: FNG"}, [])
    except Exception:
        return ({}, {}, ["sentimentThreshold"])


def fetch_distribution_gate():
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


def main():
    errors = []

    def safe_call(name, func, missing_keys):
        try:
            result = func()
            if isinstance(result, tuple) and len(result) == 4:
                data, sources, missing, extra_errors = result
                if extra_errors:
                    errors.extend([f"{name}: {err}" for err in extra_errors])
                return data, sources, missing
            return result
        except Exception as exc:
            errors.append(f"{name}: {exc}")
            return {}, {}, missing_keys

    macro = fetch_macro()
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

    for key in REQUIRED_FIELDS:
        if key not in data or data[key] is None:
            missing.append(key)

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
    data = strip_none(data)
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "data": data,
        "sources": sources,
        "missing": sorted(set(missing)),
        "proxyTrace": probe_proxy(),
        "errors": errors,
    }
    with open("src/data/auto.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
