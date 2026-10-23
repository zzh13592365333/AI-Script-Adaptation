from backend.app.models.script_task import ScriptTaskCreate
from backend.app.workflows.validators import validate_script


def request(target_words: int = 300) -> ScriptTaskCreate:
    return ScriptTaskCreate(
        project_id="project-1",
        episode_id="episode-1",
        episode_number=1,
        episode_outline="林夏在档案室发现秘密，并接到神秘电话。",
        character_context="林夏：谨慎的调查员",
        world_context="现代都市悬疑",
        previous_episode_summary="",
        user_requirements="结尾出现电话",
        target_words=target_words,
        max_retries=2,
    )


VALID_SCRIPT = """第1场 档案室 内景 夜
出场人物：林夏
动作：林夏打开被雨水浸湿的档案袋，发现自己的出生记录。
林夏：这不是普通的遗产文件。
Lin Xia: This is not an ordinary inheritance file.
林夏OS：有人一直在修改我的过去。
Lin Xia (OS): Someone has been rewriting my past.
动作：电话突然响起，屏幕上没有号码。她停顿片刻后接通。
神秘人：别让他们看到最后一页。
Caller: Do not let them see the last page.
动作：门外传来脚步声，林夏迅速关掉台灯，把文件藏进外套。
"""


def test_valid_script_passes_deterministic_validation():
    assert validate_script(VALID_SCRIPT, request()) == []


def test_validator_reports_missing_scene_heading_and_cast():
    issues = validate_script("林夏：我找到文件了。\nLin Xia: I found it.", request())

    assert "缺少场景标题" in issues
    assert "缺少出场人物列表" in issues


def test_validator_requires_english_after_chinese_dialogue_and_os():
    script = VALID_SCRIPT.replace("Lin Xia: This is not an ordinary inheritance file.\n", "")
    script = script.replace("Lin Xia (OS): Someone has been rewriting my past.\n", "")

    issues = validate_script(script, request())

    assert any("英文翻译" in issue for issue in issues)


def test_validator_reports_length_outside_tolerance():
    issues = validate_script(VALID_SCRIPT, request(target_words=5000))

    assert any("篇幅" in issue for issue in issues)


def test_validator_rejects_empty_content():
    assert validate_script("", request()) == ["剧本内容为空"]
