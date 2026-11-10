// 系统提示注入：简历诊所硬规则（简短，方法论细节在 hr-critic 技能里）。
export const SYSTEM_RULES = `## 简历诊所（resume-matcher）

用户上传/粘贴简历（PDF、DOCX 或文本）或目标岗位 JD、要求简历分析/批评/优化/匹配评估时：

**流程**：简历文件先用 resume_matcher 工具 parse 提取文本 → 按 hr-critic 技能做结构化抽取并 save_resume / save_job 归档 → 按五步框架（第一印象/地毯式审计/修改蓝图/重写简历/最终裁决）产出报告 → archive_report 存档 → 报告全文输出给用户。

**硬规则**：没有目标 JD 时先问，不凭空假设岗位；报告和优化后简历必须 archive_report 存档（面板可见）；绝不编造经历，缺失信息用占位符；已归档材料用 get 读原文，保证分析忠实于原文。`

export function systemSection() {
  return {
    name: 'resume-matcher:workflow',
    order: 110,
    text: SYSTEM_RULES,
  }
}
