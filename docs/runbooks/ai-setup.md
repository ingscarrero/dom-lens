# Runbook: Local AI Setup

DOM Lens works with any OpenAI-compatible local AI server. All AI calls go through the background service worker, which has `<all_urls>` host permission — this means CORS configuration on the server is irrelevant; the extension bypasses it automatically.

---

## Option A — LM Studio (recommended for beginners)

LM Studio provides a GUI for downloading and running models with a built-in OpenAI-compatible server.

### 1. Download and install

- macOS/Windows/Linux: https://lmstudio.ai

### 2. Download a model

For text-only analysis:
- `meta-llama/Meta-Llama-3.1-8B-Instruct` (8B, good quality/speed balance)
- `mistralai/Mistral-7B-Instruct-v0.3` (7B, fast)
- `Qwen/Qwen2.5-7B-Instruct` (7B, strong on code)

For multimodal (screenshot support in Analyze tab):
- `xtuner/llava-llama-3-8b-v1_1-gguf` (8B with vision)
- `Qwen/Qwen2-VL-7B-Instruct-GGUF` (7B, strong vision + code)

### 3. Start the server

1. Open LM Studio → **Developer** tab (left sidebar)
2. Load a model
3. Enable **CORS** (toggle at the top — required for the extension to reach the server, even though the SW bypasses CORS, the server still rejects without the header in some versions)
4. Click **Start server**

Default endpoint: `http://localhost:1234/v1`

### 4. Verify

```bash
curl http://localhost:1234/v1/models
```

Should return a JSON list of loaded models.

### 5. Configure DOM Lens

1. Open DOM Lens → **Settings** tab
2. Set **Base URL** to `http://localhost:1234/v1`
3. Set **Model** to the model name shown in LM Studio (e.g. `meta-llama-3.1-8b-instruct`)
4. Leave **API Key** blank (LM Studio doesn't require one by default)
5. Click **Test connection** — should show a green "Connected" badge

---

## Option B — Ollama

Ollama is a CLI-first approach with a large model library.

### 1. Install

```bash
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh
```

### 2. Pull a model

```bash
ollama pull llama3.1          # 8B text model
ollama pull qwen2.5-coder     # code-focused
ollama pull llava             # multimodal (vision)
```

### 3. Start the server

```bash
ollama serve
```

Default endpoint: `http://localhost:11434`

Ollama exposes an OpenAI-compatible API at `http://localhost:11434/v1`.

### 4. Verify

```bash
curl http://localhost:11434/v1/models
```

### 5. Configure DOM Lens

- **Base URL**: `http://localhost:11434/v1`
- **Model**: model name as listed by `ollama list` (e.g. `llama3.1`, `qwen2.5-coder`)
- **API Key**: blank

---

## Option C — llama.cpp server

For maximum control and lowest overhead.

### 1. Build

```bash
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
cmake -B build -DLLAMA_METAL=ON   # macOS with Apple Silicon
cmake --build build --config Release -j$(nproc)
```

### 2. Download a GGUF model

```bash
huggingface-cli download \
  bartowski/Meta-Llama-3.1-8B-Instruct-GGUF \
  Meta-Llama-3.1-8B-Instruct-Q5_K_M.gguf \
  --local-dir ./models
```

### 3. Start the server

```bash
./build/bin/llama-server \
  --model ./models/Meta-Llama-3.1-8B-Instruct-Q5_K_M.gguf \
  --port 8080 \
  --ctx-size 8192 \
  --n-gpu-layers 99
```

Default endpoint: `http://localhost:8080`

### 4. Configure DOM Lens

- **Base URL**: `http://localhost:8080/v1`
- **Model**: any string (llama.cpp ignores the model field; it serves the loaded model regardless)

---

## Choosing a model for DOM Lens tasks

| Task | Recommended model type | Notes |
|---|---|---|
| Code audit / explain | Code-tuned 7–13B (Qwen2.5-Coder, DeepSeek-Coder) | Better at reading JSX/TS |
| Architecture diagrams | General instruction 7–13B | Mermaid output benefits from larger context |
| UX vision analysis | **Vision model** (Qwen2-VL, LLaVA) | Screenshot is sent as `image_url` — text-only models ignore it |
| Module risk audit | General instruction 7–13B | |
| Memory-chained analyses | General instruction 8B+ | Larger context window helps when memory is included |

---

## Streaming and cancel

All AI calls in DOM Lens stream tokens as they arrive. You can cancel a running analysis:
- **Analyze tab**: click the **Cancel** button that appears while the model is generating.
- **Module / file analyses**: clicking away from the tab implicitly abandons the stream (the request continues on the SW side but results are discarded). A future version will add explicit cancel buttons here.

---

## Troubleshooting AI connectivity

### "Test connection" fails

1. Verify the server is running: `curl <base-url>/models`
2. Check the **Base URL** — must include `/v1` for LM Studio and Ollama (`http://localhost:1234/v1`)
3. Check the background SW console: `chrome://extensions` → DOM Lens → **service worker** → Console. Look for fetch errors.

### Tokens stream but then stop mid-response

- The model ran out of context. Increase `--ctx-size` (llama.cpp) or max context in LM Studio.
- The model timed out. LM Studio has a server timeout setting in **Developer** → Advanced.

### No tokens appear at all

- Check the SW console for a non-200 response from the AI server.
- Make sure the model name in Settings matches exactly what the server reports in `/v1/models`.

### Screenshot sent but model doesn't seem to "see" it

- The loaded model is not a vision model. Switch to LLaVA or Qwen2-VL.
- Some models require a specific system prompt format for vision. Try toggling **Include screenshot** off and back on.
