from fastapi import APIRouter, HTTPException

from app.core.config import get_settings
from app.schemas.assistant import AssistantStatus, ChatReply, ChatRequest
from app.services.assistant import AssistantError, OllamaAssistant

router = APIRouter()
assistant = OllamaAssistant(get_settings())


@router.get("/status", response_model=AssistantStatus)
async def status():
    return await assistant.status()


@router.post("/chat", response_model=ChatReply)
async def chat(request: ChatRequest):
    try:
        reply = await assistant.chat(request)
        return ChatReply(reply=reply, model=assistant.settings.ollama_model)
    except AssistantError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
