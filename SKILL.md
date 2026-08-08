---
name: resume-screening
description: 自动读取指定或默认文件夹内的 Web 前端 PDF/DOCX 简历，按业务领域、业务系统和业务模块分类，生成可按分类和评级筛选的 Excel 报告及历史简历 ZIP。用于批量识别简历项目经验、归档本次简历和安全清理已成功处理的输入文件，无需收集额外业务需求。
---

# 简历业务分类

## 目标

自动从 Web 前端简历的项目经历中识别业务领域、业务系统、业务模块和关键词。输出分类、业务经验评级、证据、待核实项和处理状态；不输出岗位匹配分数、录用、淘汰或通过结论。

## 默认目录

不要询问业务需求或招聘要求。除非用户在请求中明确给出路径，否则直接使用当前工作目录的以下中文目录：

- `待筛选简历`：读取 PDF/DOCX 简历。
- `筛选结果`：写入本次中文结果目录和 Excel。
- `历史简历`：写入日期命名 ZIP。

用户明确提供的路径优先于默认目录。拒绝将结果输出目录或历史简历目录设为简历文件夹本身或其子目录。首版只处理 `.pdf` 和 `.docx`，忽略其他文件。

## 工作流

1. 阅读 [业务分类知识库](references/business-taxonomy.json) 和 [评估协议](references/assessment-schema.md)。将 H5、小程序等视为技术/交付标签，不与 ERP、电商等业务领域混淆。
2. 使用 `scripts/extract_resumes.py` 提取简历文件夹，生成临时批次清单。不要把临时清单或简历全文放入最终结果目录。
3. 逐份阅读提取结果，依据知识库自动生成符合评估协议的 JSON。只引用简历中的项目证据；未提及的信息必须标为“待核实”。不要使用姓名、年龄、性别、照片、籍贯、婚育等敏感或与分类无关的信息。
4. 使用 `scripts/finalize_batch.py` 生成 Excel、创建 ZIP、校验归档并清理输入文件。该脚本是唯一允许清理输入简历的入口。
5. 检查脚本返回的 Excel 路径、ZIP 路径、已清理数量和保留的解析异常文件。报告解析异常，但不要将其归为业务经验不足。

## 评级规则

- `A 级`：简历有明确的业务系统、关键模块、职责和结果证据。
- `B 级`：简历有明确的业务系统和模块证据，但职责或结果信息不完整。
- `C 级`：可识别业务领域，但业务系统或模块证据较少。
- `D 级`：仅有泛化技术描述，缺少可审计的业务项目经验。
- `未评级`：文件无法解析，或未能获得可审计的项目经历。

评级只反映简历中业务经验信息的完整度，不代表候选人的录用价值或任何岗位适配度。

## 批次命令

使用 Codex 提供的 Python、Node 和 `node_modules` 路径。`finalize_batch.py` 会在临时目录创建 Artifact Tool 所需的 `node_modules` 链接，不要把该链接写入 Skill 目录。

```bash
PYTHON_BIN="<workspace Python>"
NODE_BIN="<workspace Node>"
NODE_MODULES="<workspace Node modules>"
WORK_DIR="<temporary directory>"

"$PYTHON_BIN" scripts/extract_resumes.py \
  --input-dir "${PWD}/待筛选简历" \
  --manifest "$WORK_DIR/批次清单.json"

# 根据批次清单和业务分类知识库自动生成 $WORK_DIR/评估结果.json。

"$PYTHON_BIN" scripts/finalize_batch.py \
  --manifest "$WORK_DIR/批次清单.json" \
  --assessments "$WORK_DIR/评估结果.json" \
  --output-dir "${PWD}/筛选结果" \
  --node "$NODE_BIN" \
  --node-modules-dir "$NODE_MODULES"
```

`finalize_batch.py` 在 ZIP 和 Excel 校验通过后，仅删除状态为“已解析”的 PDF/DOCX。解析异常文件仍会写入 ZIP 和 Excel，但保留在简历文件夹中。若同一分钟已有同名 ZIP，脚本失败且不会覆盖历史归档或清理输入文件。

## 输出

在筛选结果目录中创建 `筛选结果_YYYY年MM月DD日HH时mm分/简历筛选结果.xlsx`：

- `候选人总表`：每个候选人一行，包含主分类、评级、证据、待核实项和处理状态。
- `分类检索表`：每条业务标签一行，允许一个候选人出现多次，以便在 Excel 原生筛选下拉框中按业务领域、业务系统、业务模块和评级单选或多选。

在历史简历目录中创建 `YYYY年MM月DD日HH时mm分.zip`，保留原始相对目录、全部本次扫描简历和简短清单。
