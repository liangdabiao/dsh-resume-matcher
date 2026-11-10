// 面板数据面：/resume-matcher 前缀路由。
//   /resume-matcher/            面板页面（lab/ 静态资源）
//   /api/health                 健康检查
//   /api/catalog                概览（统计 + 三个清单）
//   /api/resume?id=             简历完整档案（raw + processed）
//   /api/job?id=                JD 完整档案
//   /api/report?id=             报告（markdown + 渲染 HTML + 优化后简历）
//   /api/resume/remove 等       POST 删除
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderMarkdown } from './markdown.js'
import { listResumes, listJobs, listReports, getResume, getJob, getReport, removeResume, removeJob, removeReport } from './store.js'

const BASE = '/resume-matcher'
const LAB = fileURLToPath(new URL('../lab/', import.meta.url))

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2',
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

export function requestRejection(ctx, req) {
  const connection = ctx.get('connection')
  if (typeof connection?.requestRejection !== 'function') return false // dsh 0.2.x 宿主已 token 鉴权，服务缺席时放行
  return connection.requestRejection({ headers: req.headers })
}

// 只放行 lab/ 里的文件：拒绝 ..、点开头的路径和指到目录外的符号链接
function safeFile(dir, rel) {
  if (!dir || String(rel).split('/').some((p) => p.startsWith('.'))) return null
  let base
  try { base = realpathSync(dir) } catch { return null }
  const file = normalize(join(base, rel))
  if (!file.startsWith(base + sep) || !existsSync(file)) return null
  const real = realpathSync(file)
  return real.startsWith(base + sep) && statSync(real).isFile() ? real : null
}

function serveFile(req, res, file) {
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'content-length': statSync(file).size,
    'cache-control': 'no-cache',
  })
  if (req.method === 'HEAD') return res.end()
  createReadStream(file).pipe(res)
}

// 同源 JSON POST
function readJson(req, max = 8 * 1024) {
  return new Promise((resolve, reject) => {
    const origin = req.headers.origin
    if (req.method !== 'POST') return reject(Object.assign(new Error('method'), { status: 405 }))
    if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return reject(Object.assign(new Error('type'), { status: 415 }))
    if (origin && origin.replace(/^https?:\/\//, '') !== req.headers.host) return reject(Object.assign(new Error('origin'), { status: 403 }))
    let size = 0
    const chunks = []
    req.on('data', (c) => { size += c.length; if (size > max) req.destroy(); else chunks.push(c) })
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch (e) { reject(Object.assign(e, { status: 400 })) } })
    req.on('error', reject)
  })
}

function readVersion() {
  try { return JSON.parse(readFileSync(join(LAB, '..', 'package.json'), 'utf8')).version } catch { return '' }
}

function catalog() {
  const resumes = listResumes()
  const jobs = listJobs()
  const reports = listReports()
  return {
    version: readVersion(),
    dataDir: process.env.DSH_HOME ? `${process.env.DSH_HOME}/resume-matcher` : '~/.dsh/resume-matcher',
    resumes,
    jobs,
    reports,
    stats: {
      resumes: resumes.length,
      jobs: jobs.length,
      reports: reports.length,
      improved: reports.filter((r) => r.has_improved).length,
    },
  }
}

export function registerApi(ctx) {
  return ctx.webServer.register({
    kind: 'prefix',
    path: BASE,
    async handler(req, res) {
      try {
        const rejection = requestRejection(ctx, req)
        if (typeof rejection === 'number') return json(res, rejection, { error: '未授权' })

        const url = new URL(req.url, 'http://x')
        if (!url.pathname.startsWith(BASE + '/') && url.pathname !== BASE) {
          return json(res, 404, { error: 'not found' })
        }
        const path = decodeURIComponent(url.pathname.slice(BASE.length)) || '/'

        // ---- API ----
        if (path === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true })
        if (path === '/api/catalog' && req.method === 'GET') return json(res, 200, catalog())
        if (path === '/api/resume' && req.method === 'GET') {
          const r = getResume(url.searchParams.get('id') || '')
          if (!r) return json(res, 404, { error: '没有这份简历' })
          return json(res, 200, { resume: r })
        }
        if (path === '/api/job' && req.method === 'GET') {
          const j = getJob(url.searchParams.get('id') || '')
          if (!j) return json(res, 404, { error: '没有这条 JD' })
          return json(res, 200, { job: j })
        }
        if (path === '/api/report' && req.method === 'GET') {
          const r = getReport(url.searchParams.get('id') || '')
          if (!r) return json(res, 404, { error: '没有这份报告' })
          return json(res, 200, { report: { ...r, html: renderMarkdown(r.report_md) } })
        }
        for (const [route, fn] of [
          ['/api/resume/remove', removeResume],
          ['/api/job/remove', removeJob],
          ['/api/report/remove', removeReport],
        ]) {
          if (path === route && req.method === 'POST') {
            try {
              const body = await readJson(req)
              const removed = fn(String(body.id || '')) // 简历删除返回级联条数，JD/报告返回布尔
              return json(res, 200, { ok: Boolean(removed), removed })
            } catch (e) { return json(res, e.status || 400, { ok: false, error: e.message }) }
          }
        }
        if (path.startsWith('/api/')) return json(res, 404, { error: 'not found' })

        // ---- 静态页面 ----
        if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method' })
        const file = safeFile(LAB, path === '/' ? 'index.html' : path.replace(/^\/+/, ''))
        return file ? serveFile(req, res, file) : json(res, 404, { error: 'not found' })
      } catch (err) {
        json(res, 500, { error: err?.message || '内部错误' })
      }
    },
  })
}
