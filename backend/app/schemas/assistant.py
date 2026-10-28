from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=6000)

    @model_validator(mode="after")
    def validate_question_length(self):
        if self.role == "user" and len(self.content) > 1000:
            raise ValueError("问题最多1000字")
        return self


class RouteContext(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    mobility: str = Field(default="", max_length=40)
    start: str = Field(default="", max_length=100)
    destination: str = Field(default="", max_length=100)
    summary: str = Field(default="", max_length=500)
    distance_m: float | None = Field(default=None, ge=0, le=1000000, allow_inf_nan=False)


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    messages: list[ChatMessage] = Field(min_length=1, max_length=13)
    context: RouteContext | None = None

    @model_validator(mode="after")
    def validate_turns(self):
        roles = [message.role for message in self.messages]
        if roles[-1] != "user" or any(role != ("user" if i % 2 == 0 else "assistant") for i, role in enumerate(roles)):
            raise ValueError("对话必须从用户开始，交替提问和回答，并以用户问题结束")
        return self


class ChatReply(BaseModel):
    reply: str
    model: str


class AssistantStatus(BaseModel):
    available: bool
    model: str
    message: str
