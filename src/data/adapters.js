const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";

async function fetchFredSeries(seriesId, apiKey, limit = 10) {
  const url = new URL(FRED_BASE);
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", String(limit));
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`FRED ${seriesId} 获取失败`);
  }
  const data = await response.json();
  return data.observations
    .map((item) => ({ date: item.date, value: Number(item.value) }))
    .filter((item) => !Number.isNaN(item.value));
}

function percentChange(latest, previous) {
  if (previous === 0) return 0;
  return ((latest - previous) / previous) * 100;
}

function consecutiveUp(values, count) {
  if (values.length < count + 1) return false;
  for (let i = 0; i < count; i += 1) {
    if (values[i].value <= values[i + 1].value) return false;
  }
  return true;
}

function delta(values, offset = 5) {
  if (values.length <= offset) return 0;
  return values[0].value - values[offset].value;
}

export async function fetchMacroData(apiKey) {
  if (!apiKey) {
    throw new Error("缺少 FRED API Key");
  }
  const [dxy, dgs2, nfci, rrp, tga, ism] = await Promise.all([
    fetchFredSeries("DTWEXBGS", apiKey, 7),
    fetchFredSeries("DGS2", apiKey, 7),
    fetchFredSeries("NFCI", apiKey, 6),
    fetchFredSeries("RRPONTSYD", apiKey, 7),
    fetchFredSeries("WTREGEN", apiKey, 7),
    fetchFredSeries("NAPM", apiKey, 3),
  ]);

  const dxy5d = percentChange(dxy[0].value, dxy[5]?.value ?? dxy[dxy.length - 1].value);
  const dxy3dUp = consecutiveUp(dxy, 3);
  const current2y = dgs2[0]?.value ?? 0;
  const preMeeting2y = dgs2[2]?.value ?? current2y;
  const currentDxy = dxy[0]?.value ?? 0;
  const preMeetingDxy = dxy[2]?.value ?? currentDxy;
  const us2yWeekBp = (current2y - (dgs2[5]?.value ?? dgs2[dgs2.length - 1].value)) * 100;
  const fciUpWeeks = nfci[0].value > nfci[1]?.value ? (nfci[1]?.value > nfci[2]?.value ? 2 : 1) : 0;

  return {
    data: {
      dxy5d,
      dxy3dUp,
      us2yWeekBp,
      fciUpWeeks,
      policyWindow: false,
      preMeeting2y,
      current2y,
      preMeetingDxy,
      currentDxy,
      rrpChange: delta(rrp, 5),
      tgaChange: delta(tga, 5),
      srfChange: 0,
      ism: ism[0]?.value ?? 0,
    },
    sources: {
      dxy5d: "FRED: DTWEXBGS",
      dxy3dUp: "FRED: DTWEXBGS",
      us2yWeekBp: "FRED: DGS2",
      fciUpWeeks: "FRED: NFCI",
      policyWindow: "Manual",
      preMeeting2y: "FRED: DGS2 (t-2)",
      current2y: "FRED: DGS2 (latest)",
      preMeetingDxy: "FRED: DTWEXBGS (t-2)",
      currentDxy: "FRED: DTWEXBGS (latest)",
      rrpChange: "FRED: RRPONTSYD",
      tgaChange: "FRED: WTREGEN",
      srfChange: "待接入",
      ism: "FRED: NAPM",
    },
    missing: ["srfChange"],
  };
}

export async function fetchStablecoinData() {
  const response = await fetch("https://api.llama.fi/stablecoincharts/all");
  if (!response.ok) {
    throw new Error("DefiLlama 稳定币数据获取失败");
  }
  const data = await response.json();
  const points = data?.totalCirculating?.slice(-35) ?? [];
  const latest = points[points.length - 1]?.totalCirculatingUSD ?? 0;
  const prior = points[0]?.totalCirculatingUSD ?? latest;
  const stablecoin30d = percentChange(latest, prior);

  return {
    data: { stablecoin30d },
    sources: { stablecoin30d: "DefiLlama: stablecoincharts/all" },
    missing: [],
  };
}

function parseNumber(value) {
  if (!value) return 0;
  const normalized = value.replace(/[(),]/g, (match) => (match === "(" ? "-" : ""));
  const num = Number(normalized);
  return Number.isNaN(num) ? 0 : num;
}

function parseFarsideTable(raw) {
  const lines = raw.split("\n").filter((line) => line.trim().startsWith("|"));
  const rows = lines
    .slice(2)
    .map((line) => line.split("|").map((cell) => cell.trim()))
    .filter((cells) => cells.length > 3 && /\d{2}\s\w{3}\s\d{4}/.test(cells[1]));
  return rows.map((cells) => ({
    date: cells[1],
    total: parseNumber(cells[cells.length - 2] || "0"),
  }));
}

export async function fetchEtfData() {
  const response = await fetch("https://farside.co.uk/bitcoin-etf-flow/");
  if (!response.ok) {
    throw new Error("ETF 流入数据获取失败");
  }
  const text = await response.text();
  const rows = parseFarsideTable(text);
  if (!rows.length) {
    throw new Error("ETF 流入数据解析失败");
  }
  const sorted = rows.slice(-30).reverse();
  const latest = sorted[0]?.total ?? 0;
  const etf5d = sorted.slice(0, 5).reduce((sum, row) => sum + row.total, 0);
  const etf10d = sorted.slice(0, 10).reduce((sum, row) => sum + row.total, 0);
  const volumeConfirm = Math.abs(latest) >= 100;

  return {
    data: {
      etf1d: latest,
      etf5d,
      etf10d,
      volumeConfirm,
    },
    sources: {
      etf1d: "Farside: bitcoin-etf-flow",
      etf5d: "Farside: bitcoin-etf-flow",
      etf10d: "Farside: bitcoin-etf-flow",
      volumeConfirm: "Derived: ETF 1D threshold",
    },
    missing: [],
  };
}

export async function fetchCoinGeckoMarketData() {
  const url =
    "https://api.coingecko.com/api/v3/coins/ethereum?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false";
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("CoinGecko 市场数据获取失败");
  }
  const data = await response.json();
  const market = data.market_data || {};
  const marketCap = market.market_cap?.usd ?? 0;
  const volume24h = market.total_volume?.usd ?? 0;
  const mcapChange = (market.market_cap_change_percentage_24h ?? 0) / 100;
  const circulating = market.circulating_supply ?? 0;
  const totalSupply = market.total_supply ?? circulating || 1;
  const floatDensity = totalSupply ? circulating / totalSupply : 1;
  const trendMomentum = ((market.price_change_percentage_7d ?? 0) / 100 + 1) / 2;
  const divergence = Math.abs((market.price_change_percentage_24h ?? 0) / 100);
  const mcapElasticity = volume24h ? marketCap / volume24h : 0;

  return {
    data: {
      mcapGrowth: mcapChange,
      mcapElasticity,
      floatDensity,
      trendMomentum,
      divergence,
    },
    sources: {
      mcapGrowth: "CoinGecko: market_cap_change_percentage_24h",
      mcapElasticity: "CoinGecko: market_cap / volume_24h",
      floatDensity: "CoinGecko: circulating / total_supply",
      trendMomentum: "CoinGecko: price_change_percentage_7d",
      divergence: "CoinGecko: price_change_percentage_24h",
    },
    missing: [],
  };
}

export async function fetchBinanceLiquidations() {
  const url = new URL("https://fapi.binance.com/fapi/v1/allForceOrders");
  url.searchParams.set("limit", "1000");
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error("Binance 清算数据获取失败");
  }
  const data = await response.json();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const liquidationUsd = data
    .filter((item) => now - item.time <= dayMs)
    .reduce((sum, item) => sum + Number(item.avgPrice) * Number(item.origQty), 0);

  return {
    data: { liquidationUsd },
    sources: { liquidationUsd: "Binance Futures: allForceOrders (24h)" },
    missing: [],
  };
}

export async function fetchExchangeVolumeProxy() {
  const response = await fetch("https://api.coingecko.com/api/v3/exchanges/binance");
  if (!response.ok) {
    throw new Error("CoinGecko 交易所数据获取失败");
  }
  const data = await response.json();
  const volumeBtc = data.trade_volume_24h_btc ?? 0;
  const exchBalanceTrend = volumeBtc ? Math.log10(volumeBtc) / 10 : 0;
  const exchStableDelta = exchBalanceTrend;

  return {
    data: { exchBalanceTrend, exchStableDelta },
    sources: {
      exchBalanceTrend: "CoinGecko: binance trade_volume_24h_btc",
      exchStableDelta: "CoinGecko: binance trade_volume_24h_btc",
    },
    missing: [],
  };
}

export function mergeData(...blocks) {
  const data = {};
  const sources = {};
  const missing = new Set();
  blocks.forEach((block) => {
    Object.assign(data, block.data);
    Object.assign(sources, block.sources);
    block.missing.forEach((item) => missing.add(item));
  });
  return { data, sources, missing: Array.from(missing) };
}
