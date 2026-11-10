// 冒烟测试（不进 npm test，依赖本机样例文件）：
//   1. 解析原项目真实 DOCX 样例
//   2. 构造最小 PDF 验证 unpdf 提取
//   3. 假 ctx 走 registerApi：catalog → 存档案 → resume/job/report → 删除
// 运行：node scripts/smoke.mjs [样例.docx]
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { Writable } from 'node:stream'

const sample = process.argv[2] || 'D:/dsh-research/资料/resume-matcher-agent-cn-main/苏明远2-简历-20260615.docx'
const tmp = mkdtempSync(join(tmpdir(), 'dsh-resume-smoke-'))
process.env.DSH_HOME = tmp

let failed = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
  if (!cond) failed++
}

// ── 1. 真实 DOCX ────────────────────────────────────────────────────────
const { extractFromFile } = await import('../lib/parser.js')
try {
  const { text, ext } = await extractFromFile(sample)
  check('真实 DOCX 解析', text.length > 200, `${ext} · ${text.length} 字符 · 开头「${text.slice(0, 40).replace(/\n/g, ' ')}…」`)
} catch (e) {
  check('真实 DOCX 解析', false, e.message)
}

// ── 2. 最小 PDF → unpdf ────────────────────────────────────────────────
// 手写一个含文本对象的最小 PDF（简历解析里 PDF 是主路径，必须真实验证）
function minimalPdf(text) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`
  const objs = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ]
  let out = '%PDF-1.4\n'
  const offsets = []
  for (const o of objs) { offsets.push(out.length); out += o }
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}
const pdfPath = join(tmp, 'sample.pdf')
writeFileSync(pdfPath, minimalPdf('Resume Matcher PDF extraction works'))
try {
  const { text, ext } = await extractFromFile(pdfPath)
  check('最小 PDF 解析（unpdf）', text.includes('PDF extraction works'), `${ext} · ${text.length} 字符`)
} catch (e) {
  check('最小 PDF 解析（unpdf）', false, e.message)
}

// ── 3. 假 ctx 走面板 API ───────────────────────────────────────────────
const { registerApi } = await import('../lib/api.js')
const { saveResume, saveJob, saveReport } = await import('../lib/store.js')

const routes = {}
const fakeCtx = {
  get: () => undefined, // connection 缺席 → 放行（0.2.x 语义）
  webServer: { register: (r) => { routes[r.path] = r.handler } },
}
registerApi(fakeCtx)
const handler = routes['/resume-matcher']

function mockRes() {
  // 真流：pipe() 需要完整 Writable 接口
  const res = new Writable({ write(chunk, _enc, cb) { res.body += chunk.toString(); cb() } })
  res.body = ''
  res.statusCode = 0
  res.headers = {}
  res.writeHead = (s, h) => { res.statusCode = s; Object.assign(res.headers, h || {}) }
  return res
}
function mockReq(url, { method = 'GET', body = null } = {}) {
  const req = new EventEmitter()
  req.url = url
  req.method = method
  req.headers = { host: 'localhost', 'content-type': 'application/json' }
  if (body != null) setImmediate(() => { req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end') })
  return req
}
const call = (path, opts) => new Promise((resolve) => {
  const url = path.startsWith('/resume-matcher') ? path : '/resume-matcher' + path // 宿主总是带前缀调用
  const res = mockRes()
  res.on('finish', () => resolve(res)) // pipe 是异步流，等 finish 才能拿到完整 body
  handler(mockReq(url, opts), res)
})
// 负向测试用：不打前缀，模拟非本插件路由的裸请求
const rawCall = (url, opts) => new Promise((resolve) => {
  const res = mockRes()
  res.on('finish', () => resolve(res))
  handler(mockReq(url, opts), res)
})

// 静态页（生产环境宿主总是带前缀调用 handler）
{
  const res = await call('/resume-matcher/')
  const html = res.body
  check('静态页 /resume-matcher/', res.statusCode === 200 && html.includes('简历诊所') && html.includes('app.js'), `status=${res.statusCode} ${Buffer.byteLength(html)}B`)
}
{
  const res = await rawCall('/')
  check('非前缀请求被拒', res.statusCode === 404, `status=${res.statusCode}`)
}
{
  // URL 构造器会规范化明文 ../，真实攻击形态是编码 %2e%2e（解码发生在前缀剥离之后）
  const res = await call(encodeURI('/resume-matcher/../package.json').replace(/\.\./g, '%2e%2e'))
  check('路径穿越被拒', res.statusCode === 404, `status=${res.statusCode}`)
}

// API 全链路（与 host.js 真实链路一致：存档前走 parseProcessed 归一化）
{
  const { parseProcessed } = await import('../lib/store.js')
  const rid = saveResume({ content: '# 测试简历\n三年后端', sourceFile: 'test.docx', processed: parseProcessed({ 'Personal Data': { firstName: 'Yuan', lastName: 'Ce' }, Experiences: [] }) })
  saveJob({ content: '高级后端工程师 JD', resumeId: rid, processed: parseProcessed({ jobTitle: '高级后端工程师', companyProfile: { companyName: '测试公司' } }) })
  const resumeBlock = '# 测试简历\n\n## 工作经历\n\n- 优化接口 P99 从 800ms 到 200ms\n\n## 教育背景\n\n某大学本科\n' + '长'.repeat(160)
  saveReport({ resumeId: rid, jobId: '', reportMd: `## Step 1\n\n评分 7/10\n\n## Step 4\n\n\`\`\`md\n${resumeBlock}\n\`\`\`` })

  const cat = JSON.parse((await call('/api/catalog')).body)
  check('catalog 统计', cat.stats.resumes === 1 && cat.stats.jobs === 1 && cat.stats.reports === 1 && cat.stats.improved === 1, JSON.stringify(cat.stats))
  check('catalog 标题归一化', cat.resumes[0].title === 'CeYuan' && cat.jobs[0].title === '高级后端工程师', `${cat.resumes[0].title} / ${cat.jobs[0].title}`)

  const rid2 = cat.resumes[0].id
  const r1 = JSON.parse((await call(`/api/resume?id=${rid2}`)).body)
  check('resume 详情', r1.resume.processed.personal_data.lastName === 'Ce')
  const rep = JSON.parse((await call(`/api/report?id=${cat.reports[0].id}`)).body)
  check('report 渲染 HTML', rep.report.html.includes('<h2>') && rep.report.score === '7/10' && rep.report.improved_md.includes('工作经历'))

  const del = JSON.parse((await call('/api/resume/remove', { method: 'POST', body: { id: rid2 } })).body)
  check('resume 删除（级联）', del.ok === true)
  const cat2 = JSON.parse((await call('/api/catalog')).body)
  check('级联后归零', cat2.stats.resumes === 0 && cat2.stats.jobs === 0 && cat2.stats.reports === 0)

  const nf = await call('/api/resume?id=nope')
  check('404 分支', nf.statusCode === 404)
}

// 新增通道：上传（真实 DOCX base64）/ 粘贴 / JD 新增
{
  const { readFileSync } = await import('node:fs')
  const docxB64 = readFileSync(sample, null).toString('base64')
  const up = JSON.parse((await call('/api/resume/upload', { method: 'POST', body: { name: '样例简历.docx', base64: docxB64 } })).body)
  check('上传 DOCX 归档', up.ok === true && up.chars > 200, `chars=${up.chars}`)
  const bad = await call('/api/resume/upload', { method: 'POST', body: { name: 'x.exe', base64: 'AAAA' } })
  check('上传扩展名拦截', bad.statusCode === 400)
  const addR = JSON.parse((await call('/api/resume/add', { method: 'POST', body: { content: '粘贴的简历全文内容' } })).body)
  check('粘贴新增简历', addR.ok === true && addR.chars === 9)
  const empty = await call('/api/resume/add', { method: 'POST', body: { content: '  ' } })
  check('空文本拦截', empty.statusCode === 400)
  const addJ = JSON.parse((await call('/api/job/add', { method: 'POST', body: { content: '粘贴的 JD 全文', resumeId: up.id } })).body)
  check('新增 JD 并关联', addJ.ok === true && addJ.chars > 0)
  const cat = JSON.parse((await call('/api/catalog')).body)
  const upResume = cat.resumes.find((r) => r.id === up.id)
  const upJob = cat.jobs.find((j) => j.id === addJ.id)
  check('新档案标记未结构化', upResume && !upResume.processed_at && upJob && !upJob.processed_at)
  check('上传后清单数正确', cat.stats.resumes === 2 && cat.stats.jobs === 1)
}

rmSync(tmp, { recursive: true, force: true })
console.log(failed ? `\n${failed} 项失败` : '\n冒烟全部通过')
process.exit(failed ? 1 : 0)
