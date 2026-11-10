# dsh-resume-matcher · 简历诊所

DeepSeek Harness（dsh）插件：HR 视角的中文简历深度优化工作台。上传简历（PDF/DOCX）+ 目标岗位 JD，会话模型按「五步审计」方法论产出完整报告，报告与优化后简历自动归档，侧栏「简历诊所」面板随时回看、复制、下载。

移植自开源项目 [resume-matcher-agent-cn](https://github.com/)（HR批评简历，Flask + Next.js），本插件为其 dsh 化形态：**纯技能驱动、零 API key、零 Python 依赖**。

## 核心功能

- 📄 **解析归档**：`resume_matcher` 工具解析 PDF / DOCX 简历（含双列布局保序），结构化信息 JSON 归档
- 🧠 **五步审计**（hr-critic 技能，由会话模型执行）：
  1. **第一印象** — 目标岗位 + 职级判断，30 秒定论
  2. **地毯式审计** — 「批判 ❓ - 解析 🤔 - 建议 💡」三段式反馈
  3. **修改蓝图** — 影响力叙事公式 + 改写对比示例 + 启发式提问
  4. **重写简历** — 忠于原文，缺失信息用占位符标注
  5. **最终裁决** — 整体评价 + 核心风险 + 行动清单
- 🧾 **报告存档** — Step 4 的优化简历自动抽取，面板一键复制 / 下载 .md
- 🖥 **简历诊所面板** — 概览 / 简历库 / 岗位库 / 分析报告 / 发起分析（一键开新对话填入草稿），明暗跟随 dsh 主题

## 使用流程

1. 在对话里发简历文件（PDF/DOCX 路径）或粘贴文本，再给一段目标岗位 JD
2. 模型自动：解析 → 结构化归档 → 五步审计 → 报告存档 → 全文输出
3. 侧栏「简历诊所」查看报告与优化简历；「发起分析」页选简历 × 岗位可一键开新对话

## 安装

```bash
# dsh 0.2.x：把仓库 clone 到本地后以 link 方式安装
dsh plugin add <本仓库本地路径>
```

依赖会自动安装（`@deepseek-ai/schemastery`、`unpdf`）。数据存放在 `~/.dsh/resume-matcher/`（可用 `DSH_HOME` 改）。

## 开发

```bash
npm install
npm test                 # 单元测试（parser / markdown / store）
node scripts/smoke.mjs   # 冒烟：真实 DOCX + 最小 PDF + 面板 API 全链路
npm run build            # client.js → dist/client.js
# 可选预览：
DSH_HOME=<数据目录> node scripts/seed-preview.mjs   # 种子数据（原项目样例）
node scripts/devserver.mjs 5175                     # http://127.0.0.1:5175/resume-matcher/
```

## 架构

```text
├── src/host.js          Host 半边：resume_matcher 工具 + 技能提供方 + 系统提示注入 + 面板路由
├── src/systemPrompt.js  硬规则（何时解析/归档/存档）
├── lib/parser.js        DOCX（手解 zip+xml，双列保序）+ PDF（unpdf）
├── lib/store.js         JSON 原子写档案库（resumes/jobs/reports）
├── lib/markdown.js      报告渲染 + 优化简历启发式抽取
├── lib/api.js           /resume-matcher 前缀路由（面板 API + 静态资源）
├── lib/skills.js        hr-critic 技能提供方
├── skills/hr-critic/    五步审计方法论（移植自原项目 prompts.py）
├── client.js → dist/    浏览器半边：侧栏入口 + iframe + 主题/开新对话桥
└── lab/                 面板页面（瑞士风设计系统，明暗双主题）
```

## 边界与说明

- `.doc` / `.pages` / 扫描件图片 PDF 不支持，请转 PDF 文字版或粘贴文本
- 分析结论由模型生成，属专业意见而非事实保证；请勿在简历中编造经历
- v2 规划：a4cv 可视化简历编辑器集成（原项目的核心增强）、可选内置 OpenAI 兼容客户端（面板一键重跑）

## 致谢

- [resume-matcher-agent-cn](https://github.com/)：五步审计 prompt、双列 DOCX 解析、启发式简历抽取均移植自该项目
- [dsh-guizang-design](https://github.com/op7418/dsh-guizang-design)：面板瑞士风设计系统与插件形态参考

## License

MIT
