from langgraph.checkpoint.memory import InMemorySaver
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.types import Command

from backend.app.models.script_task import QualityCheckResult, ScriptTaskCreate
from backend.app.services.model_provider import FakeScriptModelProvider
from backend.app.workflows.script_graph import build_script_graph, initial_workflow_state
from backend.tests.test_validators import VALID_SCRIPT


def request(max_retries: int = 2) -> ScriptTaskCreate:
    return ScriptTaskCreate(
        project_id="project-1",
        episode_id="episode-1",
        episode_number=1,
        episode_outline="林夏在档案室发现秘密，并接到神秘电话。",
        character_context="林夏：谨慎的调查员",
        world_context="现代都市悬疑",
        previous_episode_summary="",
        user_requirements="结尾出现电话",
        target_words=300,
        max_retries=max_retries,
    )


def quality(passed: bool) -> QualityCheckResult:
    return QualityCheckResult(
        passed=passed,
        outline_consistency=passed,
        character_consistency=True,
        continuity_consistency=True,
        format_compliance=True,
        translation_compliance=True,
        terminology_consistency=True,
        length_compliance=True,
        user_requirements_compliance=passed,
        issues=[] if passed else ["结尾钩子不足"],
        revision_instructions=[] if passed else ["强化结尾电话钩子"],
    )


def run_to_interrupt(provider, task_request=None, cancellation_check=lambda _task_id: False):
    saver = InMemorySaver()
    graph = build_script_graph(provider, saver, cancellation_check)
    config = {"configurable": {"thread_id": "task-1"}}
    result = graph.invoke(initial_workflow_state("task-1", task_request or request()), config=config)
    return graph, config, result


def test_quality_pass_interrupts_for_human_review_and_accept_resumes_to_completed():
    provider = FakeScriptModelProvider(script_results=[VALID_SCRIPT], review_results=[quality(True)])
    graph, config, result = run_to_interrupt(provider)

    assert result["task_status"] == "awaiting_human_review"
    assert result["quality_check_result"]["passed"] is True
    assert result["__interrupt__"]

    completed = graph.invoke(Command(resume={"action": "accept"}), config=config)

    assert completed["task_status"] == "completed"
    assert completed["final_approved"] is True


def test_quality_failure_revises_then_interrupts_after_passing():
    provider = FakeScriptModelProvider(
        script_results=[VALID_SCRIPT, VALID_SCRIPT + "\n动作：电话再次响起。"],
        review_results=[quality(False), quality(True)],
    )
    _, _, result = run_to_interrupt(provider)

    assert result["retry_count"] == 1
    assert result["quality_check_result"]["passed"] is True
    assert [call.operation for call in provider.calls] == ["generate", "review", "revise", "review"]


def test_retry_exhaustion_interrupts_for_human_review_without_false_pass():
    provider = FakeScriptModelProvider(script_results=[VALID_SCRIPT], review_results=[quality(False)])
    _, _, result = run_to_interrupt(provider, request(max_retries=0))

    assert result["task_status"] == "awaiting_human_review"
    assert result["quality_check_result"]["passed"] is False
    assert result["retry_count"] == 0


def test_provider_failure_ends_with_model_failed_status():
    provider = FakeScriptModelProvider(failures={"generate": TimeoutError("secret upstream detail")})
    _, _, result = run_to_interrupt(provider)

    assert result["task_status"] == "model_failed"
    assert result["error_code"] == "model_timeout"
    assert "secret upstream detail" not in result["error_message"]


def test_cancellation_prevents_model_calls():
    provider = FakeScriptModelProvider(script_results=[VALID_SCRIPT], review_results=[quality(True)])
    _, _, result = run_to_interrupt(provider, cancellation_check=lambda _task_id: True)

    assert result["task_status"] == "cancelled"
    assert provider.calls == []


def test_sqlite_checkpoint_can_resume_human_review(tmp_path):
    provider = FakeScriptModelProvider(script_results=[VALID_SCRIPT], review_results=[quality(True)])
    checkpoint_file = tmp_path / "checkpoints.sqlite3"
    config = {"configurable": {"thread_id": "task-sqlite"}}

    with SqliteSaver.from_conn_string(str(checkpoint_file)) as saver:
        graph = build_script_graph(provider, saver, lambda _task_id: False)
        paused = graph.invoke(initial_workflow_state("task-sqlite", request()), config=config)
        assert paused["__interrupt__"]
        completed = graph.invoke(Command(resume={"action": "accept"}), config=config)

    assert completed["task_status"] == "completed"
