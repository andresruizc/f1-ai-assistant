"""LiteLLM tool-calling conversation loop for the AI race engineer."""

import json
from typing import Any

import litellm
from loguru import logger

from src.race_state import RaceState
from src.tools import TOOL_SCHEMAS, execute_tool
from src.utils.config import settings

# Maximum tool-calling iterations to prevent infinite loops
MAX_TOOL_ROUNDS = 5


def build_system_prompt(
    driver_code: str, race_state: RaceState
) -> str:
    """Build the system prompt with race context injected.

    Args:
        driver_code: Three-letter code of the user's driver.
        race_state: The loaded race state.

    Returns:
        Formatted system prompt string.
    """
    driver_info = race_state.drivers.get(driver_code, {})
    driver_name = driver_info.get("name", driver_code)
    team_name = driver_info.get("team", "Unknown")

    return f"""You are an F1 race engineer on the pit wall during a live race. You are the race engineer for {driver_name} ({driver_code}), driving for {team_name}.

Your job is to provide strategic advice, answer questions about the race, and proactively identify threats and opportunities. You speak directly to your driver and the strategy team.

Communication style:
- Be concise and direct, like a real race engineer on the radio
- Use driver codes (VER, HAM, NOR) not full names in technical discussion
- Back up every recommendation with data from your tools
- When uncertain, say so — never fabricate data
- Use "we" when talking about your driver's strategy ("we should pit", "our pace is good")
- Use "P" notation for positions (P1, P2, P3...)

When discussing strategy, ALWAYS consider these factors:
1. Current tyre state — compound, age, degradation trend
2. Gap to car ahead and behind — is it growing or shrinking?
3. Track position — will we lose/gain places by pitting now?
4. Competitors' likely strategy — when might they pit?
5. Weather conditions and trends
6. Track status — safety car periods are strategic opportunities
7. DRS — is the car behind within 1 second?

Race context:
- Total race laps: {race_state.total_laps}
- Circuit: {race_state.circuit_name}, {race_state.country}
- Event: {race_state.event_name} {race_state.year}

Important rules:
- Only reference data up to the current lap — you don't know the future
- If asked about something you don't have data for, use your tools first
- A pit stop typically costs 20-25 seconds (pit lane time loss)
- DRS activation zone: gap must be under 1.0 seconds at the detection point
- Tyre compounds ranked softest to hardest: SOFT → MEDIUM → HARD
- Soft tyres are fastest but degrade quickest, hard tyres are slowest but most durable
- Intermediates are for light rain, full wets for heavy rain"""


async def run_agent(
    message: str,
    driver_code: str,
    current_lap: int,
    conversation_history: list[dict[str, str]],
    race_state: RaceState,
) -> dict[str, Any]:
    """Run the tool-calling conversation loop.

    Args:
        message: The user's question.
        driver_code: Three-letter code of the user's driver.
        current_lap: Current lap number.
        conversation_history: Previous messages in the conversation.
        race_state: The loaded RaceState instance.

    Returns:
        Dict with 'reply' (str) and 'tools_used' (list[str]).
    """
    model = settings["llm"]["model"]
    temperature = settings["llm"]["temperature"]
    max_tokens = settings["llm"]["max_tokens"]

    # Build messages
    system_prompt = build_system_prompt(driver_code, race_state)
    messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]

    # Add conversation history
    for msg in conversation_history:
        messages.append({"role": msg["role"], "content": msg["content"]})

    # Add current user message with lap context
    lap_context = f"[Race Update — Lap {current_lap}/{race_state.total_laps}]\n\n"
    messages.append({"role": "user", "content": lap_context + message})

    tools_used: list[str] = []

    for round_num in range(MAX_TOOL_ROUNDS):
        logger.debug("Agent round {}: calling LLM with {} messages", round_num + 1, len(messages))

        try:
            response = litellm.completion(
                model=model,
                messages=messages,
                tools=TOOL_SCHEMAS,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        except Exception as e:
            logger.error("LiteLLM completion failed: {}", e)
            return {
                "reply": "Sorry, I'm having trouble connecting to the AI service right now.",
                "tools_used": tools_used,
            }

        choice = response.choices[0]

        # If the model wants to call tools
        if choice.message.tool_calls:
            # Append the assistant message with tool calls
            messages.append(choice.message.model_dump())

            for tool_call in choice.message.tool_calls:
                tool_name = tool_call.function.name
                try:
                    arguments = json.loads(tool_call.function.arguments)
                except json.JSONDecodeError:
                    arguments = {}

                logger.info("Tool call: {}({})", tool_name, arguments)
                tools_used.append(tool_name)

                # Execute the tool
                result = execute_tool(tool_name, arguments, race_state, current_lap)

                # Append the tool result
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result,
                })

            # Continue the loop — LLM will synthesize with tool results
            continue

        # If the model returns a regular message, we're done
        reply = choice.message.content or ""
        logger.info("Agent completed after {} rounds, tools used: {}", round_num + 1, tools_used)
        return {"reply": reply, "tools_used": tools_used}

    # Safety: if we hit max rounds
    last_content = messages[-1].get("content", "") if messages else ""
    return {
        "reply": last_content or "I gathered the data but ran out of processing steps. Please try a simpler question.",
        "tools_used": tools_used,
    }
