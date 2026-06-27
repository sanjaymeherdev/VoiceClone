require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const { put, list } = require('@vercel/blob');

const VOICES_BLOB_PATH = 'voices.json';

// Load the saved-voices list from Blob storage. Returns [] if it doesn't exist yet.
async function loadSavedVoices() {
  try {
    const { blobs } = await list({ prefix: VOICES_BLOB_PATH });
    const match = blobs.find((b) => b.pathname === VOICES_BLOB_PATH);
    if (!match) return [];
    const response = await fetch(match.url);
    if (!response.ok) return [];
    return await response.json();
  } catch (err) {
    console.error('Failed to load saved voices:', err);
    return [];
  }
}

// Overwrite the saved-voices list in Blob storage.
async function saveSavedVoices(voices) {
  await put(VOICES_BLOB_PATH, JSON.stringify(voices, null, 2), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json'
  });
}

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB, matches API limit
});

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.DASHSCOPE_API_KEY;
const WORKSPACE_ID = process.env.WORKSPACE_ID;

if (!API_KEY || !WORKSPACE_ID || API_KEY.includes('your-key-here')) {
  console.warn(
    '\n⚠️  DASHSCOPE_API_KEY or WORKSPACE_ID is not set.\n' +
    '   Copy .env.example to .env and fill in your real values.\n'
  );
}

// Singapore region endpoints
const CLONE_URL = `https://${WORKSPACE_ID}.ap-southeast-1.maas.aliyuncs.com/api/v1/services/audio/tts/customization`;
const CHAT_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions';

// Use the Flash model — cheaper, draws from the same free quota, good enough for most apps
const TARGET_MODEL = 'qwen3.5-omni-flash';

const MIME_BY_EXT = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4'
};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- 1. Clone a voice from an uploaded audio clip ----
app.post('/api/clone-voice', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file uploaded.' });

    const ext = path.extname(req.file.originalname).toLowerCase();
    const mime = MIME_BY_EXT[ext];
    if (!mime) {
      return res.status(400).json({ error: 'Unsupported format. Use WAV, MP3, or M4A.' });
    }

    const preferredName = (req.body.name || 'myvoice')
      .replace(/[^a-zA-Z0-9_]/g, '')
      .slice(0, 16) || 'myvoice';

    const base64 = req.file.buffer.toString('base64');
    const dataUri = `data:${mime};base64,${base64}`;

    const response = await fetch(CLONE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'qwen-voice-enrollment',
        input: {
          action: 'create',
          target_model: TARGET_MODEL,
          preferred_name: preferredName,
          audio: { data: dataUri }
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Clone error:', data);
      return res.status(response.status).json({
        error: data?.message || 'Voice cloning failed.'
      });
    }

    const voiceRecord = {
      voice: data.output.voice,
      name: preferredName,
      target_model: TARGET_MODEL,
      created: new Date().toISOString()
    };

    // Persist to Blob storage so it's available across sessions/deploys
    try {
      const saved = await loadSavedVoices();
      saved.push(voiceRecord);
      await saveSavedVoices(saved);
    } catch (err) {
      // Cloning itself succeeded, so don't fail the request over a storage hiccup
      console.error('Failed to persist voice to Blob storage:', err);
    }

    res.json(voiceRecord);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error while cloning voice.' });
  }
});

// ---- 2. List saved voices (from Blob storage) ----
app.get('/api/voices', async (_req, res) => {
  try {
    const voices = await loadSavedVoices();
    // Most recently created first
    voices.sort((a, b) => new Date(b.created) - new Date(a.created));
    res.json({ voices });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error while listing saved voices.' });
  }
});

// ---- 3. Delete a voice (from DashScope and from saved list) ----
app.post('/api/delete-voice', async (req, res) => {
  try {
    const { voice } = req.body;
    if (!voice) return res.status(400).json({ error: 'voice is required.' });

    const response = await fetch(CLONE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'qwen-voice-enrollment',
        input: { action: 'delete', voice }
      })
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data?.message });

    const saved = await loadSavedVoices();
    const updated = saved.filter((v) => v.voice !== voice);
    await saveSavedVoices(updated);

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error while deleting voice.' });
  }
});

// ---- 4. Generate speech from text using a cloned (or built-in) voice ----
app.post('/api/generate', async (req, res) => {
  try {
    const { text, voice } = req.body;
    if (!text || !voice) {
      return res.status(400).json({ error: 'text and voice are required.' });
    }

    const response = await fetch(CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: TARGET_MODEL,
        messages: [{ role: 'user', content: text }],
        modalities: ['text', 'audio'],
        audio: { voice, format: 'wav' },
        stream: true, // required by the Omni API
        stream_options: { include_usage: true }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Generate error:', errText);
      return res.status(response.status).json({ error: 'Audio generation failed.' });
    }

    // Parse the SSE stream and reassemble the base64 audio + text
    let audioBase64 = '';
    let transcript = '';
    let buffer = '';

    for await (const chunk of response.body) {
      buffer += Buffer.from(chunk).toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep any incomplete line for next iteration

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;

        let json;
        try {
          json = JSON.parse(payload);
        } catch {
          continue;
        }

        const delta = json?.choices?.[0]?.delta;
        if (delta?.audio?.data) audioBase64 += delta.audio.data;
        if (delta?.audio?.transcript) transcript += delta.audio.transcript;
        if (typeof delta?.content === 'string') transcript += delta.content;
      }
    }

    if (!audioBase64) {
      return res.status(502).json({ error: 'No audio returned by the model.' });
    }

    res.json({ audio: audioBase64, transcript, format: 'wav' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error while generating audio.' });
  }
});

// Only listen on a port when run directly (local dev).
// On Vercel, the app is imported and invoked as a serverless function instead.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Voice clone app running at http://localhost:${PORT}`);
  });
}

module.exports = app;
