import fs from "node:fs/promises";
import path from "node:path";
import { Workbook, SpreadsheetFile } from "@oai/artifact-tool";

const ratingValues = new Set(["A 级", "B 级", "C 级", "D 级"]);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value == null) {
      throw new Error("参数必须使用 --名称 值 格式");
    }
    args[key.slice(2)] = value;
  }
  for (const required of ["manifest", "assessments", "output"]) {
    if (!args[required]) throw new Error(`缺少 --${required}`);
  }
  return args;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function compactList(values) {
  return (values ?? []).map(cleanText).filter(Boolean).join("；");
}

function compactEvidence(evidence) {
  return (evidence ?? [])
    .map((item) => {
      const location = cleanText(item.location);
      const quote = cleanText(item.quote);
      return quote ? `${location}${location ? "：" : ""}${quote}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function normalizeLabel(label) {
  const normalized = {
    domain: cleanText(label?.domain),
    system: cleanText(label?.system),
    module: cleanText(label?.module),
    keywords: Array.isArray(label?.keywords) ? label.keywords.map(cleanText).filter(Boolean) : [],
  };
  if (!normalized.domain || !normalized.system || !normalized.module) {
    throw new Error("每个业务标签必须包含业务领域、业务系统和业务模块");
  }
  return normalized;
}

function normalizeAssessment(raw, document) {
  if (!ratingValues.has(raw?.rating)) {
    throw new Error(`${document.candidate_id} 的评级必须为 A 级、B 级、C 级或 D 级`);
  }
  const labels = (raw.labels ?? []).map(normalizeLabel);
  if (labels.length === 0) throw new Error(`${document.candidate_id} 至少需要一个业务标签`);
  const primaryLabel = normalizeLabel(raw.primary_label);
  const primaryKey = JSON.stringify(primaryLabel);
  if (!labels.some((label) => JSON.stringify(label) === primaryKey)) {
    throw new Error(`${document.candidate_id} 的主标签必须包含在 labels 中`);
  }
  return {
    candidateId: document.candidate_id,
    rating: raw.rating,
    primaryLabel,
    labels,
    evidence: Array.isArray(raw.evidence) ? raw.evidence : [],
    verificationNeeded: Array.isArray(raw.verification_needed) ? raw.verification_needed : [],
  };
}

function createUnratedAssessment(document) {
  return {
    candidateId: document.candidate_id,
    rating: "未评级",
    primaryLabel: { domain: "未识别", system: "未识别", module: "未识别", keywords: [] },
    labels: [{ domain: "未识别", system: "未识别", module: "未识别", keywords: [] }],
    evidence: [],
    verificationNeeded: [cleanText(document.parse_error) || "文件无法解析"],
  };
}

function columnWidth(sheet, column, width, lastRow) {
  sheet.getRange(`${column}1:${column}${Math.max(lastRow, 1)}`).format.columnWidth = width;
}

function styleTable(sheet, rangeAddress, headerAddress) {
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(1);
  sheet.getRange(headerAddress).format = {
    fill: "#0F766E",
    font: { bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
  };
  sheet.getRange(rangeAddress).format.verticalAlignment = "top";
  sheet.getRange(rangeAddress).format.wrapText = true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(await fs.readFile(args.manifest, "utf8"));
  const assessmentData = JSON.parse(await fs.readFile(args.assessments, "utf8"));
  const documents = manifest.documents ?? [];
  if (!Array.isArray(documents) || documents.length === 0) {
    throw new Error("批次清单不包含简历文件");
  }
  const rawAssessments = new Map(
    (assessmentData.candidates ?? []).map((item) => [item.candidate_id, item])
  );
  const knownIds = new Set(documents.map((document) => document.candidate_id));
  for (const candidateId of rawAssessments.keys()) {
    if (!knownIds.has(candidateId)) throw new Error(`评估结果包含未知候选人: ${candidateId}`);
  }

  const assessments = new Map();
  for (const document of documents) {
    if (document.status === "解析异常") {
      assessments.set(document.candidate_id, createUnratedAssessment(document));
      continue;
    }
    const raw = rawAssessments.get(document.candidate_id);
    if (!raw) throw new Error(`缺少已解析候选人的评估结果: ${document.candidate_id}`);
    assessments.set(document.candidate_id, normalizeAssessment(raw, document));
  }

  const workbook = Workbook.create();
  const mainSheet = workbook.worksheets.add("候选人总表");
  const lookupSheet = workbook.worksheets.add("分类检索表");
  const mainHeaders = [
    "候选人编号", "简历文件名", "文件类型", "处理状态", "评级", "主业务领域", "主业务系统",
    "主业务模块", "主关键词", "证据摘要", "待核实项"
  ];
  const mainRows = documents.map((document) => {
    const assessment = assessments.get(document.candidate_id);
    return [
      document.candidate_id,
      document.file_name,
      document.file_extension,
      document.status,
      assessment.rating,
      assessment.primaryLabel.domain,
      assessment.primaryLabel.system,
      assessment.primaryLabel.module,
      compactList(assessment.primaryLabel.keywords),
      compactEvidence(assessment.evidence),
      compactList(assessment.verificationNeeded),
    ];
  });
  mainSheet.getRange(`A1:K${mainRows.length + 1}`).values = [mainHeaders, ...mainRows];
  styleTable(mainSheet, `A1:K${mainRows.length + 1}`, "A1:K1");
  const mainTable = mainSheet.tables.add(`A1:K${mainRows.length + 1}`, true, "CandidateSummaryTable");
  mainTable.showFilterButton = true;
  mainTable.style = "TableStyleMedium2";
  mainSheet.getRange(`E2:E${mainRows.length + 1}`).conditionalFormats.add("containsText", {
    text: "A 级",
    format: { fill: "#DCFCE7", font: { color: "#166534", bold: true } },
  });
  mainSheet.getRange(`E2:E${mainRows.length + 1}`).conditionalFormats.add("containsText", {
    text: "D 级",
    format: { fill: "#FEE2E2", font: { color: "#991B1B", bold: true } },
  });
  mainSheet.getRange(`D2:D${mainRows.length + 1}`).conditionalFormats.add("containsText", {
    text: "解析异常",
    format: { fill: "#FEF3C7", font: { color: "#92400E", bold: true } },
  });
  [["A", 16], ["B", 28], ["C", 12], ["D", 14], ["E", 10], ["F", 16], ["G", 18], ["H", 18], ["I", 22], ["J", 48], ["K", 32]].forEach(
    ([column, width]) => columnWidth(mainSheet, column, width, mainRows.length + 1)
  );

  const lookupHeaders = [
    "候选人编号", "简历文件名", "处理状态", "评级", "业务领域", "业务系统", "业务模块", "关键词",
    "主标签", "证据摘要"
  ];
  const lookupRows = [];
  for (const document of documents) {
    const assessment = assessments.get(document.candidate_id);
    const primaryKey = JSON.stringify(assessment.primaryLabel);
    for (const label of assessment.labels) {
      lookupRows.push([
        document.candidate_id,
        document.file_name,
        document.status,
        assessment.rating,
        label.domain,
        label.system,
        label.module,
        compactList(label.keywords),
        JSON.stringify(label) === primaryKey ? "是" : "否",
        compactEvidence(assessment.evidence),
      ]);
    }
  }
  lookupSheet.getRange(`A1:J${lookupRows.length + 1}`).values = [lookupHeaders, ...lookupRows];
  styleTable(lookupSheet, `A1:J${lookupRows.length + 1}`, "A1:J1");
  const lookupTable = lookupSheet.tables.add(`A1:J${lookupRows.length + 1}`, true, "ClassificationLookupTable");
  lookupTable.showFilterButton = true;
  lookupTable.style = "TableStyleMedium9";
  [["A", 16], ["B", 28], ["C", 14], ["D", 10], ["E", 16], ["F", 18], ["G", 18], ["H", 24], ["I", 10], ["J", 48]].forEach(
    ([column, width]) => columnWidth(lookupSheet, column, width, lookupRows.length + 1)
  );

  const inspection = await workbook.inspect({
    kind: "table",
    range: `候选人总表!A1:K${Math.min(mainRows.length + 1, 12)}`,
    include: "values",
    tableMaxRows: 12,
    tableMaxCols: 11,
  });
  if (!inspection.ndjson) throw new Error("无法检查生成的工作簿");

  await fs.mkdir(path.dirname(args.output), { recursive: true });
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(args.output);
  console.log(JSON.stringify({ output: args.output, candidates: mainRows.length, labels: lookupRows.length }));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
