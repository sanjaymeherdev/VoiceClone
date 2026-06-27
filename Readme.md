# Voice Clone Studio

A simple Node.js + Express web app for cloning a voice from a short audio
clip and generating speech from typed text, using Alibaba Cloud's
Qwen-Omni voice cloning API (Singapore / International region).

## What it does

1. **Upload** a 10–20 second audio clip (WAV, MP3, or M4A).
2. The app calls the **voice cloning** API to create a custom voice.
3. **Type any text**, and the app calls the **Qwen-Omni** model
   (`qwen3.5-omni-flash`) to generate speech in the cloned voice.
4. Listen to (and download) the result right in the browser.

## Setup

### 1. Get your credentials

- Sign up / log in to [Alibaba Cloud Model Studio](https://www.alibabacloud.com/help/en/model-studio/get-api-key)
  and select the **Singapore** region — this is required for the free quota.
- Create an API key.
- Find your **Workspace ID** on the Workspace Details page in the console.

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in:

```
DASHSCOPE_API_KEY=sk-your-real-key
WORKSPACE_ID=your-real-workspace-id
```

### 4. Run the app

```bash
node server.js
```

Open **http://localhost:3000** in your browser.

## Staying within the free tier

- New Singapore-region accounts get **1,000 free voice clonings** within
  90 days of activating Model Studio.
- Audio *generation* (turning text into speech) is billed by token usage
  on the Omni model — new accounts also get a **free token quota per
  model** for 90 days. This app uses `qwen3.5-omni-flash` to keep token
  costs as low as possible.
- In the Model Studio console, under **Model Usage → Free Quota**, you
  can turn on **"Free Quota Only"** for `qwen3.5-omni-flash` so calls
  simply stop (instead of silently billing you) once the quota runs out.
- After 90 days or once quota is exhausted: voice cloning costs $0.01 per
  voice, and generation is billed per token.

## Notes on audio quality

For best cloning results, your uploaded clip should:
- Be 10–20 seconds long (max 60s)
- Contain at least 3 continuous seconds of clear, normal speech
- Have no background music, noise, or other voices
- Be mono, ≥24kHz sample rate

## API endpoints (for reference)

| Method | Path                | Purpose                          |
|--------|---------------------|-----------------------------------|
| POST   | `/api/clone-voice`  | Upload audio, create a voice      |
| GET    | `/api/voices`       | List your cloned voices           |
| POST   | `/api/delete-voice` | Delete a voice (frees up quota)   |
| POST   | `/api/generate`     | Generate speech from text + voice |
