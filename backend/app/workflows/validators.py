import re

from backend.app.models.script_task import ScriptTaskCreate


SCENE_PATTERN = re.compile(r"(?:第\s*\d+\s*场|场景\s*[：:]|\b(?:INT|EXT)\.|内景|外景)", re.IGNORECASE)
CAST_PATTERN = re.compile(r"(?:出场人物|人物)\s*[：:]")
CHINESE_PATTERN = re.compile(r"[\u4e00-\u9fff]")
ENGLISH_PATTERN = re.compile(r"[A-Za-z]")
DIALOGUE_PATTERN = re.compile(r"^([^：:\n]{1,30})(?:OS|旁白)?\s*[：:]\s*(.+)$", re.IGNORECASE)
NON_DIALOGUE_LABELS = {"场景", "出场人物", "人物", "动作", "时间", "地点", "镜头"}


def validate_script(content: str, request: ScriptTaskCreate) -> list[str]:
    text = content.strip()
    if not text:
        return ["剧本内容为空"]

    issues: list[str] = []
    if not SCENE_PATTERN.search(text):
        issues.append("缺少场景标题")
    if not CAST_PATTERN.search(text):
        issues.append("缺少出场人物列表")

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    missing_translations = 0
    for index, line in enumerate(lines):
        match = DIALOGUE_PATTERN.match(line)
        if not match or not CHINESE_PATTERN.search(match.group(2)):
            continue
        speaker = match.group(1).strip().upper().replace(" ", "")
        if speaker in NON_DIALOGUE_LABELS or any(label in speaker for label in NON_DIALOGUE_LABELS):
            continue
        next_line = lines[index + 1] if index + 1 < len(lines) else ""
        if not ENGLISH_PATTERN.search(next_line):
            missing_translations += 1
    if missing_translations:
        issues.append(f"有 {missing_translations} 处中文对白或OS缺少紧邻英文翻译")

    measured_length = len(CHINESE_PATTERN.findall(text)) + len(re.findall(r"\b[A-Za-z]+\b", text))
    minimum = max(60, int(request.target_words * 0.2))
    maximum = int(request.target_words * 2.0)
    if measured_length < minimum or measured_length > maximum:
        issues.append(f"剧本篇幅约 {measured_length} 字词，不在目标 {request.target_words} 的允许范围内")
    return issues
