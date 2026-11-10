// 开发预览：把插件面板跑在独立 http 服务上（复用 lib/api.js 的路由 + 真实数据）。
//   node scripts/devserver.mjs [port]   默认 5175
//   SET DSH_HOME=... 可指定数据目录；不带数据时页面显示空态。
import { createServer } from 'node:http'
import { registerApi } from '../lib/api.js'

const port = Number(process.argv[2]) || 5175
const routes = {}
const fakeCtx = { get: () => undefined, webServer: { register: (r) => { routes[r.path] = r.handler } } }
registerApi(fakeCtx)

createServer(async (req, res) => {
  // 模拟宿主：所有路径都交给前缀路由处理（非 /resume-matcher 路径回 404）
  const handler = routes['/resume-matcher']
  try {
    await handler(req, res)
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: e.message }))
  }
}).listen(port, () => console.log(`[dev] http://127.0.0.1:${port}/resume-matcher/  (DSH_HOME=${process.env.DSH_HOME || '~/.dsh'})`))
