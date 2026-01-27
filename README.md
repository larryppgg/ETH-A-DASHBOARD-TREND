# ETH-A Dashboard Trend

本项目为本地可运行的仪表盘看板，支持公开源自动抓取（需 FRED API Key）与手动输入，具备可审计明细。

## 本地运行
方式一（推荐）：
```
npm run dev
```
然后访问 `http://localhost:5173`。

若只更新数据：
```
npm run fetch
```

方式二：
```
bash scripts/dev.sh
```

## 测试
```
npm test
```

## 说明
- 若直接双击 `src/index.html`，浏览器会阻止模块加载，因此页面将提示使用本地服务器。
- 需求与规则说明在 `docs/specs/eth-a-dashboard-trend/`。
- 自动抓取使用 FRED + DefiLlama（稳定币与 CEX 储备）+ Farside（ETF 流入）+ CoinGecko（市场）+ Binance（K 线/成交量）+ Coinglass（全市场清算）。
- 点击“今日运行”若没有本地输入，会先执行自动抓取再运行。
- 数据台新增“数据覆盖矩阵”，可审计字段值与来源。

## AI 解读（自动生成）
1. 复制 `.env.example` 为 `.env` 并填写豆包 API Key。\n
2. 运行 `npm run dev` 后页面会显示 AI 状态。\n
3. 运行成功后会自动生成“AI 解读”。\n

提示：不会在仓库内保存密钥，请只保存在本地 `.env`。
