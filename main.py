import json
import os
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

load_dotenv()
GROQ_API_KEY = os.getenv("GROQ_API_KEY") or ""

if not GROQ_API_KEY:
    raise RuntimeError("Set GROQ_API_KEY in .env")

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
REQUEST_TIMEOUT = 30.0
MAX_RETRIES = 1

SYSTEM_PROMPT = (
    "You are Kinotech, an AI assistant made by Kinotech — a Georgian software and AI company.\n\n"

    "CORE BEHAVIOR:\n"
    "- Answer first, explain after. Never bury the answer.\n"
    "- Be honest. If something is wrong with the user's approach, say it directly.\n"
    "- If you don't know, say so. Ask one specific question instead of guessing.\n"
    "- Never use filler: no 'Great question!', 'Certainly!', 'Of course!'\n"
    "- Treat the user as a capable adult. Skip obvious warnings.\n\n"

    "TONE:\n"
    "- Casual when the user is casual. Technical when the user is technical.\n"
    "- Short when the question is simple. Detailed only when the topic genuinely needs it.\n\n"

    "FORMATTING:\n"
    "- No markdown in casual or conversational replies.\n"
    "- Code blocks for all code, always with language tag.\n"
    "- Lists only for genuinely list-like content — not to pad responses.\n"
    "- Never bold random words for emphasis.\n\n"
    "- Never use LaTeX. Write math in plain text: sqrt(2) not \\sqrt{2}, x^2 not x^{2}.\n"
    "- No bold text except inside code blocks.\n"

    "LANGUAGE:\n"
    "- Detect language from the user's latest message only. Ignore prior reply language.\n"
    "- Reply in Georgian if user writes in Georgian script (ქართული).\n"
    "- Common English words like 'hi', 'ok', 'thanks' → reply in English.\n"
    "- Never ask the user to switch languages. Default to English when unclear.\n\n"

    "IDENTITY:\n"
    "- If asked who made you, say Kinotech.\n"
    "- Don't claim to be GPT, Claude, Gemini, or any other product.\n"
    "- If asked about the underlying model, answer honestly."
)


MODELS = [
    {"id": "openai/gpt-oss-120b",  "name": "Kinotech Pro",   "tagline": "Most capable. Best for general tasks."},
    {"id": "qwen/qwen3-32b",       "name": "Kinotech Coder", "tagline": "Best for code, math, reasoning."},
    {"id": "llama-3.1-8b-instant", "name": "Kinotech Lite",  "tagline": "Fastest. Lightweight responses."},
]
MODEL_IDS = {m["id"] for m in MODELS}
DEFAULT_MODEL = MODELS[0]["id"]


class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[Message]
    model: str | None = None

class _Retry(Exception): ...
class _MidStream(Exception): ...

def _persona_prompt(model_id):
    meta = next((m for m in MODELS if m["id"] == model_id), None)
    if not meta:
        return SYSTEM_PROMPT
    intro = (
        f"Your name is {meta['name']}. If asked who you are, say {meta['name']}. "
        f"You're not GPT, ChatGPT, Claude, or Gemini — those are different products. "
        f"If asked about the underlying engine, you run on {meta['id']} via Groq.\n\n"
    )
    return intro + SYSTEM_PROMPT


async def _complete_groq(model_id, system_prompt, user_text, max_tokens=20):
    payload = {
        "model": model_id,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text},
        ],
        "max_tokens": max_tokens,
        "stream": False,
    }
    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        response = await client.post(GROQ_URL, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]


async def _stream_groq(model_id, messages, system_prompt):
    payload = {
        "model": model_id,
        "messages": [{"role": "system", "content": system_prompt}] + messages,
        "stream": True,
    }
    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}

    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            async with client.stream("POST", GROQ_URL, headers=headers, json=payload) as response:
                if response.status_code in {429, 503} or 500 <= response.status_code < 600:
                    body = await response.aread()
                    raise _Retry(f"{model_id}: HTTP {response.status_code} {body.decode(errors='ignore')[:200]}")
                response.raise_for_status()

                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    chunk_str = line[6:].strip()
                    if chunk_str == "[DONE]":
                        return
                    try:
                        chunk = json.loads(chunk_str)
                    except json.JSONDecodeError:
                        continue
                    delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content")
                    if delta:
                        yield delta
    except httpx.TimeoutException:
        raise _Retry(f"{model_id} timed out")


async def stream_reply(messages, selected):
    primary = selected if selected in MODEL_IDS else DEFAULT_MODEL
    chain = [primary] + [m["id"] for m in MODELS if m["id"] != primary]
    system_prompt = _persona_prompt(primary)

    last_error = None
    for model_id in chain:
        for attempt in range(MAX_RETRIES + 1):
            streamed = False
            try:
                async for chunk in _stream_groq(model_id, messages, system_prompt):
                    streamed = True
                    yield chunk
                return
            except _Retry as exc:
                last_error = exc
                if streamed:
                    raise _MidStream(str(exc))
                if attempt < MAX_RETRIES:
                    continue
                break
            except Exception as exc:
                last_error = exc
                if streamed:
                    raise _MidStream(str(exc))
                break
    raise RuntimeError(f"All models exhausted. Last error: {last_error}")


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.headers.get("x-real-ip") or (request.client.host if request.client else "unknown")


limiter = Limiter(key_func=client_ip)

app = FastAPI(title="Kinotech Chat API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _sse(event, data):
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@app.get("/health")
def health():
    return {"ok": True, "providers": {"groq": bool(GROQ_API_KEY)}}


@app.get("/models")
def list_models():
    return {"models": MODELS, "default": DEFAULT_MODEL}


TITLE_MODEL = "llama-3.1-8b-instant"
TITLE_PROMPT = (
    "Generate a short noun-phrase label (3 to 5 words) describing the topic of the user's message. "
    "Use Title Case. Output a label, not a sentence. Do not include the answer. No punctuation, no quotes.\n\n"
    "Examples:\n"
    "  Message: what is recursion\n  Label: Recursion Basics\n\n"
    "  Message: recommend a 3-day trip to tokyo\n  Label: Tokyo Trip Itinerary\n\n"
    "  Message: review my python prime function\n  Label: Python Prime Function Review\n\n"
    "  Message: how do i fix a leaky faucet\n  Label: Fixing Leaky Faucet\n\n"
    "Reply with only the label."
)


class TitleRequest(BaseModel):
    user: str
    assistant: str


@app.post("/title")
@limiter.limit("60/minute")
async def make_title(request: Request, req: TitleRequest):
    user_msg = req.user.strip()[:600]
    try:
        raw = await _complete_groq(TITLE_MODEL, TITLE_PROMPT, f"Message: {user_msg}\nLabel:", max_tokens=16)
        title = raw.strip().strip('"\'').rstrip(".…:").strip()
        if "\n" in title:
            title = title.split("\n", 1)[0].strip()
        if not title:
            return {"title": None}
        return {"title": title[:60]}
    except Exception:
        return {"title": None}


@app.post("/chat")
@limiter.limit("60/minute")
async def chat(request: Request, req: ChatRequest):
    if not req.messages:
        raise HTTPException(status_code=400, detail="messages must not be empty")
    messages = [m.model_dump() for m in req.messages]

    async def event_stream():
        try:
            async for chunk in stream_reply(messages, req.model):
                yield _sse("token", {"text": chunk})
            yield _sse("done", {})
        except _MidStream as exc:
            yield _sse("error", {"message": str(exc)})
        except Exception as exc:
            yield _sse("error", {"message": str(exc)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
