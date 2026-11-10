// 简历诊所 · 面板逻辑：hash 路由 + 概览/简历库/岗位库/报告/发起分析。
// 「发起分析」把一段草稿 postMessage 给 client.js，由宿主开新对话（草稿只填进输入框，不自动发送）。
(() => {
  const $app = document.getElementById('app')
  const $toast = document.getElementById('toast')

  const state = { catalog: null }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const fmtDate = (iso) => String(iso || '').slice(0, 10)
  const fmtTime = (iso) => String(iso || '').replace('T', ' ').slice(0, 16)

  // ---------- 基础 ----------
  async function api(path) {
    const res = await fetch(`/resume-matcher${path}`)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    return body
  }
  async function apiPost(path, payload) {
    const res = await fetch(`/resume-matcher${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload || {}),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    return body
  }

  let toastTimer = null
  function toast(msg, isErr) {
    $toast.textContent = msg
    $toast.className = `toast show${isErr ? ' err' : ''}`
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { $toast.className = 'toast' }, 2600)
  }

  async function copyText(text, okMsg) {
    try {
      await navigator.clipboard.writeText(text)
      toast(okMsg || '已复制到剪贴板')
    } catch {
      toast('复制失败，请手动选择文本', true)
    }
  }
  function download(name, text) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    toast(`已下载 ${name}`)
  }

  const ICONS = {
    home: '<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/>',
    doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 15.5h6"/>',
    briefcase: '<rect x="4" y="8" width="16" height="11"/><path d="M9 8V5h6v3"/><path d="M4 12.5h16"/>',
    report: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9.5 15l2 2 3.5-4"/>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
    back: '<path d="M14 6l-6 6 6 6"/>',
    go: '<path d="M9 6l6 6-6 6"/>',
    trash: '<path d="M5 7h14"/><path d="M9 7V5h6v2"/><path d="M7 7l1 13h8l1-13"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
    open: '<path d="M14 4h6v6"/><path d="M20 4L10 14"/><path d="M18 13v7H4V6h7"/>',
    copy: '<rect x="8" y="8" width="12" height="12"/><path d="M16 8V4H4v12h4"/>',
    download: '<path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/>',
  }
  function ic(name, cls = 'ic') {
    return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`
  }

  // ---------- 目录 ----------
  async function loadCatalog() {
    state.catalog = await api('/api/catalog')
    renderNavCounts()
    renderRailFoot()
    return state.catalog
  }
  function renderNavCounts() {
    const c = state.catalog
    if (!c) return
    document.querySelectorAll('[data-count]').forEach((n) => {
      const v = { resumes: c.stats.resumes, jobs: c.stats.jobs, reports: c.stats.reports }[n.dataset.count]
      n.textContent = v != null ? v : ''
    })
  }
  function renderRailFoot() {
    const c = state.catalog
    if (!c) return
    document.getElementById('rail-foot').innerHTML =
      `<div class="v-head">RESUME CLINIC v${esc(c.version)}</div>` +
      `<div class="v-row"><span>简历 / 岗位 / 报告</span><span>${c.stats.resumes} / ${c.stats.jobs} / ${c.stats.reports}</span></div>` +
      `<div class="v-row"><span>优化简历</span><span>${c.stats.improved}</span></div>`
  }

  // ---------- 视图：概览 ----------
  function viewHome() {
    const c = state.catalog
    if (!c) return '<div class="loading">LOADING…</div>'
    const recent = c.reports.slice(0, 4)
    return `
      <header class="head">
        <span class="eyebrow">RESUME CLINIC</span>
        <div class="head-row">
          <h1>简历<strong>诊所</strong></h1>
          <div class="actions"><a class="btn" href="#/start">${ic('spark')}发起分析</a></div>
        </div>
        <p>把简历（PDF / DOCX / 文本）和目标岗位 JD 交给对话模型：结构化归档 → HR 视角五步深度审计 → 报告与优化后简历存档，在这里随时回看。</p>
      </header>
      <div class="stats">
        <div class="stat"><div class="mono">RESUMES</div><div class="val">${c.stats.resumes}</div><div class="sub">归档简历</div></div>
        <div class="stat"><div class="mono">JOBS</div><div class="val">${c.stats.jobs}</div><div class="sub">目标岗位</div></div>
        <div class="stat"><div class="mono">REPORTS</div><div class="val">${c.stats.reports}</div><div class="sub">审计报告</div></div>
        <div class="stat"><div class="mono">IMPROVED</div><div class="val">${c.stats.improved}</div><div class="sub">可复制的优化简历</div></div>
      </div>
      <section class="sec">
        <div class="sec-head"><span class="num">01</span><h2>最近报告</h2><a class="more" href="#/reports">全部 ${c.stats.reports} 份 →</a></div>
        ${recent.length ? `<div class="cards">${recent.map(reportCard).join('')}</div>`
          : `<div class="empty"><div class="e-title">还没有报告</div><p>去侧栏「发起分析」选一份简历和一个岗位开跑；或者直接在对话里把简历文件和 JD 发给模型。</p></div>`}
      </section>
      <section class="sec">
        <div class="sec-head"><span class="num">02</span><h2>怎么用</h2></div>
        <div class="cards">
          <div class="card step"><div class="num">1</div><div class="c-title">投喂材料</div><p>在对话里发简历文件（PDF/DOCX）或粘贴文本，再给一段目标岗位 JD。模型会解析并结构化归档。</p></div>
          <div class="card step"><div class="num">2</div><div class="c-title">五步审计</div><p>第一印象 → 地毯式审计 → 修改蓝图 → 重写简历 → 最终裁决。批判-解析-建议三段式，按职级调整力度。</p></div>
          <div class="card step"><div class="num">3</div><div class="c-title">回看与复用</div><p>报告自动存档在这里；Step 4 的优化简历会单独抽取，一键复制或下载 .md。</p></div>
        </div>
      </section>`
  }

  function reportCard(r) {
    return `<a class="card" href="#/report/${esc(r.id)}">
      <div class="c-top"><span class="mono">${esc(fmtDate(r.created_at))}</span>${r.score ? `<span class="score">${esc(r.score)}</span>` : ''}</div>
      <div class="c-title">${esc(r.title)}</div>
      <div class="c-sub">${esc([r.resume_title, r.job_title].filter(Boolean).join(' × ') || '独立报告')}</div>
      <div class="c-foot"><span>${r.has_improved ? '含优化简历' : '—'}</span><span style="margin-left:auto">${ic('go')}</span></div>
    </a>`
  }

  // ---------- 视图：简历库 ----------
  function viewResumes() {
    const list = state.catalog.resumes
    if (!list.length) {
      return head('简历库', '简历 / RESUMES') + `<div class="empty"><div class="e-title">还没有归档的简历</div>
        <p>在对话里把简历 PDF/DOCX 文件或文本发给模型，它会解析、结构化并存档到这里。</p></div>`
    }
    return head('简历库', '简历 / RESUMES') + `<div class="rows">${list.map((r) => `
      <a class="row" href="#/resume/${esc(r.id)}">
        ${ic('doc')}
        <div class="r-main"><div class="r-title">${esc(r.title)}</div>
          <div class="r-sub">${esc(r.source_file || '粘贴文本')} · ${r.chars} 字${r.processed_at ? ' · 已结构化' : ''}</div></div>
        <span class="r-meta">${esc(fmtDate(r.created_at))}</span>
        <span class="r-go">${ic('go')}</span>
      </a>`).join('')}</div>`
  }

  function viewResume(id) {
    return page(async () => {
      const { resume: r } = await api(`/api/resume?id=${encodeURIComponent(id)}`)
      const reports = state.catalog.reports.filter((x) => x.resume_id === id)
      const p = r.processed || {}
      const pd = p.personal_data || {}
      const meta = [
        pd.email && ['EMAIL', pd.email],
        pd.phone && ['PHONE', pd.phone],
        pd.location && ['LOCATION', [pd.location.city, pd.location.country].filter(Boolean).join(', ')],
        pd.linkedin && ['LINKEDIN', pd.linkedin],
        pd.portfolio && ['PORTFOLIO', pd.portfolio],
        r.source_file && ['SOURCE', r.source_file],
      ].filter(Boolean)
      return `
        <a class="back" href="#/resumes">${ic('back')} 简历库</a>
        <div class="detail-head">
          <h1>${esc(r.processed ? titleOf(r) : '未命名简历')}</h1>
          <div class="actions">
            <button class="btn ghost" data-copy="${esc(r.content)}">${ic('copy')}复制原文</button>
            <button class="ibtn" data-del="resumes" data-id="${esc(id)}" title="删除（级联删 JD 与报告）">${ic('trash')}</button>
          </div>
        </div>
        <div class="meta-grid">${meta.map(([k, v]) => `<div class="meta-item"><div class="mono">${k}</div><div class="v">${esc(v)}</div></div>`).join('') || ''}
          <div class="meta-item"><div class="mono">CREATED</div><div class="v">${esc(fmtTime(r.created_at))}</div></div>
        </div>
        ${p.experiences?.length ? tlList('工作经历', p.experiences, 'jobTitle', 'company', 'description', 'technologiesUsed') : ''}
        ${p.projects?.length ? tlList('项目经历', p.projects, 'projectName', '', 'description', 'technologiesUsed') : ''}
        ${p.education?.length ? tlBlock('教育背景', p.education, (e) => `
          <div class="tl-head"><span class="tl-title">${esc(e.degree || '')}${e.fieldOfStudy ? ` · ${esc(e.fieldOfStudy)}` : ''}</span>
          <span class="tl-org">${esc(e.institution || '')}</span>
          <span class="tl-date">${esc(e.startDate || '')} ~ ${esc(e.endDate || '')}</span></div>
          ${e.grade ? `<div class="c-sub" style="margin-top:4px">${esc(e.grade)}</div>` : ''}`) : ''}
        ${p.skills?.length ? block('技能', `<div class="tags">${p.skills.map((s) => `<span class="tag">${esc(s.skillName || s.category || '')}</span>`).join('')}</div>`) : ''}
        ${p.achievements?.length ? block('荣誉成就', `<ul>${p.achievements.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`) : ''}
        ${p.extracted_keywords?.length ? block('抽取关键词', `<div class="tags">${p.extracted_keywords.map((k) => `<span class="tag">${esc(k)}</span>`).join('')}</div>`) : ''}
        ${reports.length ? block(`关联报告（${reports.length}）`, `<div class="rows">${reports.map((x) => `
          <a class="row" href="#/report/${esc(x.id)}">${ic('report')}
            <div class="r-main"><div class="r-title">${esc(x.title)}</div></div>
            ${x.score ? `<span class="score">${esc(x.score)}</span>` : ''}
            <span class="r-meta">${esc(fmtDate(x.created_at))}</span><span class="r-go">${ic('go')}</span></a>`).join('')}</div>`) : ''}
        <details class="raw block"><summary>简历原文（${r.chars} 字）</summary><pre>${esc(r.content)}</pre></details>`
    })
  }

  // ---------- 视图：岗位库 ----------
  function viewJobs() {
    const list = state.catalog.jobs
    if (!list.length) {
      return head('岗位库', '岗位 / JOBS') + `<div class="empty"><div class="e-title">还没有归档的 JD</div>
        <p>在对话里把目标岗位描述（招聘页全文即可）发给模型，它会结构化并存档。有 JD 才能做匹配审计。</p></div>`
    }
    return head('岗位库', '岗位 / JOBS') + `<div class="rows">${list.map((j) => `
      <a class="row" href="#/job/${esc(j.id)}">
        ${ic('briefcase')}
        <div class="r-main"><div class="r-title">${esc(j.title)}</div>
          <div class="r-sub">${esc(j.company || '未填公司')} · ${j.chars} 字</div></div>
        <span class="r-meta">${esc(fmtDate(j.created_at))}</span>
        <span class="r-go">${ic('go')}</span>
      </a>`).join('')}</div>`
  }

  function viewJob(id) {
    return page(async () => {
      const { job: j } = await api(`/api/job?id=${encodeURIComponent(id)}`)
      const p = j.processed || {}
      const cp = p.company_profile || {}
      const loc = p.location || {}
      const quals = p.qualifications || {}
      const reports = state.catalog.reports.filter((x) => x.job_id === id)
      return `
        <a class="back" href="#/jobs">${ic('back')} 岗位库</a>
        <div class="detail-head">
          <h1>${esc(p.job_title || '未命名岗位')}</h1>
          <div class="actions">
            <button class="btn ghost" data-copy="${esc(j.content)}">${ic('copy')}复制原文</button>
            <button class="ibtn" data-del="jobs" data-id="${esc(id)}" title="删除">${ic('trash')}</button>
          </div>
        </div>
        <div class="meta-grid">
          <div class="meta-item"><div class="mono">COMPANY</div><div class="v">${esc(cp.companyName || '—')}</div></div>
          <div class="meta-item"><div class="mono">LOCATION</div><div class="v">${esc([loc.city, loc.country].filter(Boolean).join(', ') || '—')}${loc.remoteStatus ? ` · ${esc(loc.remoteStatus)}` : ''}</div></div>
          <div class="meta-item"><div class="mono">TYPE</div><div class="v">${esc(p.employmentType || '—')}</div></div>
          <div class="meta-item"><div class="mono">CREATED</div><div class="v">${esc(fmtTime(j.created_at))}</div></div>
        </div>
        ${p.job_summary ? block('岗位概要', `<p style="margin:0;color:var(--text-body)">${esc(p.job_summary)}</p>`) : ''}
        ${p.key_responsibilities?.length ? block('岗位职责', `<ul>${p.key_responsibilities.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`) : ''}
        ${quals.required?.length ? block('任职要求（必须）', `<ul>${quals.required.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`) : ''}
        ${quals.preferred?.length ? block('任职要求（优先）', `<ul>${quals.preferred.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`) : ''}
        ${p.extracted_keywords?.length ? block('抽取关键词', `<div class="tags">${p.extracted_keywords.map((k) => `<span class="tag">${esc(k)}</span>`).join('')}</div>`) : ''}
        ${reports.length ? block(`关联报告（${reports.length}）`, `<div class="rows">${reports.map((x) => `
          <a class="row" href="#/report/${esc(x.id)}">${ic('report')}
            <div class="r-main"><div class="r-title">${esc(x.title)}</div></div>
            ${x.score ? `<span class="score">${esc(x.score)}</span>` : ''}
            <span class="r-meta">${esc(fmtDate(x.created_at))}</span><span class="r-go">${ic('go')}</span></a>`).join('')}</div>`) : ''}
        <details class="raw block"><summary>JD 原文（${j.chars} 字）</summary><pre>${esc(j.content)}</pre></details>`
    })
  }

  // ---------- 视图：报告 ----------
  function viewReports() {
    const list = state.catalog.reports
    if (!list.length) {
      return head('分析报告', '报告 / REPORTS') + `<div class="empty"><div class="e-title">还没有分析报告</div>
        <p>去「发起分析」选简历和岗位开跑；报告存档后会出现在这里。</p></div>`
    }
    return head('分析报告', '报告 / REPORTS') + `<div class="rows">${list.map((r) => `
      <a class="row" href="#/report/${esc(r.id)}">
        ${ic('report')}
        <div class="r-main"><div class="r-title">${esc(r.title)}</div>
          <div class="r-sub">${esc([r.resume_title, r.job_title].filter(Boolean).join(' × ') || '独立报告')}${r.has_improved ? ' · 含优化简历' : ''}</div></div>
        ${r.score ? `<span class="score">${esc(r.score)}</span>` : ''}
        <span class="r-meta">${esc(fmtDate(r.created_at))}</span>
        <span class="r-go">${ic('go')}</span>
      </a>`).join('')}</div>`
  }

  function viewReport(id) {
    return page(async () => {
      const { report: r } = await api(`/api/report?id=${encodeURIComponent(id)}`)
      const safeName = (r.title || 'report').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40)
      return `
        <a class="back" href="#/reports">${ic('back')} 分析报告</a>
        <div class="detail-head">
          <h1>${esc(r.title)}</h1>
          <div class="actions">
            ${r.improved_md ? `<a class="btn accent" href="#/editor/${esc(id)}">${ic('edit')}编辑器微调</a>` : ''}
            ${r.improved_md ? `<button class="btn ghost" data-copy="${esc(r.improved_md)}" data-msg="优化后简历已复制">${ic('copy')}复制</button>` : ''}
            <button class="btn ghost" data-dl-report="${esc(id)}" data-name="${esc(safeName)}">${ic('download')}下载报告</button>
            <button class="ibtn" data-del="reports" data-id="${esc(id)}" title="删除报告">${ic('trash')}</button>
          </div>
        </div>
        <div class="meta-grid">
          <div class="meta-item"><div class="mono">RESUME</div><div class="v">${r.resume_id ? `<a href="#/resume/${esc(r.resume_id)}">${esc(r.resume_title || '查看简历')} →</a>` : '—'}</div></div>
          <div class="meta-item"><div class="mono">JOB</div><div class="v">${r.job_id ? `<a href="#/job/${esc(r.job_id)}">${esc(r.job_title || '查看岗位')} →</a>` : '—'}</div></div>
          ${r.score ? `<div class="meta-item"><div class="mono">SCORE</div><div class="v" style="color:var(--accent)">${esc(r.score)}</div></div>` : ''}
          <div class="meta-item"><div class="mono">CREATED</div><div class="v">${esc(fmtTime(r.created_at))}</div></div>
        </div>
        ${r.improved_md ? `<div class="improved">
          <div class="block-head"><h3>优化后的简历（Step 4 自动抽取）</h3>
            <div class="actions">
              <button class="btn ghost" data-copy="${esc(r.improved_md)}" data-msg="优化后简历已复制">${ic('copy')}复制</button>
              <button class="btn ghost" data-dl-improved="${esc(id)}" data-name="${esc(safeName)}">${ic('download')}.md</button>
            </div></div>
          <pre>${esc(r.improved_md)}</pre></div>` : ''}
        <div class="article">${r.html || '<p>（报告内容为空）</p>'}</div>`
    })
  }

  // ---------- 视图：a4cv 编辑器 ----------
  // 投递通道（a4cv 内置 pickupResumeFromOptimizer，init 时最高优先级）：
  //   主：同源 sessionStorage('pendingResumeMD') + ?pickup=session
  //   辅：新窗口 ?md=<urlencoded>
  function viewEditor(id) {
    return page(async () => {
      const { report: r } = await api(`/api/report?id=${encodeURIComponent(id)}`)
      if (!r.improved_md) throw new Error('这份报告没有可编辑的优化简历（Step 4 需要 ```md 代码块）')
      const md = r.improved_md
      return [`
        <div class="editor-wrap">
          <div class="editor-bar">
            <a class="back" href="#/report/${esc(id)}" style="margin-bottom:0">${ic('back')} 返回报告</a>
            <span class="editor-title">${esc(r.title)} · a4cv 可视化微调</span>
            <div class="actions">
              <button class="btn ghost" data-copy="${esc(md)}" data-msg="优化后简历已复制">${ic('copy')}复制 MD</button>
              <button class="btn ghost" id="a4cv-open">${ic('open')}新窗口</button>
            </div>
          </div>
          <iframe class="editor-frame" id="a4cv-frame" src="about:blank" title="a4cv 可视化简历编辑器" style="border:0;display:block;background:var(--paper)"></iframe>
        </div>`,
      () => {
        // 渲染后再投递：先写 sessionStorage 再换 src，a4cv init 时 pickup 命中
        const frame = document.getElementById('a4cv-frame')
        if (frame) {
          try { sessionStorage.setItem('pendingResumeMD', md) } catch {}
          frame.src = '/resume-matcher/a4cv/index.html?pickup=session'
        }
        const open = document.getElementById('a4cv-open')
        if (open) open.onclick = () => {
          try { window.open(`/resume-matcher/a4cv/index.html?md=${encodeURIComponent(md)}`, '_blank') } catch {}
        }
      }]
    })
  }

  // ---------- 视图：发起分析 ----------
  function viewStart() {
    const c = state.catalog
    const sel = (list, ph) => `<option value="">${ph}</option>` +
      list.map((x) => `<option value="${esc(x.id)}">${esc(x.title)}（${esc(x.id.slice(0, 8))}）</option>`).join('')
    const noResume = !c.resumes.length
    const noJob = !c.jobs.length
    return `
      <a class="back" href="#/">${ic('back')} 概览</a>
      <header class="head">
        <span class="eyebrow">NEW ANALYSIS</span>
        <h1>发起<strong>五步审计</strong></h1>
        <p>选一份简历和一个目标岗位，生成分析草稿。点击按钮后会在宿主里开一个<b>新对话</b>并把草稿填进输入框——检查没问题再发送。</p>
      </header>
      <div class="form">
        <div class="field">
          <label>RESUME · 简历</label>
          <select id="start-resume">${sel(c.resumes, noResume ? '（还没有简历档案）' : '选择简历…')}</select>
          ${noResume ? '<div class="hint">还没有简历档案：先在对话里发简历文件（PDF/DOCX）或粘贴文本给模型，它会归档。</div>' : ''}
        </div>
        <div class="field">
          <label>JOB · 目标岗位 JD</label>
          <select id="start-job">${sel(c.jobs, noJob ? '（还没有 JD 档案）' : '选择岗位…')}</select>
          ${noJob ? '<div class="hint">还没有 JD 档案：把招聘页全文粘贴给模型，它会 save_job 归档后再来。</div>' : ''}
        </div>
        <div class="field">
          <label>PROMPT · 分析草稿预览</label>
          <div class="prompt-preview" id="start-preview"></div>
        </div>
        <div><button class="btn accent" id="start-go" ${noResume || noJob ? 'disabled' : ''}>${ic('spark')}开新对话发起分析</button></div>
      </div>`
  }

  function bindStart() {
    const rSel = document.getElementById('start-resume')
    const jSel = document.getElementById('start-job')
    const preview = document.getElementById('start-preview')
    const go = document.getElementById('start-go')
    if (!rSel || !jSel) return
    const compose = () => {
      const r = state.catalog.resumes.find((x) => x.id === rSel.value)
      const j = state.catalog.jobs.find((x) => x.id === jSel.value)
      preview.textContent = !r || !j ? '（选择简历和岗位后自动生成）' : buildPrompt(r, j)
      go.disabled = !r || !j
    }
    rSel.onchange = jSel.onchange = compose
    compose()
    go.onclick = () => {
      const r = state.catalog.resumes.find((x) => x.id === rSel.value)
      const j = state.catalog.jobs.find((x) => x.id === jSel.value)
      if (!r || !j) return
      try {
        parent.postMessage({ type: 'resume-matcher:start', prompt: buildPrompt(r, j) }, location.origin)
        toast('已在新对话填入分析草稿，去检查后发送')
      } catch (e) {
        toast(`发起失败：${e.message}`, true)
      }
    }
  }

  function buildPrompt(r, j) {
    return [
      '请用 hr-critic 技能做简历深度分析：',
      `- 简历档案：${r.id}（${r.title}）`,
      `- JD 档案：${j.id}（${j.title}）`,
      '',
      `先用 resume_matcher 工具分别 get 这两条档案拿原文，然后按五步框架（第一印象/地毯式审计/修改蓝图/重写简历/最终裁决）产出完整中文报告，`,
      `最后用 resume_matcher(action="archive_report", resumeId="${r.id}", jobId="${j.id}", reportMd=<报告全文>) 存档，并把报告全文完整输出给我。`,
    ].join('\n')
  }

  // ---------- 渲染辅助 ----------
  function head(title, eyebrow, actionsHtml = '') {
    return `<header class="head"><span class="eyebrow">${esc(eyebrow)}</span>
      <div class="head-row"><h1>${esc(title)}</h1><div class="actions">${actionsHtml}</div></div></header>`
  }
  const block = (title, bodyHtml, mono = '') => `<div class="block">
    <div class="block-head"><h3>${esc(title)}</h3>${mono ? `<span class="mono">${esc(mono)}</span>` : ''}</div>
    <div class="block-body">${bodyHtml}</div></div>`
  const tlBlock = (title, items, render) => `<div class="block">
    <div class="block-head"><h3>${esc(title)}</h3></div>
    <div class="block-body"><div class="tl">${items.map((x) => `<div class="tl-item">${render(x)}</div>`).join('')}</div></div></div>`
  function tlList(title, items, titleKey, orgKey, descKey, techKey) {
    return tlBlock(title, items, (x) => `
      <div class="tl-head"><span class="tl-title">${esc(x[titleKey] || '')}</span>
      ${orgKey && x[orgKey] ? `<span class="tl-org">${esc(x[orgKey])}</span>` : ''}
      <span class="tl-date">${esc(x.startDate || '')} ~ ${esc(x.endDate || '')}</span></div>
      ${x.location ? `<div class="c-sub" style="margin-top:2px">${esc(x.location)}</div>` : ''}
      ${Array.isArray(x[descKey]) && x[descKey].length ? `<ul>${x[descKey].map((d) => `<li>${esc(d)}</li>`).join('')}</ul>`
        : x[descKey] ? `<p style="margin-top:6px;font-size:13px;color:var(--text-body)">${esc(x[descKey])}</p>` : ''}
      ${x[techKey]?.length ? `<div class="tech">${esc([].concat(x[techKey]).join(' · '))}</div>` : ''}`)
  }
  function titleOf(r) {
    const pd = r.processed?.personal_data
    if (pd && (pd.firstName || pd.lastName)) return `${pd.lastName || ''}${pd.firstName || ''}`.trim()
    return (r.content || '').split('\n').map((s) => s.trim()).find(Boolean)?.slice(0, 40) || '未命名简历'
  }

  // async 视图包装：先放 loading，取数后渲染；loader 可返回 [html, afterRender]。
  // 失败显示空态（首次打开无数据不白屏）。
  function page(loader) {
    $app.innerHTML = '<div class="loading">LOADING…</div>'
    loader().then((result) => {
      const [html, after] = Array.isArray(result) ? result : [result, null]
      $app.innerHTML = html
      bindDetail()
      if (after) after()
    }).catch((e) => { $app.innerHTML = `<div class="empty"><div class="e-title">加载失败</div><p>${esc(e.message)}</p></div>` })
  }

  function bindDetail() {
    $app.querySelectorAll('[data-copy]').forEach((b) => {
      b.onclick = () => copyText(b.dataset.copy, b.dataset.msg || '已复制到剪贴板')
    })
    $app.querySelectorAll('[data-dl-report]').forEach((b) => {
      b.onclick = async () => {
        try {
          const { report: r } = await api(`/api/report?id=${encodeURIComponent(b.dataset.dlReport)}`)
          download(`${b.dataset.name || 'report'}.md`, r.report_md || '')
        } catch (e) { toast(e.message, true) }
      }
    })
    $app.querySelectorAll('[data-dl-improved]').forEach((b) => {
      b.onclick = async () => {
        try {
          const { report: r } = await api(`/api/report?id=${encodeURIComponent(b.dataset.dlImproved)}`)
          download(`${b.dataset.name || 'resume'}_optimized.md`, r.improved_md || '')
        } catch (e) { toast(e.message, true) }
      }
    })
    $app.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        const kind = b.dataset.del
        const names = { resumes: '简历（会级联删其 JD 与报告）', jobs: '这条 JD', reports: '这份报告' }
        if (!confirm(`确认删除${names[kind]}？不可恢复。`)) return
        try {
          await apiPost(`/api/${kind === 'resumes' ? 'resume' : kind === 'jobs' ? 'job' : 'report'}/remove`, { id: b.dataset.id })
          toast('已删除')
          await loadCatalog()
          location.hash = kind === 'resumes' ? '#/resumes' : kind === 'jobs' ? '#/jobs' : '#/reports'
        } catch (e) { toast(e.message, true) }
      }
    })
    bindStart()
  }

  // ---------- 路由 ----------
  // 每次导航先刷新目录：agent 刚归档完、用户切视图就能看到新数据；失败用旧数据兜底
  async function render() {
    try { await loadCatalog() } catch {}
    const hash = location.hash || '#/'
    const m =
      hash.match(/^#\/resume\/([\w-]+)$/) || hash.match(/^#\/resumes\/([\w-]+)$/)
    const mj = hash.match(/^#\/jobs\/([\w-]+)$/)
    const mr = hash.match(/^#\/report\/([\w-]+)$/)
    const me = hash.match(/^#\/editor\/([\w-]+)$/)
    $app.classList.toggle('bare', Boolean(me))
    document.querySelectorAll('.nav a').forEach((a) => {
      const cur = hash === '#/' ? 'home' : hash.startsWith('#/start') ? 'start'
        : hash.startsWith('#/resumes') || m ? 'resumes'
        : hash.startsWith('#/jobs') || mj ? 'jobs'
        : hash.startsWith('#/reports') || hash.startsWith('#/report/') || hash.startsWith('#/editor/') || mr || me ? 'reports' : 'home'
      a.classList.toggle('on', a.dataset.view === cur)
    })
    if (m) return viewResume(m[1]) // page() 自己负责 innerHTML
    if (mj) return viewJob(mj[1])
    if (mr) return viewReport(mr[1])
    if (me) return viewEditor(me[1])
    if (hash.startsWith('#/resumes')) $app.innerHTML = viewResumes()
    else if (hash.startsWith('#/jobs')) $app.innerHTML = viewJobs()
    else if (hash.startsWith('#/reports')) $app.innerHTML = viewReports()
    else if (hash.startsWith('#/start')) $app.innerHTML = viewStart()
    else $app.innerHTML = viewHome()
    bindDetail()
  }

  async function boot() {
    try {
      await loadCatalog()
    } catch (e) {
      // 面板先兜底渲染，数据服务没就绪也不白屏
      state.catalog = { version: '-', dataDir: '', stats: { resumes: 0, jobs: 0, reports: 0, improved: 0 }, resumes: [], jobs: [], reports: [] }
      renderNavCounts()
    }
    render().catch(() => {})
  }

  addEventListener('hashchange', render)
  boot()
  // 数据服务可能晚于面板就绪：首次失败后轮询一次
  setTimeout(() => { if (!state.catalog.dataDir) boot() }, 2500)
})()
