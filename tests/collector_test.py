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
            patch("scripts.collector.fetch_defillama_cex", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_coingecko_ohlc", return_value=({}, {}, [])), \
            patch("scripts.collector.fetch_exchange_proxy") as proxy, \
            patch("builtins.open", mock_open()):
            collector.main()

        self.assertFalse(proxy.called, "不应调用估算型 exchange_proxy")

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
            data, sources, missing = collector.fetch_coingecko_market()
        self.assertIn("ethSpotPrice", data, "应返回 ETH 现货价格")
        self.assertEqual(data.get("ethSpotPrice"), 2100)

    def test_should_disable_cache(self):
        self.assertTrue(server.should_disable_cache("/app.js"), "js 应禁止缓存")
        self.assertTrue(server.should_disable_cache("/styles.css"), "css 应禁止缓存")
        self.assertTrue(server.should_disable_cache("/data/auto.json"), "json 应禁止缓存")
        self.assertTrue(server.should_disable_cache("/ui/render.js?v=1"), "带参数的 js 也应禁止缓存")
        self.assertFalse(server.should_disable_cache("/image.png"), "非文本资源可缓存")

if __name__ == "__main__":
    unittest.main()
