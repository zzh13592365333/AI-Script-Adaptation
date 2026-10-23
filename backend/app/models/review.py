from enum import StrEnum

from pydantic import BaseModel, Field, model_validator


class ReviewAction(StrEnum):
    ACCEPT = "accept"
    EDIT_ACCEPT = "edit_accept"
    REQUEST_REVISION = "request_revision"


class ReviewRequest(BaseModel):
    action: ReviewAction
    feedback: str = Field(default="", max_length=20_000)
    edited_content: str = Field(default="", max_length=300_000)
    idempotency_key: str | None = Field(default=None, max_length=128)

    @model_validator(mode="after")
    def validate_action_payload(self):
        if self.action is ReviewAction.EDIT_ACCEPT and not self.edited_content.strip():
            raise ValueError("edited_content is required for edit_accept")
        if self.action is ReviewAction.REQUEST_REVISION and not self.feedback.strip():
            raise ValueError("feedback is required for request_revision")
        return self
