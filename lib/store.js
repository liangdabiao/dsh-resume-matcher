// 简历诊所 · 档案库（JSON 文件存储，移植自原项目 store.py，扩展 reports）。
//
//   $DSH_HOME/resume-matcher/
//   ├── resumes/<id>.json   简历（raw + processed 结构化）
//   ├── jobs/<id>.json      JD（raw + processed 结构化）
//   ├── reports/<id>.json   审计报告（关联 resume_id + job_id + 优化后简历）
//   └── state.json          { lastResumeId, lastJobId }
//
// 原子写：tmp + rename，掉电/并发不会产生半写文件（照搬 store.py 的 _write_json）。
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { extractImprovedMd } from './markdown.js'
import { normalizeForA4cv, buildFallbackMarkdown, countSections } from './a4cv.js'

export const DATA_DIR = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'resume-matcher')
const RESUMES_DIR = join(DATA_DIR, 'resumes')
const JOBS_DIR = join(DATA_DIR, 'jobs')
const REPORTS_DIR = join(DATA_DIR, 'reports')
const STATE_FILE = join(DATA_DIR, 'state.json')

const now = () => new Date().toISOString()

function readJson(file, fallback = null) {
  if (!existsSync(file)) return fallback
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
}

export function ensureDirs() {
  for (const d of [RESUMES_DIR, JOBS_DIR, REPORTS_DIR]) mkdirSync(d, { recursive: true })
}

// ── state ──────────────────────────────────────────────────────────────
function getState() {
  return readJson(STATE_FILE, {}) || {}
}
function setState(patch) {
  writeJson(STATE_FILE, { ...getState(), ...patch })
}
export const getLastResumeId = () => getState().lastResumeId || ''
export const getLastJobId = () => getState().lastJobId || ''

// ── 结构化数据规范化（照搬 store.py 的 _CAMEL_*_MAP：LLM 返回带空格/驼峰键都接受）──
const CAMEL_RESUME_MAP = {
  'Personal Data': 'personal_data', Experiences: 'experiences', Projects: 'projects',
  Skills: 'skills', 'Research Work': 'research_work', Achievements: 'achievements',
  Education: 'education', 'Extracted Keywords': 'extracted_keywords',
  personalData: 'personal_data', researchWork: 'research_work', extractedKeywords: 'extracted_keywords',
}
const CAMEL_JOB_MAP = {
  jobTitle: 'job_title', companyProfile: 'company_profile', location: 'location',
  datePosted: 'date_posted', employmentType: 'employment_type', jobSummary: 'job_summary',
  keyResponsibilities: 'key_responsibilities', qualifications: 'qualifications',
  compensationAndBenefits: 'compensation_and_benfits', compensationAndBenfits: 'compensation_and_benfits',
  applicationInfo: 'application_info', extractedKeywords: 'extracted_keywords',
}

function normalizeStructured(raw, map) {
  const out = {}
  for (const [rawKey, stdKey] of Object.entries(map)) {
    // 只收真正取到的值：先占位成 undefined 会把后面同义的驼峰别名挡掉
    // （Personal Data 在前、personalData 在后时，camelCase 输入的个人信息会整块丢失）
    if (out[stdKey] !== undefined) continue
    const value = raw[rawKey] !== undefined ? raw[rawKey] : raw[stdKey]
    if (value !== undefined) out[stdKey] = value
  }
  // 结构化形态没匹配上（未知 schema）：保留原字段，只补时间戳，不丢数据
  if (!Object.keys(out).length) Object.assign(out, raw)
  out.processed_at = now()
  return out
}

// 容错：processedJson 可能拿到对象（面板直传）也可能拿到 JSON 字符串（工具参数）
export function parseProcessed(value) {
  if (value == null || value === '') return {}
  const raw = typeof value === 'string' ? JSON.parse(value) : value
  if (typeof raw !== 'object' || Array.isArray(raw) || !raw) throw new Error('processedJson 要是一个 JSON 对象')
  // 只给了个人信息的简历（模型有时省略 experiences）也要认成简历，否则会被当成未知 schema 原样存
  const isResume = 'Experiences' in raw || 'experiences' in raw || 'personal_data' in raw ||
    'personalData' in raw || 'Personal Data' in raw
  const isJob = 'jobTitle' in raw || 'job_title' in raw
  return isResume
    ? normalizeStructured(raw, CAMEL_RESUME_MAP)
    : isJob
      ? normalizeStructured(raw, CAMEL_JOB_MAP)
      : normalizeStructured(raw, {})
}

// ── 简历 ───────────────────────────────────────────────────────────────
export function saveResume({ content, sourceFile = '', processed = {} }) {
  const resume_id = randomUUID()
  writeJson(join(RESUMES_DIR, `${resume_id}.json`), {
    resume_id,
    content: String(content || ''),
    content_type: 'md',
    source_file: String(sourceFile || ''),
    created_at: now(),
    processed,
  })
  setState({ lastResumeId: resume_id })
  return resume_id
}

export const getResume = (id) => readJson(join(RESUMES_DIR, `${id}.json`))

// 回填更新（面板新增的档案后续由模型补结构化抽取；upsert 用）
export function updateResume(id, { processed, content, sourceFile } = {}) {
  const rec = getResume(id)
  if (!rec) return null
  if (processed !== undefined) rec.processed = processed
  if (content !== undefined) rec.content = String(content)
  if (sourceFile !== undefined) rec.source_file = String(sourceFile)
  writeJson(join(RESUMES_DIR, `${id}.json`), rec)
  return rec
}
export function updateJob(id, { processed, resumeId } = {}) {
  const rec = getJob(id)
  if (!rec) return null
  if (processed !== undefined) rec.processed = processed
  if (resumeId !== undefined) rec.resume_id = String(resumeId)
  writeJson(join(JOBS_DIR, `${id}.json`), rec)
  return rec
}

export function listResumes() {
  ensureDirs()
  return readdirJson(RESUMES_DIR).map((r) => ({
    id: r.resume_id,
    title: resumeTitle(r),
    source_file: r.source_file || '',
    chars: (r.content || '').length,
    created_at: r.created_at,
    processed_at: r.processed?.processed_at || null,
  })).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
}

function resumeTitle(r) {
  const name = r.processed?.personal_data
  if (name && (name.firstName || name.lastName)) return `${name.lastName || ''}${name.firstName || ''}`.trim()
  const line = (r.content || '').split('\n').map((s) => s.trim()).find(Boolean)
  return line ? line.slice(0, 40) : '未命名简历'
}

// ── JD ─────────────────────────────────────────────────────────────────
export function saveJob({ content, resumeId = '', processed = {} }) {
  const job_id = randomUUID()
  writeJson(join(JOBS_DIR, `${job_id}.json`), {
    job_id,
    resume_id: String(resumeId || ''),
    content: String(content || ''),
    created_at: now(),
    processed,
  })
  setState({ lastJobId: job_id })
  return job_id
}

export const getJob = (id) => readJson(join(JOBS_DIR, `${id}.json`))

export function listJobs() {
  ensureDirs()
  return readdirJson(JOBS_DIR).map((j) => ({
    id: j.job_id,
    title: j.processed?.job_title || firstLine(j.content, '未命名岗位'),
    company: j.processed?.company_profile?.companyName || j.processed?.company_profile?.company_name || '',
    resume_id: j.resume_id || '',
    chars: (j.content || '').length,
    processed_at: j.processed?.processed_at || null,
    created_at: j.created_at,
  })).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
}

// ── 报告 ───────────────────────────────────────────────────────────────
export function saveReport({ resumeId, jobId, reportMd, title = '' }) {
  const report_id = randomUUID()
  const resume = resumeId ? getResume(resumeId) : null
  const job = jobId ? getJob(jobId) : null
  const md = String(reportMd || '')
  // 优化后简历：先抽 ```md 代码块；抽不到且有关联简历时从结构化数据兜底拼装。
  // 两条路都过 normalizeForA4cv（加粗小节标题转 ##、补 # 姓名），编辑器才能直接识别。
  let [improved, source] = extractImprovedMd(md)
  if (improved) {
    source = 'extracted'
  } else if (resume?.processed && Object.keys(resume.processed).length) {
    improved = buildFallbackMarkdown(resume.processed)
    source = 'fallback'
  } else {
    improved = ''
    source = 'none'
  }
  if (improved) improved = normalizeForA4cv(improved)
  writeJson(join(REPORTS_DIR, `${report_id}.json`), {
    report_id,
    resume_id: String(resumeId || ''),
    job_id: String(jobId || ''),
    resume_title: resume ? resumeTitle(resume) : '',
    job_title: job ? (job.processed?.job_title || firstLine(job.content, '')) : '',
    title: String(title || '').trim() || (resume && job ? `${resumeTitle(resume)} × ${job.processed?.job_title || '岗位'}` : '简历分析报告'),
    report_md: md,
    improved_md: improved || '',
    improved_source: source,
    improved_sections: improved ? countSections(improved) : 0,
    score: reportScore(md),
    created_at: now(),
  })
  return report_id
}

export const getReport = (id) => readJson(join(REPORTS_DIR, `${id}.json`))

export function listReports() {
  ensureDirs()
  return readdirJson(REPORTS_DIR).map((r) => ({
    id: r.report_id,
    title: r.title,
    resume_id: r.resume_id,
    job_id: r.job_id,
    resume_title: r.resume_title,
    job_title: r.job_title,
    score: r.score || reportScore(r.report_md),
    has_improved: Boolean(r.improved_md),
    chars: (r.report_md || '').length,
    created_at: r.created_at,
  })).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
}

// 从报告正文提取一句话定论作「评分」展示（如「7/10」或「大概率关闭」）
function reportScore(md) {
  const s = String(md || '')
  const m = s.match(/(\d{1,2})\s*\/\s*10/)
  if (m) return `${m[1]}/10`
  const verdict = s.match(/30\s*秒定论[：:*\s]*([^\n]+)/)
  if (!verdict) return ''
  // 只取第一小句，徽章展示不了整段
  return verdict[1].replace(/\*\*/g, '').split(/[。，,；;：:!？?]/)[0].trim().slice(0, 16)
}

// ── 删除（简历级联删其 JD 与报告）─────────────────────────────────────
export function removeResume(id) {
  const rec = getResume(id)
  if (!rec) return false
  let n = 1
  for (const j of readdirJson(JOBS_DIR)) if (j.resume_id === id) { unlinkSync(join(JOBS_DIR, `${j.job_id}.json`)); n++ }
  for (const r of readdirJson(REPORTS_DIR)) if (r.resume_id === id) { unlinkSync(join(REPORTS_DIR, `${r.report_id}.json`)); n++ }
  unlinkSync(join(RESUMES_DIR, `${id}.json`))
  return n
}
export function removeJob(id) {
  if (!getJob(id)) return false
  unlinkSync(join(JOBS_DIR, `${id}.json`))
  return true
}
export function removeReport(id) {
  if (!getReport(id)) return false
  unlinkSync(join(REPORTS_DIR, `${id}.json`))
  return true
}
export function clearAll() {
  rmSync(DATA_DIR, { recursive: true, force: true })
  ensureDirs()
}

// ── 汇总 ───────────────────────────────────────────────────────────────
export function stats() {
  const resumes = listResumes()
  const jobs = listJobs()
  const reports = listReports()
  return {
    resumes: resumes.length,
    jobs: jobs.length,
    reports: reports.length,
    improved: reports.filter((r) => r.has_improved).length,
  }
}

// ── 内部 ───────────────────────────────────────────────────────────────
function readdirJson(dir) {
  ensureDirs()
  const out = []
  for (const name of readdirSafe(dir)) {
    if (!name.endsWith('.json') || name.includes('.tmp')) continue
    const rec = readJson(join(dir, name))
    if (rec) out.push(rec)
  }
  return out
}
function readdirSafe(dir) {
  try { return readdirSync(dir) } catch { return [] }
}

function firstLine(text, fallback = '') {
  const line = String(text || '').split('\n').map((s) => s.trim()).find(Boolean)
  return line ? line.slice(0, 40) : fallback
}
