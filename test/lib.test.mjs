// 单元测试：parser（DOCX zip+xml）/ markdown（报告渲染 + 优化简历抽取）/ store（档案库）。
// 运行：npm test（DSH_HOME 指到临时目录，不碰真实 ~/.dsh）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'

// ── 测试用 zip 构造器（免第三方依赖）───────────────────────────────────
function zipBuilder() {
  const entries = []
  return {
    add(name, data, method = 0) {
      entries.push({ name, data, method })
    },
    build() {
      const locals = []
      const centrals = []
      let offset = 0
      for (const e of entries) {
        const nameBuf = Buffer.from(e.name, 'utf8')
        const payload = e.method === 8 ? deflateRawSync(e.data) : e.data
        const local = Buffer.alloc(30)
        local.writeUInt32LE(0x04034b50, 0)
        local.writeUInt16LE(20, 4)
        local.writeUInt16LE(0, 6)
        local.writeUInt16LE(e.method, 8)
        local.writeUInt32LE(0, 14) // crc：解析器不校验
        local.writeUInt32LE(payload.length, 18)
        local.writeUInt32LE(e.data.length, 22)
        local.writeUInt16LE(nameBuf.length, 26)
        local.writeUInt16LE(0, 28)
        locals.push(local, nameBuf, payload)
        const central = Buffer.alloc(46)
        central.writeUInt32LE(0x02014b50, 0)
        central.writeUInt16LE(20, 4)
        central.writeUInt16LE(20, 6)
        central.writeUInt16LE(e.method, 10)
        central.writeUInt32LE(payload.length, 20)
        central.writeUInt32LE(e.data.length, 24)
        central.writeUInt16LE(nameBuf.length, 28)
        central.writeUInt32LE(offset, 42)
        centrals.push(central, nameBuf)
        offset += 30 + nameBuf.length + payload.length
      }
      const cdStart = offset
      const cd = Buffer.concat(centrals)
      const eocd = Buffer.alloc(22)
      eocd.writeUInt32LE(0x06054b50, 0)
      eocd.writeUInt16LE(entries.length, 8)
      eocd.writeUInt16LE(entries.length, 10)
      eocd.writeUInt32LE(cd.length, 12)
      eocd.writeUInt32LE(cdStart, 16)
      return Buffer.concat([...locals, ...centrals, eocd])
    },
  }
}

function docxZip(documentXml, method = 0) {
  const zip = zipBuilder()
  zip.add('[Content_Types].xml', Buffer.from('<Types/>'))
  zip.add('word/document.xml', Buffer.from(documentXml, 'utf8'), method)
  return zip.build()
}

// ── parser ─────────────────────────────────────────────────────────────
const { extractDocx, extractFromFile, extractFromBuffer } = await import('../lib/parser.js')

test('parser: DOCX stored 条目（双列布局 tab/br/p 保序）', () => {
  const xml = '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    '<w:p><w:r><w:t>苏明远</w:t></w:r><w:r><w:tab/><w:t>13800000000</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>工作经历</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>A公司</w:t><w:br/><w:t>2020-2024</w:t></w:r><w:r><w:t xml:space="preserve"> &amp; B项目 &lt;核心&gt;</w:t></w:r></w:p>' +
    '</w:body></w:document>'
  const text = extractDocx(docxZip(xml))
  assert.match(text, /苏明远\t13800000000/)
  assert.match(text, /工作经历/)
  assert.match(text, /A公司\n2020-2024/)
  assert.match(text, / & B项目 <核心>/)
})

test('parser: DOCX deflate 压缩条目', () => {
  const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>压缩文本OK</w:t></w:r></w:p></w:document>'
  assert.match(extractDocx(docxZip(xml, 8)), /压缩文本OK/)
})

test('parser: pPr 里的制表位定义不被当内容 tab', () => {
  const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:p><w:pPr><w:tabs><w:tab w:val="start" w:pos="4200"/></w:tabs></w:pPr><w:r><w:t>标题行</w:t></w:r></w:p></w:document>'
  const text = extractDocx(docxZip(xml))
  assert.equal(text.includes('\t'), false)
  assert.match(text, /标题行/)
})

test('parser: 非 zip / 缺 document.xml 报错', () => {
  assert.throws(() => extractDocx(Buffer.from('not a zip')), /zip/)
  const zip = zipBuilder()
  zip.add('other.txt', Buffer.from('x'))
  assert.throws(() => extractDocx(zip.build()), /document\.xml/)
})

test('parser: extractFromFile 拒绝不支持的扩展名', async () => {
  await assert.rejects(() => extractFromFile('D:/x/简历.doc'), /只支持/)
})

// ── markdown ───────────────────────────────────────────────────────────
const { renderMarkdown, extractImprovedMd } = await import('../lib/markdown.js')

test('markdown: renderMarkdown 标题/列表/表格/代码块', () => {
  const html = renderMarkdown('## 标题\n\n- 甲\n- 乙\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```md\n# 简历\n```\n')
  assert.match(html, /<h2>标题<\/h2>/)
  assert.match(html, /<ul><li>甲<\/li><li>乙<\/li><\/ul>/)
  assert.match(html, /<table>/)
  assert.match(html, /<pre><code>/)
})

test('markdown: extractImprovedMd 命中简历代码块', () => {
  const resume = '# 张三\n\n## 工作经历\n\n- 为解决Y，在A/B间选Z，QPS 提升 3 倍\n\n## 教育背景\n\nXX 大学 硕士\n' + '内容'.repeat(120)
  const report = `## Step 3 蓝图\n\n短代码块：\n\n\`\`\`\nnot resume\n\`\`\`\n\n## Step 4 修改后的完整简历\n\n\`\`\`md\n${resume}\n\`\`\`\n\n## Step 5 裁决\n\nok`
  const [md, source] = extractImprovedMd(report)
  assert.equal(source, 'extracted')
  assert.match(md, /## 工作经历/)
})

test('markdown: extractImprovedMd 无合格代码块返回 none', () => {
  assert.deepEqual(extractImprovedMd('没有代码块'), [null, 'none'])
  assert.deepEqual(extractImprovedMd('```\nshort\n```'), [null, 'none'])
})

// ── store（DSH_HOME 指向临时目录）──────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'dsh-resume-matcher-test-'))
process.env.DSH_HOME = tmp
const store = await import('../lib/store.js')

test('store: 简历/JD/报告 全链路 + 级联删除', () => {
  const processed = store.parseProcessed(JSON.stringify({
    'Personal Data': { firstName: 'Mingyuan', lastName: 'Su', email: 'su@x.com' },
    Experiences: [{ jobTitle: '工程师', company: 'A公司', startDate: '2020-01-01', endDate: 'Present' }],
  }))
  assert.equal(processed.personal_data.lastName, 'Su')
  assert.equal(processed.experiences[0].jobTitle, '工程师')

  const rid = store.saveResume({ content: '# 苏明远\n简历全文', sourceFile: 'D:/x/苏明远.docx', processed })
  assert.ok(rid)
  assert.equal(store.getResume(rid).personalTitle ?? undefined, undefined) // 无此字段，防呆
  assert.equal(store.getResume(rid).processed.personal_data.email, 'su@x.com')

  const jid = store.saveJob({ content: 'AI Agent 工程师 JD 全文', resumeId: rid, processed: store.parseProcessed({ jobTitle: 'AI Agent 工程师', companyProfile: { companyName: 'B公司' } }) })
  assert.equal(store.getJob(jid).processed.job_title, 'AI Agent 工程师')

  const resumeBlock = '# 苏明远\n\n## 工作经历\n\n- 为解决Y在A/B间选Z，延迟从800ms到200ms\n\n## 教育背景\n\nXX大学\n' + '详'.repeat(150)
  const reportMd = `## Step 1 · 第一印象\n\n匹配 6/10。\n\n## Step 4 · 修改后的完整简历\n\n\`\`\`md\n${resumeBlock}\n\`\`\`\n`
  const reportId = store.saveReport({ resumeId: rid, jobId: jid, reportMd })
  const report = store.getReport(reportId)
  assert.equal(report.resume_title, 'SuMingyuan')
  assert.equal(report.job_title, 'AI Agent 工程师')
  assert.match(report.improved_md, /## 工作经历/)
  assert.equal(report.score, '6/10')

  const stats = store.stats()
  assert.deepEqual({ resumes: stats.resumes, jobs: stats.jobs, reports: stats.reports, improved: stats.improved }, { resumes: 1, jobs: 1, reports: 1, improved: 1 })

  // 级联：删简历连 JD 和报告一起删
  const n = store.removeResume(rid)
  assert.equal(n, 3)
  assert.equal(store.getResume(rid), null)
  assert.equal(store.getJob(jid), null)
  assert.equal(store.getReport(reportId), null)
  assert.deepEqual(store.stats(), { resumes: 0, jobs: 0, reports: 0, improved: 0 })
})

test('store: parseProcessed 兼容 snake_case 与未知形态不丢数据', () => {
  const snake = store.parseProcessed({ job_title: 'X', extracted_keywords: ['a'] })
  assert.equal(snake.job_title, 'X')
  const unknown = store.parseProcessed({ weird: { a: 1 } })
  assert.deepEqual(unknown.weird, { a: 1 })
  assert.throws(() => store.parseProcessed('[1,2]'), /JSON 对象/)
})

test('store: parse 已存档案路径形状（list 排序/标题兜底）', () => {
  const rid = store.saveResume({ content: '', processed: {} })
  const [first] = store.listResumes()
  assert.equal(first.title, '未命名简历')
  store.removeResume(rid)
})

// ── a4cv 对接 ──────────────────────────────────────────────────────────
const { normalizeForA4cv, buildFallbackMarkdown, countSections } = await import('../lib/a4cv.js')

test('a4cv: 加粗小节标题转 ## + 首行补 # 姓名', () => {
  const md = normalizeForA4cv('苏明远\n\n**工作经历**\n\n- 内容一\n\n**技能：**\n\n- Go\n')
  assert.match(md, /^# 苏明远\n/)
  assert.match(md, /## 工作经历/)
  assert.match(md, /## 技能/)
  assert.ok(!md.includes('**工作经历'))
})

test('a4cv: 联系方式行不当姓名、已有 # 标题不动', () => {
  assert.equal(normalizeForA4cv('# 张三\n正文'), '# 张三\n正文')
  const contact = normalizeForA4cv('13800000000\n正文')
  assert.ok(!contact.startsWith('# 13800000000'))
  assert.match(contact, /^13800000000\n/)
})

test('a4cv: fallback 从 processed 拼装（snake/驼峰键都吃）', () => {
  const md = buildFallbackMarkdown({
    personal_data: { firstName: 'Yuan', lastName: 'Ce', email: 'c@x.com', location: { city: '上海' } },
    experiences: [{ job_title: '工程师', company: 'A', start_date: '2020-01', end_date: 'Present', description: ['做了X'] }],
    projects: [{ projectName: 'P1', description: '为解决Y选Z' }],
    education: [{ institution: '某大学', degree: '本科' }],
    skills: [{ skillName: 'Go' }, { skillName: 'Redis' }],
    achievements: ['国奖'],
  })
  assert.match(md, /^# CeYuan/)
  assert.match(md, /> c@x\.com · 上海/)
  assert.match(md, /## 工作经历\n### 工程师 \| A · 2020-01 - Present/)
  assert.match(md, /## 项目经历/)
  assert.match(md, /## 技能标签\nGo · Redis/)
  assert.match(md, /## 证书与荣誉\n- 国奖/)
  assert.equal(countSections(md), 9) // 姓名 + 5 小节 + 3 ### 条目
})

test('a4cv: store 存报告时 improved_md 已归一化 + fallback 源', () => {
  const rid = store.saveResume({
    content: '# 老简历',
    processed: { personal_data: { firstName: 'San', lastName: 'Zhang' }, experiences: [] },
  })
  const reportId = store.saveReport({ resumeId: rid, reportMd: '## Step 4\n\n没有代码块的报告' })
  const r = store.getReport(reportId)
  assert.equal(r.improved_source, 'fallback')
  assert.match(r.improved_md, /^# ZhangSan/)
  assert.ok(r.improved_sections >= 1)
  store.removeResume(rid) // 级联删报告
})

test('store: updateResume/updateJob 回填（upsert 语义）', () => {
  const rid = store.saveResume({ content: '面板上传的原文', processed: {} })
  const backfilled = store.updateResume(rid, { processed: { personal_data: { lastName: '王' } } })
  assert.equal(backfilled.processed.personal_data.lastName, '王')
  assert.equal(backfilled.content, '面板上传的原文') // 未传 content 不动原文
  assert.equal(store.updateResume('nope', { processed: {} }), null)
  const jid = store.saveJob({ content: '面板粘贴的 JD' })
  store.updateJob(jid, { processed: { job_title: '后端' }, resumeId: rid })
  assert.equal(store.getJob(jid).processed.job_title, '后端')
  assert.equal(store.getJob(jid).resume_id, rid)
  store.removeResume(rid)
})

test('parser: extractFromBuffer 拒绝非支持扩展名', async () => {
  await assert.rejects(() => extractFromBuffer(Buffer.from('x'), '.doc'), /只支持/)
})

test.after ?? test.after(() => rmSync(tmp, { recursive: true, force: true }))
