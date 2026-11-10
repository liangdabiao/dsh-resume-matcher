// a4cv 编辑器对接（移植自原项目 app.py 的 _normalize_md_for_a4cv / _build_fallback_markdown）。
//
// 投递通道：a4cv/index.html 内置 pickupResumeFromOptimizer()，init 时最高优先级执行——
//   - ?pickup=session → 读 sessionStorage('pendingResumeMD')（同源部署，本插件主用这条）
//   - ?md=<urlencoded> → 直接 URL 传（分享/新窗口场景）
// a4cv 的 normalizeImportedMarkdown：只要 markdown 含任何 # 标题就直接走 normalizeHeadingMarkdown，
// 不会自动补 # 姓名；LLM 常把姓名写成纯文本首行，所以必须在保存前补上。

// a4cv 能识别的小节标题关键词（与其 looksLikeSectionTitle 对齐）
const SECTION_KEYWORDS =
  '自我评价|个人简介|职业概况|个人优势|工作经历|工作经验|项目经历|项目经验|' +
  '实习经历|教育经历|教育背景|技能|技能特长|专业技能|证书|证书与荣誉|荣誉奖项|' +
  '关键成果|作品集|发表论文|论文发表|社团经历|培训经历|个人信息|联系方式|工作业绩'

// 独立的加粗小节标题行：**工作经历** 或 **工作经历：
const BOLD_SECTION_RE = new RegExp(`^[ \\t]*\\*{2}\\s*(${SECTION_KEYWORDS})\\s*[:：]?\\*{2}[ \\t]*$`, 'gm')

/**
 * 标准化简历 markdown，让 a4cv 正确识别结构：
 * 1. 加粗小节标题转 ## 标题：**工作经历** → ## 工作经历
 * 2. 首个非空行若是纯姓名（非 # 标题、非联系方式行），补成 # 姓名
 */
export function normalizeForA4cv(md) {
  if (!md) return md
  md = md.replace(/\r\n/g, '\n')
  md = md.replace(BOLD_SECTION_RE, (_, title) => `## ${title}`)

  const lines = md.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim()
    if (!stripped) continue // 跳过前导空行
    if (stripped.startsWith('#')) break // 首个非空行已是标题，无需补
    // 联系方式行（含 @ 或 4 位以上连续数字）不当作姓名
    if (stripped.includes('@') || /\d{4,}/.test(stripped)) break
    lines[i] = `# ${stripped}`
    break
  }
  return lines.join('\n')
}

/**
 * 从结构化简历（snake_case 归一化后的 processed）拼 a4cv 兼容的最小 markdown。
 * 用在报告里抽不出 ```md 代码块时的兜底。
 */
export function buildFallbackMarkdown(processed = {}) {
  const pd = processed.personal_data || {}
  // 姓+名都在时拼全名（原项目只取 firstName，中文简历会丢姓氏）
  const fullName = pd.lastName && pd.firstName ? `${pd.lastName}${pd.firstName}` : ''
  const name = fullName || pd.firstName || pd.name || '你的姓名'
  const title = pd.title || pd.position || ''

  const contactBits = []
  for (const key of ['email', 'phone']) {
    if (pd[key]) contactBits.push(String(pd[key]))
  }
  const loc = pd.location
  if (loc && typeof loc === 'object' && loc.city) contactBits.push(String(loc.city))
  for (const key of ['linkedin', 'portfolio']) {
    if (pd[key]) contactBits.push(String(pd[key]))
  }

  const out = [`# ${name}`]
  if (title) out.push(`## ${title}`)
  if (contactBits.length) out.push('', '> ' + contactBits.join(' · '))

  const experiences = processed.experiences || []
  if (experiences.length) {
    out.push('', '## 工作经历')
    for (const e of experiences) {
      const t = e.job_title || e.jobTitle || '职位'
      const c = e.company || ''
      const sd = e.start_date || e.startDate || ''
      const ed = e.end_date || e.endDate || ''
      const meta = [c, sd ? `${sd} - ${ed || ''}` : ''].filter(Boolean).join(' · ')
      out.push(`### ${t}` + (meta ? ` | ${meta}` : ''))
      for (const b of e.description || []) if (b) out.push(`- ${b}`)
    }
  }

  const projects = processed.projects || []
  if (projects.length) {
    out.push('', '## 项目经历')
    for (const p of projects) {
      const t = p.project_name || p.projectName || '项目'
      const desc = p.description || ''
      out.push(`### ${t}`)
      if (desc) out.push(`- ${desc}`)
    }
  }

  const education = processed.education || []
  if (education.length) {
    out.push('', '## 教育背景')
    for (const ed of education) {
      const school = ed.institution || '学校'
      const degree = ed.degree || ''
      out.push(`### ${school}` + (degree ? ` | ${degree}` : ''))
    }
  }

  const skills = processed.skills || []
  if (skills.length) {
    out.push('', '## 技能标签')
    const names = skills.map((s) => (typeof s === 'object' ? s.skill_name || s.skillName || '' : String(s)))
    out.push(names.filter(Boolean).join(' · '))
  }

  const achievements = processed.achievements || []
  if (achievements.length) {
    out.push('', '## 证书与荣誉')
    for (const a of achievements) out.push(`- ${a}`)
  }

  return out.join('\n').replace(/\s+$/, '') + '\n'
}

/** 统计 1-3 级标题数（a4cv 结构完整性的粗略指标） */
export function countSections(md) {
  const m = String(md || '').match(/^#{1,3}\s+\S+/gm)
  return m ? m.length : 0
}
