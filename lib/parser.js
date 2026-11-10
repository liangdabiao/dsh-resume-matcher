// 文档解析：从 PDF / DOCX 提取纯文本（移植自原项目 parser.py）。
//   DOCX：手解 zip 中央目录取出 word/document.xml，再按文档序把 w:t / w:tab / w:br / w:p
//         转成文本——双列布局的简历（个人信息｜联系方式）不会被压成一团。
//   PDF ：unpdf（pdf.js serverless 构建，纯 JS，无 worker 问题）。
import { inflateRawSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// ── zip 最小读取：中央目录定位 + 单条目解压 ─────────────────────────────
const u16 = (b, o) => b.readUInt16LE(o)
const u32 = (b, o) => b.readUInt32LE(o)

function zipEntry(buf, wanted) {
  // EOCD 签名 0x06054b50，从文件尾向前找（注释区最长 65535 + 22）
  let eocd = -1
  const min = Math.max(0, buf.length - 66000)
  for (let i = buf.length - 22; i >= min; i--) {
    if (u32(buf, i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('Invalid DOCX file: 不是有效的 zip 文件')
  const count = u16(buf, eocd + 10)
  let p = u32(buf, eocd + 16)
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (u32(buf, p) !== 0x02014b50) break
    const method = u16(buf, p + 10)
    const csize = u32(buf, p + 20)
    const nameLen = u16(buf, p + 28)
    const extraLen = u16(buf, p + 30)
    const commentLen = u16(buf, p + 32)
    const lho = u32(buf, p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    if (name === wanted) {
      if (u32(buf, lho) !== 0x04034b50) throw new Error('Invalid DOCX file: local header 损坏')
      const lName = u16(buf, lho + 26)
      const lExtra = u16(buf, lho + 28)
      const start = lho + 30 + lName + lExtra
      const data = buf.subarray(start, start + csize)
      return method === 8 ? inflateRawSync(data) : Buffer.from(data)
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  throw new Error('Invalid DOCX file: missing word/document.xml')
}

// ── document.xml → 文本 ────────────────────────────────────────────────
function decodeXml(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

export function extractDocxText(xmlBuf) {
  const xml = xmlBuf.toString('utf8')
  const out = []
  // 按文档序处理：文本 run / 内容制表符 / 换行 / 段落结束。
  // 只把无属性的 <w:tab/> 当内容 tab（pPr 里 <w:tabs> 的制表位定义带属性，跳过）。
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<\/w:p>/g
  let m
  while ((m = re.exec(xml))) {
    if (m[1] !== undefined) out.push(decodeXml(m[1]))
    else if (m[0].startsWith('<w:tab')) out.push('\t')
    else if (m[0].startsWith('<w:br')) out.push('\n')
    else if (out.length && !out[out.length - 1].endsWith('\n')) out.push('\n')
  }
  return out.join('')
}

export function extractDocx(fileBytes) {
  return extractDocxText(zipEntry(fileBytes, 'word/document.xml'))
}

// ── PDF ────────────────────────────────────────────────────────────────
export async function extractPdf(fileBytes) {
  const { extractText } = await import('unpdf')
  const { text } = await extractText(new Uint8Array(fileBytes), { mergePages: true })
  return Array.isArray(text) ? text.join('\n\n') : String(text || '')
}

// ── 入口 ───────────────────────────────────────────────────────────────
export async function extractFromFile(filePath) {
  // 面板/工具传来的路径可能是 URL 编码过的（中文路径），先还原
  let p = String(filePath || '').trim().replace(/^["']|["']$/g, '')
  if (/%[0-9a-fA-F]{2}/.test(p)) {
    try { p = decodeURIComponent(p) } catch {}
  }
  const ext = extname(p).toLowerCase()
  if (ext !== '.pdf' && ext !== '.docx') {
    throw new Error(`暂只支持 .pdf / .docx，收到的是 ${ext || '无扩展名'}`)
  }
  let buf
  try {
    buf = readFileSync(p)
  } catch (e) {
    throw new Error(`读取文件失败：${p}（${e.code === 'ENOENT' ? '文件不存在' : e.message}）`)
  }
  let text = ext === '.pdf' ? await extractPdf(buf) : extractDocx(buf)
  text = text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim()
  if (!text) throw new Error('未能从文件中提取到文本（可能是扫描件/图片型 PDF，请换文字版）')
  return { path: p, ext: ext.slice(1), text }
}
