# Kinotech Chatbot

A small chat app that streams responses from three Groq-hosted models. You pick the one you want from a dropdown — Pro for general stuff, Coder for code and math, Lite when you just want a fast reply. Conversations stay in your browser, and chats title themselves after the first response lands.

## Run it locally

You'll need Python 3.10 or newer and a free Groq API key from [console.groq.com](https://console.groq.com).

```bash
git clone https://github.com/<you>/kinotech-chatbot.git
cd kinotech-chatbot

pip3 install -r requirements.txt

echo "GROQ_API_KEY=your_key_here" > .env

python3 -m uvicorn main:app --reload --port 8000
```

Once the server is up, open `index.html` in any browser. That's it.

## What's actually here

The backend is a tiny FastAPI app that proxies your messages to Groq and streams the tokens back as Server-Sent Events. The frontend is plain HTML, CSS, and one `script.js` file — no frameworks, no build step, no package.json. Chats live in `localStorage`, so there's no database to set up. A 60-requests-per-minute IP limit keeps things sane if the URL ever gets shared around.

If a model errors out (rate limit, hiccup, anything), the request quietly falls through to the next one in the chain. Coder is Qwen 3, which thinks before it answers — those reasoning tokens are stripped on the way to the screen, so you only see the final response.

## Models

- **Kinotech Pro** — `openai/gpt-oss-120b`
- **Kinotech Coder** — `qwen/qwen3-32b`
- **Kinotech Lite** — `llama-3.1-8b-instant`

All three are open-weights models running on Groq's hardware. You can switch between them mid-conversation; each chat keeps track of its own.
