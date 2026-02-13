#!/usr/bin/env python3
import argparse
import json
import os
from datetime import datetime, timezone


def build_seed_payload(
    *,
    as_of_date,
    bitfinex_points,
    coingecko_by_date=None,
    diff_threshold=0.015,
):
    """Build an ETH daily close/volume seed payload.

    This is a pure function for unit testing; callers fetch and provide the points/maps.
    """
    coingecko_by_date = coingecko_by_date or {}
    points = []
    for item in bitfinex_points or []:
        if not isinstance(item, dict):
            continue
        date_key = item.get("date")
        close = item.get("close")
        volume = item.get("volume")
        if not isinstance(date_key, str):
            continue
        try:
            close_val = float(close)
            volume_val = float(volume) if volume is not None else 0.0
        except Exception:
            continue
        points.append({"date": date_key, "close": close_val, "volume": volume_val})

    points.sort(key=lambda p: p["date"])
    by_date = {p["date"]: {"close": p["close"], "volume": p["volume"]} for p in points}

    errors = []
    for p in points:
        cg_close = coingecko_by_date.get(p["date"])
        try:
            cg_close_val = float(cg_close) if cg_close is not None else None
        except Exception:
            cg_close_val = None
        if cg_close_val is None or cg_close_val <= 0:
            continue
        diff = abs(p["close"] - cg_close_val) / cg_close_val
        if diff > diff_threshold:
            errors.append(
                f"price diff>{diff_threshold:.3f}: {p['date']} bitfinex={p['close']:.2f} coingecko={cg_close_val:.2f} diff={diff:.3%}"
            )

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "asOfDate": as_of_date,
        "source": "Bitfinex candles (primary) + CoinGecko cross-check",
        "series": points,
        "byDate": by_date,
        "errors": errors,
    }


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Generate eth.price.seed.json (daily close/volume).")
    parser.add_argument("--as-of", dest="as_of", default=None, help="as-of date YYYY-MM-DD (default: today)")
    parser.add_argument("--days", dest="days", type=int, default=365, help="window days (default: 365)")
    parser.add_argument(
        "--output",
        dest="output",
        default=os.path.join("src", "data", "eth.price.seed.json"),
        help="output path (default: src/data/eth.price.seed.json)",
    )
    parser.add_argument(
        "--diff-threshold",
        dest="diff_threshold",
        type=float,
        default=0.015,
        help="cross-check diff threshold ratio (default: 0.015 = 1.5%)",
    )
    return parser.parse_args(argv)


def load_coingecko_close_map(collector, days=365):
    # CoinGecko OHLC supports up to 365 days; we only use it as a cross-check.
    raw = collector.fetch_json(
        f"https://api.coingecko.com/api/v3/coins/ethereum/ohlc?vs_currency=usd&days={days}"
    )
    if not isinstance(raw, list):
        return {}
    out = {}
    for item in raw:
        try:
            date_key = collector.date_key_from_ts(item[0] / 1000)
            close = float(item[4])
        except Exception:
            continue
        if not date_key:
            continue
        out[date_key] = close
    return out


def main(argv=None):
    args = parse_args(argv)
    import scripts.collector as collector

    as_of = args.as_of or collector.today_key()
    candles = collector.fetch_bitfinex_candles_window(as_of, days=max(2, int(args.days or 365)))
    # fetch_bitfinex_candles_window returns desc; normalize to payload form here.
    bitfinex_points = [{"date": p.get("date"), "close": p.get("close"), "volume": p.get("volume")} for p in candles]

    cg_map = load_coingecko_close_map(collector, days=365)
    payload = build_seed_payload(
        as_of_date=as_of,
        bitfinex_points=bitfinex_points,
        coingecko_by_date=cg_map,
        diff_threshold=args.diff_threshold,
    )

    out_path = args.output
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fp:
        json.dump(payload, fp, ensure_ascii=False, indent=2)

    print(f"eth price seed written: {out_path} days={len(payload.get('series') or [])} errors={len(payload.get('errors') or [])}")


if __name__ == "__main__":
    main()

