// Runs entirely in the browser: each visitor uses their own Gemini key, stored only in their browser.
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL = "gemini-flash-latest";

export const keys = {
  get gemini() { return read("ic.geminiKey"); },
  get deepgram() { return read("ic.deepgramKey"); },
  set(name, value) { write(`ic.${name}Key`, value.trim()); },
};

// localStorage can throw in private windows; the app still works for the session.
const memory = {};
export function read(key) {
  try { return localStorage.getItem(key) ?? memory[key] ?? ""; } catch { return memory[key] ?? ""; }
}
export function write(key, value) {
  memory[key] = value;
  try { localStorage.setItem(key, value); } catch {}
}

function profileContext(profile) {
  const stories = profile.stories
    .map(
      (s) =>
        `[${s.id}] ${s.title}\n` +
        `Situation: ${s.situation}\nTask: ${s.task}\nAction: ${s.action}\nResult: ${s.result}\n` +
        `Keywords: ${s.keywords.join(", ")}\nPrepared answer: ${s.answer_en}`,
    )
    .join("\n\n");
  return (
    `CANDIDATE PROFILE\nTarget role: ${profile.target_role}\n` +
    `Job description: ${profile.job_description || "(not provided)"}\n\n` +
    `Self-introduction: ${profile.pitch_en}\n\nSTORIES\n${stories}`
  );
}


const STORY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["target_role", "pitch_en", "pitch_ko", "stories"],
  properties: {
    target_role: { type: "string" },
    pitch_en: { type: "string" },
    pitch_ko: { type: "string" },
    stories: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "title_ko", "situation", "task", "action", "result", "keywords", "answer_en", "fits"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          title_ko: { type: "string" },
          situation: { type: "string" },
          task: { type: "string" },
          action: { type: "string" },
          result: { type: "string" },
          keywords: { type: "array", items: { type: "string" } },
          answer_en: { type: "string" },
          fits: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

const EXTRACT_SYSTEM = `You help a Korean job seeker prepare for an English-language job interview.
You receive their resume or portfolio (usually in Korean) and optionally a job description.

Turn it into interview-ready material:
- Find 5 to 8 distinct experiences that make good behavioral-interview stories (projects, problems solved, conflicts, failures, leadership, learning something fast).
- For each, write Situation / Task / Action / Result in English. Use only facts that are in the source. Do not invent numbers, company names or outcomes; if a result has no number, describe it qualitatively.
- "answer_en" is what the candidate will actually say out loud: 60-90 seconds, first person, short sentences, common words (CEFR B1-B2), no idioms. It must sound natural when spoken by a non-native speaker.
- "keywords": 3-5 short English cue words that would remind the candidate of the whole story.
- "fits": the common interview questions this story answers well (e.g. "Tell me about a challenge you faced").
- "title_ko": a short Korean label so the candidate recognizes the story at a glance.
- "id": short lowercase slug, unique.
- "pitch_en": a 45-60 second "Tell me about yourself" answer in the same plain style; "pitch_ko" is its Korean translation.
- "target_role": the role they are applying for (from the job description, or inferred from the resume).`;

const INTERVIEWER_SYSTEM = `You are a friendly but realistic interviewer at a company hiring for the candidate's target role.
Ask exactly one interview question, in clear spoken English, 1-2 sentences. Output only the question.
Mix behavioral questions ("Tell me about a time...") with role-specific and motivation questions.
Do not repeat a question that was already asked. If a follow-up on the previous answer would be natural, you may ask one.`;

const COACH_SYSTEM = `You are an English interview coach for a Korean job seeker. Write your feedback in Korean, but keep every English example in English.
Be encouraging and concrete. The candidate's answer is a speech-to-text transcript, so ignore missing punctuation and small recognition errors.

Use exactly these sections, as plain text with the headings shown:
## 잘한 점
(1-2 bullets)
## 고칠 표현
(up to 4 bullets in the form: "원래 표현" → "더 자연스러운 표현" — 이유 한 줄)
## 구조 (STAR)
(Which of Situation / Task / Action / Result was missing or weak, in 1-3 bullets)
## 이렇게 말해 보세요
(A better English answer the candidate can actually say: 60-90 seconds, short sentences, B1-B2 words, based ONLY on the candidate's real stories in the profile. Name the story id you used in brackets at the start.)`;

const LIVE_SYSTEM = `You watch a live English job interview transcript and give the candidate a tiny memory cue.
The candidate already prepared the stories in their profile. Your job is to point to the right one, not to write a script.

If the latest interviewer utterance is not a question or request (small talk, "okay", "great", an unfinished sentence), output exactly: SKIP

Otherwise output exactly these lines and nothing else:
Q: <the question restated in simple Korean, max 15 words>
STORY: <story id> | <story title_ko>   (or "STORY: pitch" for tell-me-about-yourself, or "STORY: none" if no story fits)
KEYWORDS: <3-5 English cue words separated by " · ">
OPENER: <one short English sentence the candidate can start with>`;

// ---------- Gemini REST ----------

function geminiError(status, message) {
  if (status === 429) return "Gemini 무료 사용량 한도에 걸렸어요. 1분쯤 기다렸다가 다시 시도하세요. 하루 한도라면 내일 다시 쓸 수 있어요.";
  if (/API_KEY_INVALID|API key not valid/.test(message)) return "Gemini API 키가 올바르지 않아요. 설정 탭에서 키를 다시 확인하세요.";
  return `Gemini 오류 ${status}: ${message}`;
}

async function callGemini(method, body, signal) {
  if (!keys.gemini) throw new Error("먼저 ‘⚙ 설정’ 탭에서 Gemini API 키를 넣어 주세요.");
  const res = await fetch(`${GEMINI_URL}/${MODEL}:${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": keys.gemini },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(geminiError(res.status, err.error?.message || res.statusText));
  }
  return res;
}

function textOf(chunk) {
  return (chunk.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought && p.text).map((p) => p.text).join("");
}

// Streams text and calls onText with the full text so far; resolves to the final text.
async function streamText({ system, prompt, maxTokens = 4000 }, onText, signal) {
  const res = await callGemini(
    "streamGenerateContent?alt=sse",
    {
      systemInstruction: { parts: [{ text: system.join("\n\n") }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    },
    signal,
  );
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
      const event = buf.slice(0, idx);
      buf = buf.slice(idx).replace(/^\r?\n\r?\n/, "");
      const data = event.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      if (!data) continue;
      const t = textOf(JSON.parse(data));
      if (t) {
        full += t;
        onText(full);
      }
    }
  }
  return full;
}

// ---------- app actions ----------

/** files: [{ name, data(base64) }] PDFs; text: pasted/plain-text material. */
export async function buildProfile({ text, pdfs, jobDescription }) {
  const parts = [];
  for (const pdf of pdfs) {
    parts.push({ text: `File: ${pdf.name}` });
    parts.push({ inlineData: { mimeType: "application/pdf", data: pdf.data } });
  }
  parts.push({
    text:
      (pdfs.length ? `The ${pdfs.length} attached file(s) above are the candidate materials. Combine them into one picture of the candidate; if two files describe the same project, merge them into one story.\n\n` : "") +
      (text ? `RESUME / PORTFOLIO TEXT:\n${text}\n\n` : "") +
      `JOB DESCRIPTION:\n${jobDescription || "(not provided)"}`,
  });
  const res = await callGemini("generateContent", {
    systemInstruction: { parts: [{ text: EXTRACT_SYSTEM }] },
    contents: [{ role: "user", parts }],
    generationConfig: { responseMimeType: "application/json", responseJsonSchema: STORY_SCHEMA, maxOutputTokens: 32000 },
  });
  const parsed = JSON.parse(textOf(await res.json()));
  return { ...parsed, job_description: jobDescription || "", updated_at: new Date().toISOString() };
}

export function askQuestion(profile, { asked = [], lastAnswer = "", focus = "" }, onText) {
  const prompt =
    `Questions already asked:\n${asked.map((q) => `- ${q}`).join("\n") || "(none - this is the first question)"}\n\n` +
    (lastAnswer ? `Candidate's last answer:\n${lastAnswer}\n\n` : "") +
    (focus ? `Focus area requested by the candidate: ${focus}\n\n` : "") +
    "Ask the next question.";
  return streamText({ system: [INTERVIEWER_SYSTEM, profileContext(profile)], prompt }, onText);
}

export function getFeedback(profile, { question, answer }, onText) {
  return streamText(
    {
      system: [COACH_SYSTEM, profileContext(profile)],
      prompt: `Interview question: ${question}\n\nMy answer (transcript): ${answer || "(no answer)"}`,
      maxTokens: 8000,
    },
    onText,
  );
}

export function getHint(profile, { utterance, context = "" }, onText, signal) {
  return streamText(
    {
      system: [LIVE_SYSTEM, profileContext(profile)],
      prompt: `Recent transcript:\n${context || "(start of interview)"}\n\nLatest interviewer utterance:\n${utterance}`,
    },
    onText,
    signal,
  );
}

// ---------- Deepgram (live mode) ----------

export function openDeepgram() {
  const params = new URLSearchParams({
    model: "nova-3",
    language: "en",
    smart_format: "true",
    interim_results: "true",
    endpointing: "400",
    utterance_end_ms: "1200",
    vad_events: "true",
  });
  // Browsers cannot set headers on WebSockets; Deepgram accepts the key as a subprotocol.
  const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, ["token", keys.deepgram]);
  // Deepgram closes idle streams after ~10s without audio; KeepAlive covers silent stretches.
  const timer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: "KeepAlive" })), 8000);
  ws.addEventListener("close", () => clearInterval(timer));
  return ws;
}

// ---------- natural voice (Gemini TTS) ----------

const TTS_MODEL = "gemini-3.8-flash-tts";

export const VOICES = [
  { id: "Achird", label: "Achird · 친근한 (남)" },
  { id: "Sulafat", label: "Sulafat · 따뜻한 (여)" },
  { id: "Zubenelgenubi", label: "Zubenelgenubi · 편안한 (남)" },
  { id: "Callirrhoe", label: "Callirrhoe · 여유로운 (여)" },
  { id: "Charon", label: "Charon · 차분히 설명하는 (남)" },
  { id: "Aoede", label: "Aoede · 산뜻한 (여)" },
  { id: "Puck", label: "Puck · 밝은 (남)" },
  { id: "Kore", label: "Kore · 단단한 (여)" },
];

function pcmToWav(pcm, sampleRate = 24000) {
  const header = new DataView(new ArrayBuffer(44));
  const writeStr = (offset, s) => [...s].forEach((c, i) => header.setUint8(offset + i, c.charCodeAt(0)));
  writeStr(0, "RIFF");
  header.setUint32(4, 36 + pcm.length, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true); // PCM
  header.setUint16(22, 1, true); // mono
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  writeStr(36, "data");
  header.setUint32(40, pcm.length, true);
  return new Blob([header, pcm], { type: "audio/wav" });
}

function base64ToBytes(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": keys.gemini },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(geminiError(res.status, err.error?.message || res.statusText));
  }
  return res.json();
}

// Interactions API (current TTS surface): returns WAV in steps[].content[].data.
async function ttsInteractions(text, voice, style) {
  const content = { type: "text", text };
  if (style) content.annotations = [{ type: "speech_metadata", style }];
  const data = await postJson("https://generativelanguage.googleapis.com/v1beta/interactions", {
    model: TTS_MODEL,
    input: [{ type: "user_input", content: [content] }],
    response_format: { type: "audio" },
    generation_config: { speech_config: [{ voice }] },
  });
  const audio = (data.steps || []).flatMap((s) => s.content || []).filter((c) => c.type === "audio").pop();
  const b64 = audio?.data || data.output_audio?.data;
  if (!b64) throw new Error("음성 데이터가 비어 있어요.");
  const bytes = base64ToBytes(b64);
  // RIFF header means it is already a WAV file; otherwise it is raw 24kHz PCM.
  const isWav = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  return isWav ? new Blob([bytes], { type: "audio/wav" }) : pcmToWav(bytes);
}

// generateContent with AUDIO output: older TTS surface, returns raw PCM.
async function ttsGenerateContent(text, voice, style) {
  const data = await postJson(`${GEMINI_URL}/${TTS_MODEL}:generateContent`, {
    contents: [{ parts: [{ text: style ? `Say this in a ${style} way: ${text}` : text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
  });
  const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) throw new Error("음성 데이터가 비어 있어요.");
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || "")?.[1]) || 24000;
  return pcmToWav(base64ToBytes(part.inlineData.data), rate);
}

const ttsCache = new Map();

/** Returns a WAV Blob spoken by a natural Gemini voice. Results are cached to save free-tier quota. */
export async function synthesize(text, { voice = "Achird", slow = false } = {}) {
  if (!keys.gemini) throw new Error("Gemini 키가 없어요.");
  const style = slow
    ? "a natural, friendly job interviewer speaking slowly and clearly"
    : "a natural, friendly job interviewer in a relaxed conversation";
  const cacheKey = `${voice}|${slow}|${text}`;
  if (ttsCache.has(cacheKey)) return ttsCache.get(cacheKey);
  let blob;
  try {
    blob = await ttsInteractions(text, voice, style);
  } catch (err) {
    if (/429|한도|키가 올바르지/.test(err.message)) throw err;
    blob = await ttsGenerateContent(text, voice, style);
  }
  ttsCache.set(cacheKey, blob);
  return blob;
}
