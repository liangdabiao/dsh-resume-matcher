// 预览种子数据：解析原项目真实样例（简历 DOCX + JD txt），存档案并写一份完整五步报告。
//   DSH_HOME=<dir> node scripts/seed-preview.mjs
import { readFileSync } from 'node:fs'
import { extractFromFile } from '../lib/parser.js'
import { saveResume, saveJob, saveReport, parseProcessed, listReports, removeReport } from '../lib/store.js'

const res = await extractFromFile('D:/dsh-research/资料/resume-matcher-agent-cn-main/苏明远2-简历-20260615.docx')
const jd = readFileSync('D:/dsh-research/资料/resume-matcher-agent-cn-main/AI Agent 工程师岗位要求（JD）.txt', 'utf8')

const rid = saveResume({
  content: res.text,
  sourceFile: res.path,
  processed: parseProcessed({
    'Personal Data': { firstName: '明远', lastName: '苏', email: 'mingyuan.su@example.com', phone: '+86 138 0000 0000', location: { city: '上海', country: '中国' } },
    Experiences: [
      { jobTitle: '高级后端工程师', company: '云帆科技', location: '上海', startDate: '2022-03-01', endDate: 'Present', description: ['负责 API 网关与微服务治理，QPS 峰值 12k', '主导慢查询治理专项，P99 从 850ms 降至 180ms'], technologiesUsed: ['Go', 'MySQL', 'Redis', 'K8s'] },
      { jobTitle: '后端工程师', company: '星图数据', location: '杭州', startDate: '2019-07-01', endDate: '2022-02-28', description: ['订单中台核心链路开发，大促 0 故障'], technologiesUsed: ['Java', 'Kafka'] },
    ],
    Projects: [{ projectName: '实时数据管道', description: '为解决报表 T+1 延迟，在 Flink 与 Spark Streaming 之间选型 Flink，端到端延迟从小时级降到秒级', technologiesUsed: ['Flink', 'ClickHouse'], startDate: '2023-01-01', endDate: '2023-12-31' }],
    Skills: [{ category: '语言', skillName: 'Go' }, { category: '语言', skillName: 'Java' }, { category: '存储', skillName: 'MySQL' }, { category: '存储', skillName: 'Redis' }, { category: '云原生', skillName: 'Kubernetes' }],
    Education: [{ institution: '浙江大学', degree: '本科', fieldOfStudy: '计算机科学', startDate: '2015-09-01', endDate: '2019-06-30' }],
    'Extracted Keywords': ['Go', '微服务', '高并发', 'K8s'],
  }),
})

const jid = saveJob({
  content: jd,
  resumeId: rid,
  processed: parseProcessed({
    jobTitle: 'AI Agent 工程师', companyProfile: { companyName: '智涌科技', industry: '人工智能' },
    location: { city: '上海', country: '中国', remoteStatus: 'Hybrid' }, employmentType: 'Full-time',
    jobSummary: '负责大模型 Agent 平台核心链路的设计与研发，推动 Prompt 工程与评测体系建设。',
    keyResponsibilities: ['Agent 编排与工具调用链路研发', 'Prompt 工程与评测体系', '多智能体协作框架设计'],
    qualifications: {
      required: ['3 年以上后端经验，扎实的 Go/Python 功底', '熟悉 LLM 应用开发（RAG / Function Calling）'],
      preferred: ['有开源项目或技术博客', '熟悉 LangChain 等框架'],
    },
    extractedKeywords: ['LLM', 'Agent', 'RAG', 'Go', 'Python'],
  }),
})

const improved = `# 苏明远

## 个人信息

上海 · +86 138 0000 0000 · mingyuan.su@example.com

## 工作经历

**云帆科技 · 高级后端工程师**（2022.03 - 至今）

- 为解决 API 网关单点瓶颈问题，在自研网关与 Kong 之间选型自研方案，支撑 QPS 峰值 12k，全年可用性 99.99%
- 主导慢查询治理专项：通过索引重构与读写分离，将核心接口 P99 延迟从 850ms 优化至 180ms，慢查询工单量下降 87%

**星图数据 · 后端工程师**（2019.07 - 2022.02）

- 为解决大促订单积压问题，在同步/异步链路间选型异步化改造，峰值吞吐提升 3.2 倍，大促期间 0 故障

## 项目经历

**实时数据管道**（2023）

- 为解决报表 T+1 延迟问题，在 Flink 与 Spark Streaming 间权衡后选型 Flink（Exactly-Once 语义优先），端到端延迟从小时级降至 3 秒内

## 技能

Go · Java · MySQL · Redis · Kubernetes · Flink · ClickHouse

## 教育背景

浙江大学 · 计算机科学 本科（2015 - 2019）

## [量化指标：请补充你主导过的最大一次容量规划，包括集群规模与成本变化]
`

// 旧预览报告清掉重写
for (const r of listReports()) removeReport(r.id)

const reportMd = `# 简历分析报告：苏明远 × AI Agent 工程师

## Step 1 · 第一印象

- **目标岗位 + 职级判断**：AI Agent 工程师 / 高级（3-5 年后端 + LLM 应用转型）
- **30 秒定论**：**大概率关闭**。通用后端能力扎实，但简历里没有一条 LLM/Agent 相关证据，关键词匹配度不足 20%，HR 第一轮筛选就会被过滤。

## Step 2 · 地毯式审计

❓ **整体故事线与 JD 完全脱节**
🤔 全文零 LLM/RAG/Agent 关键词，而 JD 的 required 里明确要求「熟悉 LLM 应用开发」。简历按「高并发后端」叙事写，投递岗位却是 Agent 平台。
💡 把实时数据管道项目改造成「数据供给侧」叙事：Flink 管道为下游 LLM 评测平台供数，延迟秒级——这在 Agent 评测体系里是真实痛点。

❓ **技术决策不展示权衡过程**
🤔 「负责 API 网关与微服务治理」是职责描述不是影响力叙事，HR 无法判断不可替代性。
💡 用「为解决Y，在A/B间选Z」公式改写（见 Step 4）。

❓ **技能清单与经历部分脱节**
🤔 K8s、Flink 在技能区出现但经历里没有承接，属于弱诚信信号。
💡 删掉没有经历支撑的技能，或补一条使用场景。

## Step 3 · 修改蓝图

- **公式**：为解决 [具体问题Y]，在 [方案A] 与 [方案B] 之间选了 [Z]，因为 [约束]，结果是 [量化指标]。
- **对比示例**：改前「负责订单中台核心链路开发」→ 改后「为解决大促订单积压，在同步/异步链路间选型异步化改造，峰值吞吐提升 3.2 倍，0 故障」。
- **三个提问**：① 你的哪个系统挂过最贵的故障？怎么防的？② 哪次技术选型你说了算？为什么？③ 有没有量化过你省下的成本/时间？

## Step 4 · 修改后的完整简历

\`\`\`md
${improved}
\`\`\`

## Step 5 · 最终裁决

- **整体评价**：底子扎实的好苗子，缺的不是能力证明而是一层「AI 语境」的翻译。
- **核心风险**：① 全文无 LLM 关键词，过不了简历筛选器；② 没有任何技术决策的权衡叙事。
- **行动清单**：首要任务——补齐所有 [占位符] 里的量化数据；第二任务——用决策-权衡公式重写实时管道项目；长期建议——把网关治理经验迁移成「Agent 平台基础设施」语言，并考虑开源一个 LLM 网关 side project。
`

const reportId = saveReport({ resumeId: rid, jobId: jid, reportMd })
const saved = listReports()[0]
console.log('seeded:', { rid: rid.slice(0, 8), jid: jid.slice(0, 8), reportId: reportId.slice(0, 8), score: saved.score, improved: saved.has_improved })
