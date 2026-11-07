# Rate Monitor

多平台借贷与活期利率看板。支持 Binance 和 Bitget 的 BTC 抵押 / USDC、USDT 活期借款，以及 Binance USDC、USDT Simple Earn Flexible。

- 网页：https://smallyunet.github.io/rate-monitor/
- Worker：https://rate-monitor-api.smallyu.workers.dev
- 本地目录：`/Users/smallyu/work/github/rate-monitor`

## 工作方式

GitHub Pages 静态网页 → Cloudflare Worker → Binance 官方签名接口 + Bitget 官方公开市场接口。

打开页面或手动刷新时获取数据。不运行定时采样，不存储账户或历史数据，不请求持仓、余额，不执行交易。GitHub Actions 仅检查代码、构建和部署 Pages。

## 配置密钥

在 Cloudflare Dashboard → Workers & Pages → `rate-monitor-api` → Settings → Variables and Secrets，添加以下 **Secret**，保存部署：

- `BINANCE_API_KEY`
- `BINANCE_API_SECRET`（HMAC 类型密钥）

使用专用只读密钥，无需开启交易或提现权限。不要将密钥写入前端、仓库、Actions 构建参数或公开日志。Binance 的地区、账户产品权限和 IP 限制仍然适用；配置前页面显示“等待配置密钥”。Cloudflare Worker 没有固定出口 IP，不适合依赖固定 IP 白名单的密钥，遇到该限制需另选固定出口。

没有密钥时部署可用，但无法查询实际利率。2026-11-07 已在配置密钥的线上 Worker 验证四项产品查询成功；Loan 使用当前报价作为 APR。

## 连接故障排查

2026-11-07 修复了 Worker 入口把 Cloudflare 第三个参数 `ExecutionContext` 当作测试用 fetch 函数的问题。入口现在只将 request 和 env 传入业务处理函数，测试覆盖真实的三参数调用方式。

线上公开时间接口探测表明，`api.binance.com` 对该 Worker 返回 HTTP 403，而 Binance 官方备用端点 `api-gcp.binance.com` 返回 200；查询已切换到后者，并验证 Loan 和两项 Earn 签名请求成功。端点说明：[Binance 官方文档](https://developers.binance.com/en/docs/products/spot/rest-api)。

`GET /health?check=binance` 可比较这两个固定官方端点的公开接口连通性，不携带密钥。产品查询错误会保留数值型 HTTP 状态和 Binance 错误码，不返回原始错误正文、签名 URL 或账户信息。

## 数据口径

- Earn：`GET /sapi/v1/simple-earn/flexible/list`，分别查询 USDC、USDT。基础年化来自 `latestAnnualPercentageRate`；`tierAnnualPercentageRate` 为各额度区间的额外加息。页面按区间显示基础 APR + 加息的总 APR，超出额度部分显示基础 APR；输入金额后按每档覆盖的金额加权计算 Effective APR。金额为空或无效时不显示综合值；区间无法解析或重叠时不推测结果。金额输入仅在浏览器计算，不触发平台请求，刷新利率时保留。返回多个同币产品时标记待确认。
- Loan 当前 APR：`GET /sapi/v2/loan/flexible/loanable/data`，分别查询 `loanCoin=USDC`、`loanCoin=USDT`，直接读取 `flexibleInterestRate` 年化小数。2026-11-07 已用 Binance 官方 [Flexible Loan 市场页](https://www.binance.com/en/flexible-loan) 的 Annually Interest Rate 列核对单位：API 约 `0.05368` 对应页面约 `5.368%`，USDT 页面约 `5.8474%`（报价会随时间变化）。不乘小时数，也不转换成复利 APY。
- 旧版 APR 为空的原因：只从最近一小时的历史接口读取年化参考，而历史返回空列表；当前报价虽已返回，却未用于 APR。现已去掉历史依赖及对应查询，直接展示当前 APR。
- BTC 抵押资格及初始/清算 LTV：`GET /sapi/v2/loan/flexible/collateral/data?collateralCoin=BTC`。这只说明资产资格，不保证特定账户能成功借款。
- 利率统一以 APR 小数存储，前端乘 100 展示百分比。零值有效，缺失值无效。APR 不等于 APY。
- 每个产品独立报告成功、失败或未配置；接口异常不影响其他产品。刷新前清除旧报价，不把旧数据当作实时值。
- Worker 和前端均禁用响应缓存，无自动轮询；单次刷新内部串行签名请求、间隔至少 1.1 秒。多用户请求仍可能触发平台限流，页面会显示相应状态。

## Bitget

- `GET https://api.bitget.com/api/v3/loan/coins`，每次页面刷新只请求一次，同时提取 USDC、USDT 的 `rateFlexible` 和 BTC 抵押资格、LTV。
- `rateFlexible` 按年化小数处理，例如 `0.062` 显示为 `6.20%`。不使用 `rate7D`、`rate30D` 固定期利率替代活期数据。
- 当前匿名请求可用，不需要配置 Bitget 密钥。该请求不携带 Binance 密钥或任何用户信息。
- 线上 Worker 出口访问 Bitget 返回 HTTP 403；官方公开接口允许跨域（`Access-Control-Allow-Origin: *`）。因此网页在 Worker 查询失败时回退到浏览器直连官方接口，明确使用 `credentials: omit`。浏览器网络也受限时显示错误，不填充旧报价。此回退只在页面打开/手动刷新时触发一次，不定时采样。
- 一个币种缺失不影响另一个；Bitget 接口故障不影响 Binance，反之亦然。缺失利率显示不可用，绝不当作零。
- 官方文档：[Get Loan Coins](https://www.bitget.com/docs/catalog/crypto-loans/crypto-loans)。文档标有 UTA read 权限；若未来停止匿名访问，页面会显示错误，需再评估只读认证。

## 本地检查与部署

Node.js 20+，无运行依赖。以下命令不会启动浏览器：

```sh
npm run check
npm test
npm run build
```

`web/` 为网页源文件，`dist/` 为构建产物。推送 `main` 后，GitHub Actions 自动发布 Pages。

Worker 的源代码是 `worker/index.js`（单文件 ES module）。可在 Cloudflare 的 Edit code 中替换后 Deploy，或在已登录的 Wrangler 环境执行 `npx wrangler deploy`。`wrangler.jsonc` 保留了服务名与允许的前端 Origin。Worker 当前不通过 Actions 自动部署，修改 Worker 后需单独部署。

## API 与扩展

- `GET /health`：服务状态和是否已配置密钥，不返回密钥。
- `GET /api/rates`：按需查询六项产品，返回 `mode: on-demand`、产品状态、时间及公开利率字段。
- API 只有固定查询路由；不接受调用者传入任意 Binance 路径、账户、币种或签名参数。
- 允许浏览器 Origin 默认为 `https://smallyunet.github.io`，可用 Worker 文本变量 `ALLOWED_ORIGIN` 修改。CORS 是浏览器限制，不等于用户认证。API 公开展示产品利率；如流量增加，应在 Cloudflare 配置限流。
- 新增平台时添加对应的采集适配器，再扩充产品描述与页面分组；保持统一的 `platform / kind / asset / apr / status / fetchedAt` 字段。

官方文档：[Binance Loan](https://developers.binance.com/en/docs/catalog/investment-and-services-crypto-loan/api/rest-api/flexible-rate)、[Binance Earn](https://developers.binance.com/en/docs/catalog/investment-and-services-simple-earn/api/rest-api/flexible-locked)。

## 图标

`web/icons/` 中 Binance（BNB 标志）、BTC、USDT、USDC SVG 来自 [cryptocurrency-icons](https://github.com/spothq/cryptocurrency-icons)，随仓库保存许可文件 `web/icons/LICENSE.md`。页面使用本地图标，不依赖第三方图片请求。

Bitget 图标来自 [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Logo_Bitget.svg)，源自 Bitget 官方品牌 SVG；仅裁切视图保留独立标志，形状与颜色不变。该文件在 Commons 标注为 PD-textlogo，商标归原品牌所有。
