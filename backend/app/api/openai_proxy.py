from dataclasses import dataclass
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend.app.core.config import Settings


router = APIRouter(tags=["openai-proxy"])


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1)


class OpenAIChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1)
    stream: bool = False
    temperature: float | None = None


@dataclass(frozen=True)
class UpstreamRequest:
    url: str
    headers: dict[str, str]
    body: dict[str, object]


def build_upstream_request(payload: OpenAIChatRequest, settings: Settings) -> UpstreamRequest:
    body: dict[str, object] = {
        "messages": [message.model_dump() for message in payload.messages],
        "stream": payload.stream,
        "model": settings.model_name,
        "reasoning_effort": settings.model_reasoning_effort,
    }
    if payload.temperature is not None:
        body["temperature"] = payload.temperature
    return UpstreamRequest(
        url=f"{settings.model_base_url.rstrip('/')}/chat/completions",
        headers={
            "Authorization": f"Bearer {settings.model_api_key}",
            "Content-Type": "application/json",
        },
        body=body,
    )


@router.post("/openai/chat")
async def openai_chat(payload: OpenAIChatRequest, request: Request):
    settings: Settings = request.app.state.settings
    if not settings.model_configured:
        raise HTTPException(status_code=503, detail="模型服务尚未完整配置")

    upstream_request = build_upstream_request(payload, settings)
    client = httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=30.0))
    try:
        upstream = await client.send(
            client.build_request(
                "POST",
                upstream_request.url,
                headers=upstream_request.headers,
                json=upstream_request.body,
            ),
            stream=payload.stream,
        )
    except httpx.TimeoutException:
        await client.aclose()
        raise HTTPException(status_code=504, detail="模型请求超时，请稍后重试") from None
    except httpx.HTTPError:
        await client.aclose()
        raise HTTPException(status_code=502, detail="模型服务调用失败") from None

    if not upstream.is_success:
        status_code = upstream.status_code
        await upstream.aclose()
        await client.aclose()
        raise HTTPException(status_code=status_code, detail=f"模型接口请求失败：{status_code}")

    if payload.stream:
        return StreamingResponse(
            _stream_response(upstream, client),
            media_type=upstream.headers.get("content-type", "text/event-stream"),
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    try:
        response_body = upstream.json()
        content = response_body.get("choices", [{}])[0].get("message", {}).get("content")
    except (ValueError, AttributeError, IndexError, TypeError):
        content = None
    finally:
        await upstream.aclose()
        await client.aclose()
    if not isinstance(content, str) or not content:
        raise HTTPException(status_code=502, detail="模型接口响应中缺少文本内容")
    return {"content": content}


async def _stream_response(upstream: httpx.Response, client: httpx.AsyncClient):
    try:
        async for chunk in upstream.aiter_bytes():
            yield chunk
    finally:
        await upstream.aclose()
        await client.aclose()
