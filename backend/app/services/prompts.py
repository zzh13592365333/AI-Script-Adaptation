import json

from backend.app.models.script_task import ScriptTaskCreate
from backend.app.models.stage_review import StageReviewRequest, StageRevisionRequest


SCRIPT_SYSTEM_PROMPT = """你是专业的AI漫剧分场编剧。输出可直接用于画面制作的完整剧本正文。
每场必须包含场景标题、出场人物和动作描述。所有中文对白和OS后必须紧邻对应英文翻译。
保持人物英文姓名、专有名词、人物关系和前后剧情一致。"""

REVIEW_SYSTEM_PROMPT = """你是独立的剧本质量审核员。严格审核，不得因为文本流畅就忽略剧情、人物、格式、翻译或字数问题。
只按照结构化字段返回审核结果。"""

STAGE_REVIEW_SYSTEM_PROMPT = """你是AI漫剧生产流程的独立质量审核员。只检查当前阶段内容，不改写正文。
检查内容是否完整、与已确认上游一致、内部逻辑是否自洽、是否足以支持下一阶段。只返回结构化结果。"""

STAGE_REVISION_SYSTEM_PROMPT = """你是AI漫剧流程编辑。根据问题清单和人工要求修订当前阶段。
保留未被要求修改的有效信息，返回与输入阶段完全相同的结构化字段，不要返回解释或 Markdown。"""


def generation_prompt(request: ScriptTaskCreate) -> str:
    return f"""生成第 {request.episode_number} 集漫剧剧本，目标约 {request.target_words} 字。

本集大纲：
{request.episode_outline}

人物设定：
{request.character_context}

世界观：
{request.world_context}

前情摘要：
{request.previous_episode_summary}

用户要求：
{request.user_requirements}
"""


def revision_prompt(request: ScriptTaskCreate, current_script: str, feedback: list[str]) -> str:
    return f"""根据审核反馈修改第 {request.episode_number} 集剧本。只输出修改后的完整正文。

审核反馈：
{chr(10).join(f'- {item}' for item in feedback)}

本集大纲：
{request.episode_outline}

当前剧本：
{current_script}
"""


def review_prompt(request: ScriptTaskCreate, script: str, deterministic_issues: list[str]) -> str:
    return f"""审核第 {request.episode_number} 集剧本。

本集大纲：
{request.episode_outline}

人物设定：
{request.character_context}

世界观：
{request.world_context}

前情摘要：
{request.previous_episode_summary}

用户要求：
{request.user_requirements}

确定性校验发现的问题：
{chr(10).join(f'- {item}' for item in deterministic_issues) or '无'}

待审核剧本：
{script}
"""


def stage_review_prompt(request: StageReviewRequest) -> str:
    return f"""审核阶段：{request.stage.value}

已确认上游上下文：
{json.dumps(request.upstream_context, ensure_ascii=False)}

人工要求：
{request.user_requirements or '无'}

当前阶段内容：
{json.dumps(request.content, ensure_ascii=False)}
"""


def stage_revision_prompt(request: StageRevisionRequest) -> str:
    return f"""修订阶段：{request.stage.value}

已确认上游上下文：
{json.dumps(request.upstream_context, ensure_ascii=False)}

当前内容：
{json.dumps(request.content, ensure_ascii=False)}

自查问题：
{chr(10).join(f'- {item}' for item in request.issues) or '无'}

修订建议：
{chr(10).join(f'- {item}' for item in request.revision_instructions) or '无'}

人工要求：
{request.user_requirements or '无额外要求'}
"""
