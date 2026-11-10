// 简历诊所 · Host 半边（resume_matcher 原生工具 + hr-critic 技能提供方 + 硬规则注入 + 面板数据面）。
// 分析本身由会话模型按 hr-critic 技能完成；工具负责文件解析与档案持久化。
import Schema from '@deepseek-ai/schemastery'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSkillProvider } from '../lib/skills.js'
import { systemSection } from './systemPrompt.js'
import { registerApi } from '../lib/api.js'
import { extractFromFile } from '../lib/parser.js'
import {
  saveResume, saveJob, saveReport, getResume, getJob, getReport,
  listResumes, listJobs, listReports, removeResume, removeJob, removeReport,
  parseProcessed, getLastResumeId, getLastJobId, stats, DATA_DIR,
} from '../lib/store.js'

export const name = 'resume-matcher' // = cordis.patch.yml 的 id

export const inject = ['tools', 'skills', 'systemPrompt', 'webServer', 'connection']

export const Config = Schema.object({
  injectRules: Schema.boolean().default(true).description('注入简历诊所工作流到系统提示'),
})

function check(args, spec) {
  const problems = []
  for (const key of spec.required || []) {
    if (args?.[key] === undefined) problems.push(`缺少必填参数 ${key}`)
  }
  for (const [key, rule] of Object.entries(spec.properties || {})) {
    const value = args?.[key]
    if (value === undefined) continue
    if (rule.enum && !rule.enum.includes(value)) problems.push(`${key} 只能是 ${rule.enum.join(' / ')} 之一`)
  }
  for (const key of Object.keys(args || {})) {
    if (!spec.properties || !(key in spec.properties)) problems.push(`未知参数 ${key}`)
  }
  if (problems.length) throw new Error(`参数有误：${problems.join('；')}。`)
}

const str = (description, extra = {}) => ({ type: 'string', description, ...extra })
const num = (description, extra = {}) => ({ type: 'number', description, ...extra })
const text = (value) => [{ type: 'text', text: value }]

const OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['ok', 'summary'],
    properties: {
      ok: { type: 'boolean' },
      summary: { type: 'string', description: '给模型看的回执' },
      data: { type: 'string', description: '可选：文本/清单/JSON' },
    },
  },
  render: (_args, value) => text(value.data ? `${value.summary}\n\n${value.data}` : value.summary),
}

const result = (ok, summary, data = '') => ({ ok, summary, data })

const KINDS = ['resumes', 'jobs', 'reports']

// 长文本截断展示上限：简历/JD 原文通常 1-3 千字，留足余量
const MAX_TEXT = 30000

const KIND_MARK = { resumes: '📄', jobs: '💼', reports: '🧾' }

// ---------------------------------------------------------------------------
// 工具：resume_matcher —— 解析 + 档案持久化
// ---------------------------------------------------------------------------
export const resumeMatcherTool = {
  name: 'resume_matcher',
  description:
    '简历诊所档案库：解析 PDF/DOCX 简历文件、保存简历/岗位 JD/五步审计报告（持久化，侧栏「简历诊所」面板可看）。' +
    '流程：parse 提取简历文本 → 按 hr-critic 技能抽取结构化信息 → save_resume / save_job 归档 → 分析完成后 archive_report 存档。' +
    '没有归档的报告等于白写；报告里 Step 4 的 ```md 代码块会自动抽取为「优化后简历」，面板可一键复制。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: str('parse 解析文件；save_resume 存简历；save_job 存 JD；list 看清单；get 读档案；archive_report 存报告；remove 删除', {
        enum: ['parse', 'save_resume', 'save_job', 'list', 'get', 'archive_report', 'remove'],
      }),
      path: str('parse：简历文件的绝对路径（.pdf / .docx）'),
      rawText: str('save_resume：简历纯文本（parse 的结果或用户粘贴的原文）'),
      processedJson: str('save_resume/save_job：结构化信息 JSON 字符串（按 hr-critic 技能里的 schema；可选，但建议总是提供）'),
      sourceFile: str('save_resume：可选，来源文件路径'),
      content: str('save_job：JD 原文（用户粘贴的岗位描述文本）'),
      kind: str('list/get/remove：档案类型', { enum: KINDS }),
      id: str('get/remove：档案 id（list 里能看到）'),
      resumeId: str('archive_report：关联的简历 id（save_resume 返回的）'),
      jobId: str('archive_report：关联的 JD id（save_job 返回的）'),
      reportMd: str('archive_report：五步审计报告 markdown 全文'),
      title: str('archive_report：可选，报告标题；缺省自动生成「简历 × 岗位」'),
      confirm: str('remove 删除档案必须传 "yes"（删简历会级联删其 JD 和报告）', { enum: ['yes'] }),
    },
  },
  output: OUTPUT,
  async execute(args) {
    check(args, this.parameters)

    // ── parse ────────────────────────────────────────────────────────────
    if (args.action === 'parse') {
      if (!args.path) throw new Error('parse 需要 path（简历文件绝对路径）。')
      const { path: resolved, ext, text: content } = await extractFromFile(args.path)
      return result(true,
        `已解析 ${ext.toUpperCase()} 文件（${content.length} 字符）：${resolved}。请按 hr-critic 技能抽取结构化信息，然后 save_resume 归档（rawText=全文，processedJson=结构化 JSON）。`,
        content.length > MAX_TEXT ? content.slice(0, MAX_TEXT) + `\n\n…（超长截断，原文共 ${content.length} 字符）` : content)
    }

    // ── save_resume ──────────────────────────────────────────────────────
    if (args.action === 'save_resume') {
      if (!args.rawText && !args.processedJson) throw new Error('save_resume 至少需要 rawText（简历原文）。')
      const processed = parseProcessed(args.processedJson)
      const id = saveResume({ content: args.rawText || '', sourceFile: args.sourceFile || '', processed })
      return result(true,
        `简历已归档：resumeId=${id}${args.sourceFile ? `（来源 ${args.sourceFile}）` : ''}。用户在侧栏「简历诊所」面板能看到。下一步：拿到 JD 后 save_job，然后开始五步审计。`)
    }

    // ── save_job ─────────────────────────────────────────────────────────
    if (args.action === 'save_job') {
      if (!args.content) throw new Error('save_job 需要 content（JD 原文）。')
      const processed = parseProcessed(args.processedJson)
      const id = saveJob({ content: args.content, resumeId: args.resumeId || getLastResumeId(), processed })
      return result(true,
        `JD 已归档：jobId=${id}。现在可以开始五步审计：get 读简历和 JD 原文，产出报告后 archive_report 存档。`)
    }

    // ── archive_report ───────────────────────────────────────────────────
    if (args.action === 'archive_report') {
      if (!args.reportMd) throw new Error('archive_report 需要 reportMd（报告全文）。')
      if (!args.resumeId && !args.jobId) throw new Error('archive_report 至少需要 resumeId 或 jobId 之一。')
      const id = saveReport({ resumeId: args.resumeId || '', jobId: args.jobId || '', reportMd: args.reportMd, title: args.title })
      const r = getReport(id)
      const improved = r?.improved_md ? `优化后简历已自动抽取（${r.improved_md.length} 字符），面板可一键复制。` : '报告中没检测到 ```md 代码块，未抽取优化后简历（建议 Step 4 用 ```md 包住完整简历）。'
      return result(true,
        `报告已存档：reportId=${id}（${r?.title || ''}）。${improved} 把报告全文完整输出给用户，并提醒可在侧栏「简历诊所」查看。`)
    }

    // ── list ─────────────────────────────────────────────────────────────
    if (args.action === 'list') {
      const kind = args.kind || (args.id ? undefined : 'resumes')
      if (kind && !KINDS.includes(kind)) throw new Error(`kind 只能是 ${KINDS.join(' / ')} 之一。`)
      if (!kind) return result(true, '档案库清单：', ['📄 resumes 简历', '💼 jobs 岗位 JD', '🧾 reports 分析报告'].join('\n'))
      if (kind === 'resumes') {
        const all = listResumes()
        if (!all.length) return result(true, '还没有归档的简历。用户给了简历文件就 parse，粘贴了文本就直接 save_resume。')
        return result(true, `共 ${all.length} 份简历：`,
          all.map((r) => `${r.id.slice(0, 8)} · ${r.title}${r.source_file ? ` · ${r.source_file}` : ''} · ${r.chars} 字 · 报告 ${listReports().filter((p) => p.resume_id === r.id).length} · ${String(r.created_at).slice(0, 10)}`).join('\n'))
      }
      if (kind === 'jobs') {
        const all = listJobs()
        if (!all.length) return result(true, '还没有归档的 JD。用户粘贴了岗位描述就 save_job。')
        return result(true, `共 ${all.length} 条 JD：`,
          all.map((j) => `${j.id.slice(0, 8)} · ${j.title}${j.company ? ` @${j.company}` : ''} · ${j.chars} 字 · ${String(j.created_at).slice(0, 10)}`).join('\n'))
      }
      const all = listReports()
      if (!all.length) return result(true, '还没有分析报告。五步审计写完记得 archive_report。')
      return result(true, `共 ${all.length} 份报告：`,
        all.map((r) => `${r.id.slice(0, 8)} · ${r.title}${r.score ? ` · ${r.score}` : ''}${r.has_improved ? ' · 含优化简历' : ''} · ${String(r.created_at).slice(0, 10)}`).join('\n'))
    }

    // ── get ──────────────────────────────────────────────────────────────
    if (args.action === 'get') {
      if (!args.kind) throw new Error('get 需要 kind。')
      const id = args.id || (args.kind === 'resumes' ? getLastResumeId() : args.kind === 'jobs' ? getLastJobId() : '')
      if (!id) throw new Error(`get ${args.kind} 需要 id（list 里能看到；没有档案就先 save）。`)
      if (args.kind === 'resumes') {
        const r = getResume(id)
        if (!r) return result(false, `没有这份简历（id=${id}）。用 list kind=resumes 查看全部。`)
        return result(true, `简历档案 ${r.resume_id}（${String(r.created_at).slice(0, 10)}）：`, clip(r.content) + (r.processed?.processed_at ? '\n\n[已含结构化抽取]' : ''))
      }
      if (args.kind === 'jobs') {
        const j = getJob(id)
        if (!j) return result(false, `没有这条 JD（id=${id}）。用 list kind=jobs 查看全部。`)
        return result(true, `JD 档案 ${j.job_id}（${String(j.created_at).slice(0, 10)}）：`, clip(j.content))
      }
      const r = getReport(id)
      if (!r) return result(false, `没有这份报告（id=${id}）。用 list kind=reports 查看全部。`)
      return result(true, `报告档案 ${r.report_id}（${r.title}）：`, clip(r.report_md))
    }

    // ── remove ───────────────────────────────────────────────────────────
    if (!args.kind || !KINDS.includes(args.kind)) throw new Error(`remove 需要 kind（${KINDS.join(' / ')}）。`)
    if (!args.id) throw new Error('remove 需要 id。')
    if (args.confirm !== 'yes') return result(false, '删除档案请传 confirm:"yes"。删简历会级联删它名下的 JD 和报告，不可恢复。')
    let n
    if (args.kind === 'resumes') n = removeResume(args.id)
    else if (args.kind === 'jobs') n = removeJob(args.id)
    else n = removeReport(args.id)
    if (!n) return result(false, `没有找到这份${args.kind === 'resumes' ? '简历' : args.kind === 'jobs' ? 'JD' : '报告'}（id=${args.id}）。`)
    return result(true, `已删除（${typeof n === 'number' && n > 1 ? `级联删除 ${n} 条档案` : '1 条档案'}）：${args.id}`)
  },
}

function clip(s, max = MAX_TEXT) {
  s = String(s || '')
  return s.length > max ? s.slice(0, max) + `…（超长截断，共 ${s.length} 字符）` : s
}

// ---------------------------------------------------------------------------
// 装配
// ---------------------------------------------------------------------------
export function apply(ctx, config) {
  const skillDirs = [join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')]

  ctx.effect(() => ctx.tools.register(resumeMatcherTool), `${name}: tool matcher`)
  ctx.effect(() => ctx.skills.registerProvider(() => createSkillProvider(skillDirs)), `${name}: skills`)
  ctx.effect(() => ctx.systemPrompt.section(systemSection()), `${name}: workflow`)

  ctx.effect(() => registerApi(ctx, { dataDir: DATA_DIR, statsFn: stats }), `${name}: routes`)
}
