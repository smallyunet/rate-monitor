# Rate Monitor

多平台借贷与活期利率看板。支持 Binance 和 Bitget 的 BTC 抵押 / USDC、USDT 活期借款，以及 Binance USDC、USDT Simple Earn Flexible。

- 网页：https://smallyunet.github.io/rate-monitor/
- Worker：https://rate-monitor-api.smallyu.workers.dev
- 本地目录：`/Users/smallyu/work/github/rate-monitor`

## 工作方式

GitHub Pages 静态网页 → Cloudflare Worker → Binance 官方签名接口 + Bitget 官方公开市场接口。

打开页面或手动刷新时获取数据。不运行定时采样，不存储账户或历史数据，不执行交易。私人仓位通过独立的 Cloudflare Access 路径按需读取。GitHub Actions 仅检查代码、构建和部署 Pages。

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

- Earn：`GET /sapi/v1/simple-earn/flexible/list`，分别查询 USDC、USDT。基础年化来自 `latestAnnualPercentageRate`；`tierAnnualPercentageRate` 为各额度区间的额外加息。页面按区间显示基础 APR + 加息的总 APR，超出额度部分显示基础 APR；默认金额自动取最高加息档位上限的两倍，并按每档覆盖的金额加权计算 Effective APR；没有有限上限时留空。用户手动修改或清空金额后，刷新利率保留该输入；未手动修改时，刷新后按最新档位重新计算默认金额。金额为空或无效时不显示综合值；区间无法解析或重叠时不推测结果。金额输入仅在浏览器计算，不触发平台请求，刷新利率时保留。返回多个同币产品时标记待确认。
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

Node.js 20+，无运行依赖；开发构建使用 esbuild。以下命令不会启动浏览器：

```sh
npm ci
npm run check
npm test
npm run build
npm run build:worker
```

`web/` 为统一网页源文件，`dist/` 为 Pages 跳转入口的构建产物。推送 `main` 后，GitHub Actions 自动发布 Pages。Worker bundle 同时包含公开静态页面和接口，需单独部署。

Worker 入口为 `worker/index.js`，包含私人仓位与身份验证模块。运行 `npm run build:worker` 后，将 `build/worker.js` 的完整内容粘贴到 Cloudflare 的 Edit code 并 Deploy，或在已登录的 Wrangler 环境执行 `npx wrangler deploy`。`wrangler.jsonc` 保留了服务名与允许的前端 Origin。Worker 当前不通过 Actions 自动部署，修改 Worker 后需单独部署。

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

## 私人仓位

公共页面的 Sign in 链接进入 Worker `/private/`，登录成功返回同页的 My Positions 区域；`/private/` 与 `/private/api/positions` 由 Cloudflare Access 邮箱登录保护。应用策略仅允许指定的单个邮箱。Worker 另外验证 Access JWT 的 RSA 签名、issuer、AUD、有效期和邮箱；未配置或验证失败时不访问平台接口。私人响应不启用 CORS，使用 `private, no-store`，无账户数据日志和本地存储。

Worker 文本变量：`ACCESS_TEAM_DOMAIN`（完整 https URL）、`ACCESS_AUD`（Access 应用的 Audience）、`POSITIONS_EMAIL`（唯一允许邮箱）。这些值通过控制台配置，不把邮箱写入公共仓库。Wrangler 部署需保留控制台变量，避免覆盖认证配置；缺失配置会安全拒绝所有私人请求。

Bitget 只读 Secrets：`BITGET_API_KEY`、`BITGET_API_SECRET`、`BITGET_API_PASSPHRASE`。浏览器不接触密钥或签名。

- Binance Flexible Loan：`GET /sapi/v2/loan/flexible/ongoing/orders`，抵押数量及含利息的 `totalDebt`。
- Binance Simple Earn：`GET /sapi/v1/simple-earn/flexible/position` 和 `/sapi/v1/simple-earn/locked/position`，活期/定期余额分别展示。活期的 `collateralAmount` 可能与借贷抵押重叠，因此不合计为总资产。最多读取 20 页，超过上限或总数变化显示 Partial results。
- Bitget Loan：`GET /api/v3/loan/borrow-ongoing`，抵押数量、借款金额和利息分列；不把本金字段误标成含息总债务。
- Bitget Savings：当前 UTA 账户的 Classic v2 Earn 接口返回 40085，使用 `GET /api/v3/earn/savings/account` 展示全部 Savings 的 USDT 折合估值（明确不是 USDT 代币余额）。通过 `/api/v3/earn/savings/assets?periodType=flexible|fixed` 展示近三个月创建的活期/定期持仓明细，最多每类 10 页；此接口以创建时间过滤，因此始终标注覆盖范围，不能据此声称列齐更早持仓或全部 Earn 产品。
- 查询失败为 Unavailable；成功且无数据为 No positions；未配置密钥单独显示。余额保留平台十进制字符串精度。
- Bitget Worker 出口曾返回 HTTP 403。私人请求不能采用公开利率的浏览器回退。现通过 ssh c 上独立容器 `rate-monitor-relay` 转发，Worker 配置 `BITGET_RELAY_URL` 指向该服务的 HTTPS 路径。
- 只在打开仓位页或 Refresh 时请求，不定时采样。页面离开时清空 DOM 中的账户值；返回页面重新读取。

官方文档：[Bitget Earn Account](https://www.bitget.com/docs/catalog/earn-classic-account/classic-earn-account#earn-account-assets)、[Bitget Crypto Loans](https://www.bitget.com/docs/catalog/crypto-loans/crypto-loans)。

### ssh c 只读转发

`server/relay.js` 在 `/opt/rate-monitor` 独立部署，Docker 容器仅加入已有入口网络，没有公开容器端口。现有 Caddy 在 `c.dark20.xyz/_rate-monitor/*` 转发到容器，原网站路由保留；Caddy 源配置及 compose override 保留了重建后的路由配置。

转发服务校验同一 Access JWT 签名、AUD、issuer、邮箱及过期时间，且仅允许借贷、Savings 总览、Savings 明细这三个 Bitget GET 路径；明细 query 只允许 flexible/fixed、固定 limit=100 和数字 cursor，不接受任意上游或交易接口。平台签名由 Worker 生成；服务器临时转发 API key、签名与 passphrase，但不持久保存这些值或 Bitget API secret，且不把 Access JWT 转发到交易所。使用 HTTPS、禁用缓存和重定向、限制返回体大小和请求频率。服务器环境文件仅包含 Access 配置和允许邮箱，权限 600，不纳入仓库。

部署时复制 `server/relay.js`、`server/compose.yml`、`worker/access-auth.js`（服务器文件名 access-auth.js）到服务器目录，并配置 relay.env，然后 `docker compose up -d`。更新 worker/access-auth.js 时须同步服务器文件。`server/install-route.py` 是现有 ssh c Caddy 入口的幂等配置脚本，会先保存原配置。

## 同页 Rates / Positions

应用统一由 `https://rate-monitor-api.smallyu.workers.dev/` 托管，Rates 在上，My Positions 在下。原 GitHub Pages 地址保留为自动跳转入口。这样 Access cookie 与私人接口同源，不需要跨站 cookie、跨域私人 CORS 或 iframe。Worker 构建只嵌入 web/ 公共静态文件，不嵌入账户数据或密钥。

未登录时只显示公开 Rates 和 Sign in。Sign in 进入原有 Access 保护的 `/private/`；认证成功后返回首页 `/#positions`，浏览器从 `/private/api/positions` 按需加载仓位。Access 策略和 Worker 的 JWT/邮箱校验不变。旧仓位页面也跳回统一页面。Sign out 清除仓位 DOM、实际余额默认值和自定义金额，取消在途请求，避免旧响应重新填入私人数据；浏览器历史恢复时重新查询，不缓存仓位。

Rates 的 Effective APR 金额优先级：手动输入 > 已认证的 Binance Flexible Earn 完整成功快照中的实际余额 > 档位上限两倍。零余额保持 0，零金额不计算 APR；失败/缺失/partial 不能当作实际余额。借贷抵押与 Earn 不合计，Bitget Savings 估值不冒充 Binance Earn 数量。两个区域独立手动刷新，无定时采样。
