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

// ── 优化后简历抽取（照搬 app.py 的启发式评分）─────────────────────────
const CODE_BLOCK_RE = /```(?:md|markdown)?[ \t]*\n([\s\S]+?)\n```/g
const HEADING_RE = /^#{1,2}\s+\S+/gm
const SECTION_RE = /^##\s+\S+/gm
// 简历常见中文小节标题；命中一个 +5 分
const SECTION_KEYWORDS = [
  '工作经历', '教育背景', '项目经验', '项目经历', '技能', '个人信息', '联系方式',
  '工作业绩', '教育经历', '实习经历', '工作项目', '自我评价', '职业概况',
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
 * 从分析报告抽 ```md 代码块作为「优化后的简历」。返回 [md, source]。
 * 启发式：长度分 + 小节关键词分 + 结构信号分，取最高且 ≥5 分、长度 >150。
 */
export function extractImprovedMd(text) {
  if (!text) return [null, 'none']
  const matches = [...String(text).matchAll(CODE_BLOCK_RE)].map((m) => m[1])
  if (!matches.length) return [null, 'none']
  let best = matches[0]
  let bestScore = scoreCandidate(best)
  for (const c of matches.slice(1)) {
    const s = scoreCandidate(c)
    if (s > bestScore) { best = c; bestScore = s }
  }
  best = best.trim()
  if (bestScore >= 5 && best.length > 150) return [best, 'extracted']
  return [null, 'none']
}
