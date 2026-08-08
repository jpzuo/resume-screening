# 评估结果协议

将评估结果写入 JSON，顶层使用 `candidates` 数组。`candidate_id` 必须与批次清单完全一致；每个状态为“已解析”的候选人必须出现一次。

```json
{
  "candidates": [
    {
      "candidate_id": "R001",
      "rating": "A 级",
      "primary_label": {
        "domain": "企业管理",
        "system": "ERP",
        "module": "供应链管理",
        "keywords": ["订单", "库存", "权限"]
      },
      "labels": [
        {
          "domain": "企业管理",
          "system": "ERP",
          "module": "供应链管理",
          "keywords": ["订单", "库存", "权限"]
        }
      ],
      "evidence": [
        {
          "location": "第2页",
          "quote": "负责供应链 ERP 的订单、库存和权限模块前端开发。"
        }
      ],
      "verification_needed": ["未说明多租户实现经验"]
    }
  ]
}
```

## 字段规则

- 只接受 `A 级`、`B 级`、`C 级`、`D 级`；`未评级`由脚本为解析异常文件生成。
- `primary_label` 必须同时包含 `domain`、`system`、`module` 和 `keywords`，并且应存在于 `labels` 中。
- `labels` 至少包含主标签；每个标签必须完整描述领域、系统、模块和关键词。
- `evidence.quote` 必须来自提取的简历文本；`location` 使用 PDF 页码或 DOCX 段落/表格位置。
- `verification_needed` 只列出分类判断所需、但简历证据不足的内容。
- 不写入候选人的敏感个人信息，不输出岗位匹配分数、录用、淘汰或通过建议。
