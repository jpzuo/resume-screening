#!/usr/bin/env python3
"""Create the final workbook and verified ZIP before cleaning processed resumes."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

SUPPORTED_EXTENSIONS = {".pdf", ".docx"}


def ensure_outside_input(input_dir: Path, target: Path, label: str) -> None:
    if target == input_dir or input_dir in target.parents:
        raise ValueError(f"{label}不能是简历文件夹或其子目录")


def timestamp_name(value: str | None) -> str:
    if value:
        if any(character in value for character in ("/", "\\", "\x00")):
            raise ValueError("时间戳不能包含路径分隔符")
        return value
    now = datetime.now(ZoneInfo("Asia/Shanghai"))
    return now.strftime("%Y年%m月%d日%H时%M分")


def load_json(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"无法读取 JSON 文件 {path}: {error}") from error
    if not isinstance(data, dict):
        raise ValueError(f"JSON 顶层必须是对象: {path}")
    return data


def safe_resume_path(input_dir: Path, relative_path: str) -> Path:
    candidate = (input_dir / relative_path).resolve()
    if input_dir not in candidate.parents or not candidate.is_file():
        raise ValueError(f"批次清单包含无效简历路径: {relative_path}")
    if candidate.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"批次清单包含不支持的文件类型: {relative_path}")
    return candidate


def create_archive(archive_path: Path, input_dir: Path, documents: list[dict]) -> None:
    archive_manifest = {
        "schema_version": "1.0",
        "input_dir": str(input_dir),
        "documents": [
            {
                "candidate_id": document["candidate_id"],
                "relative_path": document["relative_path"],
                "status": document["status"],
            }
            for document in documents
        ],
    }
    with zipfile.ZipFile(archive_path, "x", compression=zipfile.ZIP_DEFLATED) as archive:
        for document in documents:
            source = safe_resume_path(input_dir, document["relative_path"])
            archive.write(source, arcname=(Path("简历") / document["relative_path"]).as_posix())
        archive.writestr("本次筛选清单.json", json.dumps(archive_manifest, ensure_ascii=False, indent=2))

    expected_names = {
        (Path("简历") / document["relative_path"]).as_posix() for document in documents
    } | {"本次筛选清单.json"}
    with zipfile.ZipFile(archive_path, "r") as archive:
        if archive.testzip() is not None:
            raise ValueError("ZIP 完整性校验失败")
        if set(archive.namelist()) != expected_names:
            raise ValueError("ZIP 文件清单与批次清单不一致")


def run_report_builder(
    node: Path,
    node_modules_dir: Path,
    manifest: Path,
    assessments: Path,
    workbook_path: Path,
) -> None:
    script_source = Path(__file__).with_name("build_report.mjs")
    if not script_source.is_file():
        raise ValueError(f"缺少 Excel 生成脚本: {script_source}")
    if not node.is_file() or not os.access(node, os.X_OK):
        raise ValueError(f"Node 可执行文件不可用: {node}")
    if not node_modules_dir.is_dir():
        raise ValueError(f"Node modules 目录不可用: {node_modules_dir}")
    with tempfile.TemporaryDirectory(prefix="resume-screening-workbook-") as runner_dir_text:
        runner_dir = Path(runner_dir_text)
        runner_script = runner_dir / "build_report.mjs"
        shutil.copy2(script_source, runner_script)
        os.symlink(node_modules_dir, runner_dir / "node_modules", target_is_directory=True)
        subprocess.run(
            [
                str(node),
                str(runner_script),
                "--manifest", str(manifest),
                "--assessments", str(assessments),
                "--output", str(workbook_path),
            ],
            check=True,
        )


def clean_processed_files(input_dir: Path, documents: list[dict]) -> tuple[list[str], list[str]]:
    removed: list[str] = []
    retained: list[str] = []
    for document in documents:
        source = safe_resume_path(input_dir, document["relative_path"])
        if document["status"] == "已解析":
            source.unlink()
            removed.append(document["relative_path"])
        else:
            retained.append(document["relative_path"])
    return removed, retained


def main() -> None:
    parser = argparse.ArgumentParser(description="生成筛选报告、历史简历 ZIP 并清理已解析文件")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--assessments", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--history-dir", help="未指定时使用结果输出目录下的历史简历")
    parser.add_argument("--node", required=True)
    parser.add_argument("--node-modules-dir", required=True)
    parser.add_argument("--timestamp", help="测试或显式归档名称，格式 YYYY年MM月DD日HH时MM分")
    args = parser.parse_args()

    manifest_path = Path(args.manifest).expanduser().resolve()
    assessments_path = Path(args.assessments).expanduser().resolve()
    manifest = load_json(manifest_path)
    documents = manifest.get("documents")
    if not isinstance(documents, list) or not documents:
        raise SystemExit("批次清单不包含简历文件")
    input_dir = Path(manifest.get("input_dir", "")).expanduser().resolve()
    if not input_dir.is_dir():
        raise SystemExit("批次清单中的简历文件夹不存在")
    output_dir = Path(args.output_dir).expanduser().resolve()
    history_dir = (
        Path(args.history_dir).expanduser().resolve()
        if args.history_dir
        else output_dir / "历史简历"
    )
    ensure_outside_input(input_dir, output_dir, "结果输出目录")
    ensure_outside_input(input_dir, history_dir, "历史简历目录")

    stamp = timestamp_name(args.timestamp)
    run_dir = output_dir / f"筛选结果_{stamp}"
    archive_path = history_dir / f"{stamp}.zip"
    if run_dir.exists():
        raise SystemExit(f"本次结果目录已存在: {run_dir}")
    if archive_path.exists():
        raise SystemExit(f"同一分钟的历史简历 ZIP 已存在: {archive_path}")

    for document in documents:
        safe_resume_path(input_dir, document.get("relative_path", ""))

    output_dir.mkdir(parents=True, exist_ok=True)
    history_dir.mkdir(parents=True, exist_ok=True)
    run_dir.mkdir()
    workbook_path = run_dir / "简历筛选结果.xlsx"
    try:
        run_report_builder(
            Path(args.node).expanduser().resolve(),
            Path(args.node_modules_dir).expanduser().resolve(),
            manifest_path,
            assessments_path,
            workbook_path,
        )
        if not workbook_path.is_file() or workbook_path.stat().st_size == 0:
            raise ValueError("Excel 报告未成功生成")
        create_archive(archive_path, input_dir, documents)
        removed, retained = clean_processed_files(input_dir, documents)
    except Exception:
        if archive_path.exists() and not workbook_path.is_file():
            archive_path.unlink()
        raise

    print(
        json.dumps(
            {
                "result_dir": str(run_dir),
                "workbook": str(workbook_path),
                "archive": str(archive_path),
                "removed": removed,
                "retained": retained,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
