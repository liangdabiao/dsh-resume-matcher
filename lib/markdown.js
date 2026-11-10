// markdown 工具：报告渲染（够用子集，与 stock-research 面板同款）+ 优化后简历抽取
// （移植自原项目 app.py 的 _extract_md_block 启发式评分）。

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
}

const isTableSep = (line) => /^\s*\|?[\s:-]*-[\s|:-]*$/.test(line) && line.includes('-') && line.includes('|')

export function renderMarkdown(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (/^\s*```/.test(line)) {
      const buf = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++])
      i++
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`)
      continue
    }
    if (!line.trim()) { i++; continue }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue }
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue }
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const cells = (l) => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim())
      const head = cells(line)
      i += 2
      const body = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) body.push(cells(lines[i++]))
      out.push('<div class="tbl"><table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        body.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>')
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      const buf = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''))
      out.push(`<blockquote>${buf.map(inline).join('<br>')}</blockquote>`)
      continue
    }
    const ol = line.match(/^\s*(\d+)[.)]\s+(.*)$/)
    const ul = line.match(/^\s*[-*+]\s+(.*)$/)
    if (ol || ul) {
      const ordered = Boolean(ol)
      const buf = []
      while (i < lines.length) {
        const m = lines[i].match(ordered ? /^\s*(\d+)[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/)
        if (!m) break
        buf.push(m[ordered ? 2 : 1])
        i++
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*[-*+]\s/.test(lines[i])) buf[buf.length - 1] += ' ' + lines[i++].trim()
      }
      const tag = ordered ? 'ol' : 'ul'
      out.push(`<${tag}>` + buf.map((t) => `<li>${inline(t)}</li>`).join('') + `</${tag}>`)
      continue
    }
    const buf = [line]
    i++
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*[-*+]\s|\s*\d+[.)]\s|>|\s*```)/.test(lines[i]) && !(lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))) {
      buf.push(lines[i++])
    }
    out.push(`<p>${buf.map(inline).join('<br>')}</p>`)
  }
  return out.join('\n')
}

// ── 优化后简历抽取（启发式评分，移植自 app.py 并按中文简历调过阈值）──
// 结尾的 ``` 允许紧跟正文（有些模型不写换行），也容忍 \r\n。
const CODE_BLOCK_RE = /```(?:md|markdown)?[ \t]*\r?\n([\s\S]*?)\r?\n?```/g
const HEADING_RE = /^#{1,2}\s+\S+/gm
const SECTION_RE = /^##\s+\S+/gm
// 简历常见小节标题；命中一个 +5 分。中英混排的简历也认。
const SECTION_KEYWORDS = [
  '工作经历', '教育背景', '项目经验', '项目经历', '技能', '个人信息', '联系方式',
  '工作业绩', '教育经历', '实习经历', '工作项目', '自我评价', '职业概况',
  'Experience', 'Education', 'Skills', 'Projects', 'Summary',
]

function scoreCandidate(candidate) {
  let score = 0
  score += Math.min(Math.floor(candidate.length / 100), 50) // 长度分封顶 50
  for (const kw of SECTION_KEYWORDS) if (candidate.includes(kw)) score += 5
  score += (candidate.match(HEADING_RE) || []).length
  score += (candidate.match(SECTION_RE) || []).length
  return score
}

/**
 * 这段文本像不像一份简历（而不是示例片段 / JSON / 命令）。
 * 技能对 Step 4 有「≤1000 中文字」的字数预算，重写稿本来就会很短，
 * 所以不能再用「长度 >150」当硬门槛——那会把合格的短简历静默判成抽不到，
 * 回退到结构化兜底稿（丢掉了模型的重写内容）。
 * 改成结构信号：命中 ≥2 个小节标题即认；只有 1 个时要求长度 120+。
 */
function looksLikeResume(candidate) {
  const hits = SECTION_KEYWORDS.filter((kw) => candidate.includes(kw)).length
  if (hits >= 2) return true
  if (hits >= 1 && candidate.length >= 120) return true
  return false
}

/**
 * 从分析报告抽 ```md 代码块作为「优化后的简历」。返回 [md, source]。
 * 启发式：长度分 + 小节关键词分 + 结构信号分选「最像简历」的代码块。
 */
export function extractImprovedMd(text) {
  if (!text) return [null, 'none']
  const matches = [...String(text).matchAll(CODE_BLOCK_RE)].map((m) => m[1].trim()).filter(Boolean)
  if (!matches.length) return [null, 'none']
  let best = matches[0]
  let bestScore = scoreCandidate(best)
  for (const c of matches.slice(1)) {
    const s = scoreCandidate(c)
    if (s > bestScore) { best = c; bestScore = s }
  }
  return looksLikeResume(best) ? [best, 'extracted'] : [null, 'none']
}
