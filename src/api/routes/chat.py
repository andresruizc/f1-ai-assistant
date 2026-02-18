"""Chat endpoint — sends messages to the AI race engineer agent."""

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel, Field

from src.agent import run_agent
from src.api.services import RaceService

router = APIRouter()


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    driver_code: str = Field(..., min_length=2, max_length=4)
    current_lap: int = Field(..., ge=1)
    conversation_history: list[dict] = Field(default_factory=list)


class ChatResponse(BaseModel):
    reply: str
    tools_used: list[str]


@router.post("/", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    """Send a message to the AI race engineer and get a response.

    The agent will:
    1. Build the system prompt with driver/race context
    2. Inject [Race Update — Lap X/Y] before the user message
    3. Run the tool-calling conversation loop (may call multiple tools)
    4. Return the final response text + list of tools used
    """
    service = RaceService.get_instance()
    if not service.is_loaded:
        raise HTTPException(status_code=400, detail="No race loaded. Load a race first.")

    try:
        result = await run_agent(
            message=request.message,
            driver_code=request.driver_code,
            current_lap=request.current_lap,
            conversation_history=request.conversation_history,
            race_state=service.race_state,
        )
        return ChatResponse(
            reply=result["reply"],
            tools_used=result["tools_used"],
        )
    except Exception as e:
        logger.error("Chat agent error: {}", e)
        raise HTTPException(status_code=500, detail=f"Agent error: {e}")
