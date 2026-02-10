import os
import sys
import unittest
import warnings
from unittest.mock import patch, mock_open
from urllib.error import HTTPError

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import scripts.collector as collector
import scripts.server as server


class TestCollectorFetchJson(unittest.TestCase):
    def test_fetch_json_returns_empty_on_http_error(self):
        def raise_http(*_args, **_kwargs):
            raise HTTPError("http://example.com", 400, "Bad Request", {}, None)

        with warnings.catch_warnings():
            warnings.simplefilter("ignore", ResourceWarning)
            with patch("urllib.request.urlopen", raise_http):
                data = collector.fetch_json("http://example.com")

        self.assertEqual(data, {}, "HTTPError 应返回空对象，避免中断采集")

    def test_main_skips_exchange_proxy(self):
        with patch("scripts.collector.fetch_macro", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_defillama", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_farside", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_coingecko_market", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_coinglass_liquidations", return_value=({}, {}, [])), \
            patch(
                "scripts.collector.fetch_defillama_cex",
                return_value=({"exchBalanceTrend": 1, "exchStableDelta": 2}, {}, []),
            ), \
            patch("scripts.collector.fetch_coingecko_ohlc", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_exchange_proxy") as proxy, \
            patch("builtins.open", mock_open()):
            collector.main()

        self.assertFalse(proxy.called, "不应调用估算型 exchange_proxy")

    def test_cex_fallback_exchange_proxy_when_missing(self):
        captured = {}

        def fake_dump(payload, _fp, ensure_ascii=False, indent=2):
            captured.update(payload)

        with patch("scripts.collector.fetch_macro", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_defillama", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_farside", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_coingecko_market", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_coinglass_liquidations", return_value=({}, {}, [])), \
            patch(
                "scripts.collector.fetch_defillama_cex",
                return_value=({}, {}, ["exchBalanceTrend", "exchStableDelta"]),
            ), \
            patch(
                "scripts.collector.fetch_exchange_proxy",
                return_value=(
                    {"exchBalanceTrend": 3, "exchStableDelta": 4},
                    {"exchBalanceTrend": "proxy", "exchStableDelta": "proxy"},
                    [],
                ),
            ), \
            patch("scripts.collector.fetch_coingecko_ohlc", return_value=({}, {}, [])), \
            patch("builtins.open", mock_open()), \
            patch("json.dump", fake_dump):
            collector.main()

        self.assertIn("exchBalanceTrend", captured.get("data", {}), "CEX 缺失时应回退 proxy")
        self.assertIn("exchStableDelta", captured.get("data", {}), "CEX 缺失时应回退 proxy")
        self.assertNotIn("exchBalanceTrend", captured.get("missing", []), "回退后不应仍缺")
        self.assertNotIn("exchStableDelta", captured.get("missing", []), "回退后不应仍缺")

    def test_parse_farside_table(self):
        sample = (
            "| Date | Total |\n"
            "| --- | --- |\n"
            "| 2025-01-01 00:00 | 10 |\n"
            "| 2025-01-02 00:00 | (5) |\n"
        )
        parsed = collector.parse_farside_table(sample)
        self.assertEqual(len(parsed), 2)
        self.assertEqual(parsed[0]["total"], -5.0)

    def test_farside_fallback_jina(self):
        cloudflare = "<title>Just a moment...</title>"
        jina_text = (
            "Markdown Content:\\n"
            "| Date | Total |\\n"
            "| --- | --- |\\n"
            "| 07 Jan 2026 | (98.3) |\\n"
            "| 08 Jan 2026 | 10.0 |\\n"
        )

        def fake_fetch(url):
            if url.startswith("https://r.jina.ai/"):
                return jina_text
            return cloudflare

        def fake_parse(text):
            if "Markdown Content" in text:
                return [{"date": "08 Jan 2026", "total": 10.0}]
            return []

        with patch("scripts.collector.fetch_text", side_effect=fake_fetch):
            with patch("scripts.collector.parse_farside_table", side_effect=fake_parse):
                parsed, source, errors = collector.fetch_farside_source(
                    "https://farside.co.uk/ethereum-etf-flow/",
                    "Farside: ethereum-etf-flow",
                )
        self.assertTrue(parsed, "回退 Jina 应解析到数据")
        self.assertIn("Jina", source or "", "来源应标记 Jina")
        self.assertTrue(errors, "应记录 direct 被阻断的信息")

    def test_parse_coinglass_html(self):
        html = "total liquidations comes in at $12.5M"
        with patch("scripts.collector.fetch_json", return_value={}):
            with patch("scripts.collector.fetch_text", return_value=html):
                data, sources, missing = collector.fetch_coinglass_liquidations()
        self.assertEqual(missing, [])
        self.assertEqual(int(data.get("liquidationUsd", 0)), 12500000)

    def test_fred_csv_fallback(self):
        csv = "DATE,VALUE\n2025-01-01,1.1\n2025-01-02,1.2\n"
        with patch("scripts.collector.fetch_json", return_value={}):
            with patch("scripts.collector.fetch_text", return_value=csv):
                values = collector.fred_series("DUMMY", 2)
        self.assertEqual(len(values), 2)
        self.assertEqual(values[0]["value"], 1.2)

    def test_errors_list(self):
        captured = {}
        def fake_dump(payload, _fp, ensure_ascii=False, indent=2):
            captured.update(payload)
        with patch("scripts.collector.fetch_defillama", side_effect=RuntimeError("fail")):
            with patch("scripts.collector.fetch_farside", return_value=({}, {}, [])):
                with patch("scripts.collector.fetch_coingecko_market", return_value=({}, {}, [])):
                    with patch("scripts.collector.fetch_coinglass_liquidations", return_value=({}, {}, [])):
                        with patch("scripts.collector.fetch_defillama_cex", return_value=({}, {}, [])):
                            with patch("scripts.collector.fetch_coingecko_ohlc", return_value=({}, {}, [])):
                                with patch("builtins.open", mock_open()):
                                    with patch("json.dump", fake_dump):
                                        collector.main()
        self.assertTrue(captured.get("errors"), "errors 列表应记录异常")

    def test_index_for_date(self):
        series = [
            {"date": "2026-01-05", "value": 1},
            {"date": "2026-01-04", "value": 2},
            {"date": "2026-01-02", "value": 3},
        ]
        idx = collector.index_for_date(series, "2026-01-03")
        self.assertEqual(idx, 2, "目标日期应落在最近的历史日期")

    def test_eth_spot_price_present(self):
        payload = {
            "market_data": {
                "current_price": {"usd": 2100},
                "market_cap": {"usd": 300000000000},
                "total_volume": {"usd": 20000000000},
                "market_cap_change_percentage_24h": 1.2,
                "circulating_supply": 120000000,
                "total_supply": 120000000,
                "price_change_percentage_7d": 2,
                "price_change_percentage_24h": 1,
            }
        }
        with patch("scripts.collector.fetch_json", return_value=payload):
            data, sources, missing, _meta = collector.fetch_coingecko_market()
        self.assertIn("ethSpotPrice", data, "应返回 ETH 现货价格")
        self.assertEqual(data.get("ethSpotPrice"), 2100)

    def test_should_disable_cache(self):
        self.assertTrue(server.should_disable_cache("/app.js"), "js 应禁止缓存")
        self.assertTrue(server.should_disable_cache("/styles.css"), "css 应禁止缓存")
        self.assertTrue(server.should_disable_cache("/data/auto.json"), "json 应禁止缓存")
        self.assertTrue(server.should_disable_cache("/ui/render.js?v=1"), "带参数的 js 也应禁止缓存")
        self.assertFalse(server.should_disable_cache("/image.png"), "非文本资源可缓存")

    def test_payload_contains_field_updated_at(self):
        captured = {}

        def fake_dump(payload, _fp, ensure_ascii=False, indent=2):
            captured.update(payload)

        with patch("scripts.collector.fetch_macro", return_value=({"dxy5d": 1.2}, {"dxy5d": "FRED: DTWEXBGS"}, [])), \
            patch("scripts.collector.fetch_defillama", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_stablecoin_eth", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_farside", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_coingecko_market", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_coinglass_liquidations", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_defillama_cex", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_coingecko_ohlc", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_rwa_protocols", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_eth_fees", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_fear_greed", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_distribution_gate", return_value=({}, {}, [])), \
            patch("scripts.collector.probe_proxy", return_value=[]), \
            patch("builtins.open", mock_open()), \
            patch("json.dump", fake_dump):
            collector.main(["--date", "2026-02-01"])

        self.assertIn("fieldUpdatedAt", captured, "payload 应包含字段级更新时间")
        self.assertIn("dxy5d", captured.get("fieldUpdatedAt", {}), "字段级更新时间应覆盖已有字段")

    def test_payload_contains_observed_and_fetched_at(self):
        captured = {}

        def fake_dump(payload, _fp, ensure_ascii=False, indent=2):
            captured.update(payload)

        with patch("scripts.collector.fetch_macro", return_value=({"dxy5d": 1.0}, {"dxy5d": "FRED: DTWEXBGS"}, [])), \
            patch("scripts.collector.fetch_defillama", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_stablecoin_eth", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_farside", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_coingecko_market", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_coinglass_liquidations", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_defillama_cex", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_coingecko_ohlc", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_rwa_protocols", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_eth_fees", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_fear_greed", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_distribution_gate", return_value=({}, {}, [])), \
            patch("scripts.collector.probe_proxy", return_value=[]), \
            patch("builtins.open", mock_open()), \
            patch("json.dump", fake_dump):
            collector.main(["--date", "2026-02-01"])

        self.assertIn("fieldObservedAt", captured, "payload 应包含字段观测时间")
        self.assertIn("fieldFetchedAt", captured, "payload 应包含字段抓取时间")
        self.assertIn("dxy5d", captured.get("fieldObservedAt", {}), "字段观测时间应覆盖已有字段")
        self.assertIn("dxy5d", captured.get("fieldFetchedAt", {}), "字段抓取时间应覆盖已有字段")

    def test_field_observed_at_prefers_overrides(self):
        captured = {}

        def fake_dump(payload, _fp, ensure_ascii=False, indent=2):
            captured.update(payload)

        override_stamp = "2026-01-30T00:00:00Z"
        with patch(
            "scripts.collector.fetch_macro",
            return_value=(
                {"dxy5d": 1.0},
                {"dxy5d": "FRED: DTWEXBGS"},
                [],
                {"observedAt": {"dxy5d": override_stamp}},
            ),
        ), patch("scripts.collector.fetch_defillama", return_value=({}, {}, [])), patch(
            "scripts.collector.fetch_stablecoin_eth", return_value=({}, {}, [])
        ), patch("scripts.collector.fetch_farside", return_value=({}, {}, [], [])), patch(
            "scripts.collector.fetch_coingecko_market", return_value=({}, {}, [])
        ), patch("scripts.collector.fetch_coinglass_liquidations", return_value=({}, {}, [])), patch(
            "scripts.collector.fetch_defillama_cex", return_value=({}, {}, [])
        ), patch("scripts.collector.fetch_coingecko_ohlc", return_value=({}, {}, [])), patch(
            "scripts.collector.fetch_rwa_protocols", return_value=({}, {}, [])
        ), patch("scripts.collector.fetch_eth_fees", return_value=({}, {}, [])), patch(
            "scripts.collector.fetch_fear_greed", return_value=({}, {}, [])
        ), patch("scripts.collector.fetch_distribution_gate", return_value=({}, {}, [])), patch(
            "scripts.collector.probe_proxy", return_value=[]
        ), patch("builtins.open", mock_open()), patch("json.dump", fake_dump):
            collector.main(["--date", "2026-02-01"])

        self.assertEqual(
            captured.get("fieldObservedAt", {}).get("dxy5d"),
            override_stamp,
            "fieldObservedAt 应优先使用观测时间 override",
        )

    def test_load_proxy_candidates_includes_direct_and_env(self):
        with patch.dict(os.environ, {"PROXY_PRIMARY": "http://127.0.0.1:7890"}, clear=True):
            candidates = collector.load_proxy_candidates()
        self.assertIn("direct", candidates, "代理候选必须包含 direct")
        self.assertIn("http://127.0.0.1:7890", candidates, "代理候选应读取 PROXY_PRIMARY")

    def test_fetch_macro_emits_observed_at(self):
        base_dates = [
            "2026-02-01",
            "2026-01-31",
            "2026-01-30",
            "2026-01-29",
            "2026-01-28",
            "2026-01-27",
            "2026-01-26",
        ]

        def series_for(series_id):
            if series_id in ("DTWEXBGS", "DGS2", "RRPONTSYD", "WTREGEN", "SRFTRD"):
                return [{"date": d, "value": float(i + 1)} for i, d in enumerate(base_dates)]
            if series_id == "NFCI":
                return [{"date": d, "value": float(i)} for i, d in enumerate(base_dates[:3])]
            if series_id in ("NAPM", "DFF"):
                return [{"date": d, "value": float(i)} for i, d in enumerate(base_dates[:3])]
            return []

        with patch("scripts.collector.fred_series", side_effect=lambda sid, *_args, **_kwargs: series_for(sid)):
            data, sources, missing, meta = collector.fetch_macro("2026-02-01")

        self.assertIn("observedAt", meta, "fetch_macro 应返回 observedAt 元信息")
        self.assertEqual(
            meta.get("observedAt", {}).get("dxy5d"),
            "2026-02-01T00:00:00Z",
            "宏观字段观测时间应来自真实观测日期",
        )

    def test_backfill_from_previous_fills_missing_when_not_stale(self):
        payload = {
            "generatedAt": "2026-02-08T12:00:00Z",
            "targetDate": None,
            "data": {"stablecoin30d": None},
            "sources": {},
            "fieldObservedAt": {},
            "fieldFetchedAt": {},
            "fieldUpdatedAt": {},
            "missing": ["stablecoin30d"],
            "errors": [],
        }
        previous = {
            "generatedAt": "2026-02-07T12:00:00Z",
            "targetDate": None,
            "data": {"stablecoin30d": 1.23},
            "sources": {"stablecoin30d": "DefiLlama"},
            "fieldObservedAt": {"stablecoin30d": "2026-02-07T00:00:00Z"},
            "fieldFetchedAt": {"stablecoin30d": "2026-02-07T12:00:00Z"},
            "fieldUpdatedAt": {"stablecoin30d": "2026-02-07T00:00:00Z"},
            "missing": [],
            "errors": [],
        }
        filled = collector.backfill_from_previous(payload, previous, as_of_date="2026-02-08")
        self.assertIn("stablecoin30d", filled, "应回填缺失字段")
        self.assertEqual(payload.get("data", {}).get("stablecoin30d"), 1.23, "应写入缺失字段值")
        self.assertNotIn("stablecoin30d", payload.get("missing", []), "回填后不应仍缺")
        self.assertTrue(payload.get("errors"), "回填应记录 errors 提示")

    def test_backfill_from_previous_skips_stale(self):
        payload = {
            "generatedAt": "2026-02-08T12:00:00Z",
            "targetDate": None,
            "data": {"stablecoin30d": None},
            "sources": {},
            "fieldObservedAt": {},
            "fieldFetchedAt": {},
            "fieldUpdatedAt": {},
            "missing": ["stablecoin30d"],
            "errors": [],
        }
        previous = {
            "generatedAt": "2025-12-01T12:00:00Z",
            "targetDate": None,
            "data": {"stablecoin30d": 9.99},
            "sources": {"stablecoin30d": "DefiLlama"},
            "fieldObservedAt": {"stablecoin30d": "2025-12-01T00:00:00Z"},
            "fieldFetchedAt": {"stablecoin30d": "2025-12-01T12:00:00Z"},
            "fieldUpdatedAt": {"stablecoin30d": "2025-12-01T00:00:00Z"},
            "missing": [],
            "errors": [],
        }
        filled = collector.backfill_from_previous(payload, previous, as_of_date="2026-02-08")
        self.assertEqual(filled, [], "过期字段不应回填")
        self.assertIsNone(payload.get("data", {}).get("stablecoin30d"), "过期字段不应写入")
        self.assertIn("stablecoin30d", payload.get("missing", []), "过期字段仍应标记缺失")

if __name__ == "__main__":
    unittest.main()
