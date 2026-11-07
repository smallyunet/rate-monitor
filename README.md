# Rate Monitor

多平台借贷与活期利率看板。第一版支持 Binance Flexible Loan（BTC 抵押 / USDC 借款）及 USDC、USDT Simple Earn Flexible。

- 网页：https://smallyunet.github.io/rate-monitor/
- Worker：https://rate-monitor-api.smallyu.workers.dev
- 本地目录：`/Users/smallyu/work/github/rate-monitor`

## 工作方式

GitHub Pages 静态网页 → Cloudflare Worker → Binance 官方签名查询接口。

打开页面或手动刷新时获取数据。不运行定时采样，不存储账户或历史数据，不请求持仓、余额，不执行交易。GitHub Actions 仅检查代码、构建和部署 Pages。

## 配置密钥

在 Cloudflare Dashboard → Workers & Pages → `rate-monitor-api` → Settings → Variables and Secrets，添加以下 **Secret**，保存部署：

- `BINANCE_API_KEY`
- `BINANCE_API_SECRET`（HMAC 类型密钥）

使用专用只读密钥，无需开启交易或提现权限。不要将密钥写入前端、仓库、Actions 构建参数或公开日志。Binance 的地区、账户产品权限和 IP 限制仍然适用；配置前页面显示“等待配置密钥”。Cloudflare Worker 没有固定出口 IP，不适合依赖固定 IP 白名单的密钥，遇到该限制需另选固定出口。

没有密钥时部署可用，但尚不能验证实际利率、账户权限和 Binance 对 Worker 出口的可达性。

## 数据口径

- Earn：`GET /sapi/v1/simple-earn/flexible/list`，分别查询 USDC、USDT。基础年化来自 `latestAnnualPercentageRate`；`tierAnnualPercentageRate` 作为额外阶梯加息及额度单列，不将优惠套用全部本金。返回多个同币产品时标记待确认。
- Loan 当前报价：`GET /sapi/v2/loan/flexible/loanable/data?loanCoin=USDC`，保留 `flexibleInterestRate` 原始数值。当前官方字段说明没有明确时间单位，**不推测其年化换算**；需要在真实 API 与 Binance 页面核对后才能添加可靠换算。
- Loan 年化参考：`GET /sapi/v2/loan/interestRateHistory`，读取最近一小时记录中最新的 `annualizedInterestRate`，显示记录时间。它是官方公布记录，**不声称等同于此刻报价**；无记录时为缺失，不以 0 替代。请求每页 100 条，可覆盖分钟粒度的一小时；不做历史补采。
- BTC 抵押资格及初始/清算 LTV：`GET /sapi/v2/loan/flexible/collateral/data?collateralCoin=BTC`。这只说明资产资格，不保证特定账户能成功借款。
- 利率统一以 APR 小数存储，前端乘 100 展示百分比。零值有效，缺失值无效。APR 不等于 APY。
- 每个产品独立报告成功、失败或未配置；接口异常不影响其他产品。刷新前清除旧报价，不把旧数据当作实时值。
- Worker 和前端均禁用响应缓存，无自动轮询；单次刷新内部串行签名请求、间隔至少 1.1 秒。多用户请求仍可能触发平台限流，页面会显示相应状态。

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
- `GET /api/rates`：按需查询三项产品，返回 `mode: on-demand`、产品状态、时间及公开利率字段。
- API 只有固定查询路由；不接受调用者传入任意 Binance 路径、账户、币种或签名参数。
- 允许浏览器 Origin 默认为 `https://smallyunet.github.io`，可用 Worker 文本变量 `ALLOWED_ORIGIN` 修改。CORS 是浏览器限制，不等于用户认证。API 公开展示产品利率；如流量增加，应在 Cloudflare 配置限流。
- 新增平台时添加对应的采集适配器，再扩充产品描述与页面分组；保持统一的 `platform / kind / asset / apr / status / fetchedAt` 字段。

官方文档：[Binance Loan](https://developers.binance.com/en/docs/catalog/investment-and-services-crypto-loan/api/rest-api/flexible-rate)、[Binance Earn](https://developers.binance.com/en/docs/catalog/investment-and-services-simple-earn/api/rest-api/flexible-locked)。
