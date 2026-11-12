// Runs entirely in the browser: each visitor uses their own Gemini key, stored only in their browser.
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL = "gemini-flash-latest";
// Used when the main model stays overloaded (503) after retries.
const FALLBACK_MODEL = "gemini-flash-lite-latest";
const RETRY_DELAYS_MS = [2000, 5000, 10000];

// The page shows progress such as "Gemini is busy, retrying (2/3)…" through this listener.
let statusListener = () => {};
export function onGeminiStatus(fn) {
  statusListener = fn;
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

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
        `Keywords: ${s.keywords.join(", ")}\nPrepared answer (EN): ${s.answer_en}` +
        (s.answer_ko ? `\nPrepared answer (KO): ${s.answer_ko}` : ""),
    )
    .join("\n\n");
  return (
    `CANDIDATE PROFILE\nTarget role: ${profile.target_role}\n` +
    `Job description: ${profile.job_description || "(not provided)"}\n\n` +
    `Self-introduction (EN): ${profile.pitch_en}\nSelf-introduction (KO): ${profile.pitch_ko}\n\nSTORIES\n${stories}`
  );
}


const STORY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["target_role", "job_description", "pitch_en", "pitch_ko", "stories"],
  properties: {
    target_role: { type: "string" },
    job_description: { type: "string" },
    pitch_en: { type: "string" },
    pitch_ko: { type: "string" },
    stories: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "title_ko", "situation", "task", "action", "result", "keywords", "answer_en", "answer_ko", "fits"],
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
          answer_ko: { type: "string" },
          fits: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

const EXTRACT_SYSTEM = `You help a Korean job seeker prepare for job interviews held in English or in Korean.
You receive their resume or portfolio (usually in Korean) and optionally a job description.

Turn it into interview-ready material:
- Find 5 to 8 distinct experiences that make good behavioral-interview stories (projects, problems solved, conflicts, failures, leadership, learning something fast).
- For each, write Situation / Task / Action / Result in English. Use only facts that are in the source. Do not invent numbers, company names or outcomes; if a result has no number, describe it qualitatively.
- "answer_en" is what the candidate will actually say out loud: 60-90 seconds, first person, short sentences, common words (CEFR B1-B2), no idioms. It must sound natural when spoken by a non-native speaker.
- "answer_ko" is the same story as a Korean interview answer: about 1 minute, first person, 습니다체, short sentences, natural spoken Korean (not a word-for-word translation of answer_en), same facts only.
- "keywords": 3-5 short English cue words that would remind the candidate of the whole story.
- "fits": the common interview questions this story answers well (e.g. "Tell me about a challenge you faced").
- "title_ko": a short Korean label so the candidate recognizes the story at a glance.
- "id": short lowercase slug, unique.
- "pitch_en": a 45-60 second "Tell me about yourself" answer in the same plain style; "pitch_ko" is the Korean self-introduction ("1분 자기소개"), written as natural spoken Korean in 습니다체, same facts.
- "job_description": the job posting as plain text in its original language (from the pasted text and any attached posting files or screenshots): role, main tasks, requirements, preferred qualifications. Shorten to about 1,500 characters if it is longer. Empty string if no posting was given.
- "target_role": the role they are applying for (from the job description, or inferred from the resume).`;

function interviewerSystem(lang) {
  if (lang === "ko") {
    return `You are a friendly but realistic interviewer at a Korean company hiring for the candidate's target role.
Ask exactly one interview question in natural spoken Korean (존댓말), 1-2 sentences. Output only the question.
Mix experience questions ("~했던 경험을 말씀해 주세요"), role-specific questions, and motivation questions (지원 동기, 입사 후 포부).
Do not repeat a question that was already asked. If a follow-up (꼬리 질문) on the previous answer would be natural, you may ask one.`;
  }
  return `You are a friendly but realistic interviewer at a company hiring for the candidate's target role.
Ask exactly one interview question, in clear spoken English, 1-2 sentences. Output only the question.
Mix behavioral questions ("Tell me about a time...") with role-specific and motivation questions.
Do not repeat a question that was already asked. If a follow-up on the previous answer would be natural, you may ask one.`;
}

function coachSystem(lang) {
  if (lang === "ko") {
    return `You are a Korean job-interview coach. The candidate answered in Korean. Write all feedback in Korean.
Be encouraging and concrete. The answer is a speech-to-text transcript, so ignore missing punctuation and small recognition errors.

Use exactly these sections, as plain text with the headings shown:
## 잘한 점
(1-2 bullets)
## 고칠 표현
(up to 4 bullets in the form: "원래 표현" → "더 나은 표현" — 이유 한 줄. Focus on filler words (음, 그, 약간), casual speech, long run-on sentences and vague claims.)
## 구조 (STAR)
(Which of 상황 / 과제 / 행동 / 결과 was missing or weak, in 1-3 bullets)
## 이렇게 말해 보세요
(A better Korean answer the candidate can actually say: about 1 minute, 습니다체, short sentences, based ONLY on the candidate's real stories in the profile. Name the story id you used in brackets at the start.)`;
  }
  return `You are an English interview coach for a Korean job seeker. Write your feedback in Korean, but keep every English example in English.
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
}

// Lines in the live transcript start with these labels.
export const SPEAKER = { interviewer: "면접관", me: "나" };

function liveSystem(lang) {
  const interviewLang = lang === "ko" ? "Korean" : "English";
  const outputStyle =
    lang === "ko"
      ? "natural spoken Korean (해요체 or 습니다체), short phrases"
      : "simple spoken English (CEFR B1-B2), short phrases";
  return `You help a job candidate during a live video interview held in ${interviewLang}.
You see the recent transcript, where lines start with "${SPEAKER.interviewer}:" (interviewer) or "${SPEAKER.me}:" (the candidate), and the candidate's real experience profile.
Your output is a cue sheet the candidate glances at for two seconds and then answers in their own words. It is not a script.

First decide what the latest interviewer utterance is:
- Not a question or request (small talk, "okay", thanks, an unfinished sentence): output exactly SKIP
- A new question, or a follow-up (꼬리 질문) that digs into what the candidate just said.

Rules:
- Use only facts from the profile and from what the candidate already said. Never invent numbers, names, tools or outcomes.
- For a follow-up, answer the specific thing asked. Do not restart the whole story; P1 answers it directly.
- If the profile does not contain what is asked, say so in P3 and suggest an honest angle (what you would do, or what you learned).

Output exactly these lines and nothing else:
Q: <the question restated in simple Korean, max 15 words>
TYPE: <새 질문 or 꼬리 질문>
STORY: <story id> | <story title_ko>   (or "pitch" for self-introduction, or "none")
P1: <first point: the situation, or the direct answer for a follow-up; max 15 words>
P2: <second point: what I did; max 15 words>
P3: <third point: result, number or lesson; max 15 words>
OPENER: <one short natural sentence to start the answer>

Write P1, P2, P3 and OPENER in ${outputStyle}.`;
}

// ---------- Gemini REST ----------

function geminiError(status, message) {
  if (status === 503 || status === 500) return "Gemini 서버가 지금 너무 붐벼요. 몇 분 뒤 다시 시도해 주세요. (내 키나 파일 문제는 아니에요)";
  if (status === 429) return "Gemini 무료 사용량 한도에 걸렸어요. 1분쯤 기다렸다가 다시 시도하세요. 하루 한도라면 내일 다시 쓸 수 있어요.";
  if (/API_KEY_INVALID|API key not valid/.test(message)) return "Gemini API 키가 올바르지 않아요. 설정 탭에서 키를 다시 확인하세요.";
  return `Gemini 오류 ${status}: ${message}`;
}

// 500/503 mean Google's side is busy, not that the request is wrong: retry with backoff,
// then try a lighter model once before giving up.
async function callGemini(method, body, signal) {
  if (!keys.gemini) throw new Error("먼저 ‘⚙ 설정’ 탭에서 Gemini API 키를 넣어 주세요.");
  const plan = [...RETRY_DELAYS_MS.map((delay) => ({ model: MODEL, delay })), { model: FALLBACK_MODEL, delay: 2000 }];
  let attempt = 0;
  for (;;) {
    const model = attempt === 0 ? MODEL : plan[attempt - 1].model;
    const res = await fetch(`${GEMINI_URL}/${model}:${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": keys.gemini },
      body: JSON.stringify(body),
      signal,
    });
    if (res.ok) {
      statusListener("");
      return res;
    }
    const err = await res.json().catch(() => ({}));
    const busy = res.status === 503 || res.status === 500;
    if (!busy || attempt >= plan.length) {
      statusListener("");
      throw new Error(geminiError(res.status, err.error?.message || res.statusText));
    }
    const next = plan[attempt];
    statusListener(
      next.model === MODEL
        ? `Gemini가 붐벼서 ${next.delay / 1000}초 뒤 다시 시도해요 (${attempt + 1}/${RETRY_DELAYS_MS.length})`
        : "계속 붐벼서 가벼운 모델로 바꿔 시도해요",
    );
    await sleep(next.delay, signal);
    attempt++;
  }
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
/** pdfs: resume PDFs [{ name, data }]; jobFiles: job posting PDFs or images [{ name, mimeType, data }]. */
export async function buildProfile({ text, pdfs, jobDescription, jobFiles = [] }) {
  const parts = [];
  for (const pdf of pdfs) {
    parts.push({ text: `File: ${pdf.name}` });
    parts.push({ inlineData: { mimeType: "application/pdf", data: pdf.data } });
  }
  for (const f of jobFiles) {
    parts.push({ text: `Job posting file: ${f.name}` });
    parts.push({ inlineData: { mimeType: f.mimeType, data: f.data } });
  }
  parts.push({
    text:
      (jobFiles.length ? `Files labelled "Job posting file" are the job posting, not the candidate's materials.\n\n` : "") +
      (pdfs.length ? `The ${pdfs.length} attached resume/portfolio file(s) above are the candidate materials. Combine them into one picture of the candidate; if two files describe the same project, merge them into one story.\n\n` : "") +
      (text ? `RESUME / PORTFOLIO TEXT:\n${text}\n\n` : "") +
      `JOB DESCRIPTION:\n${jobDescription || "(not provided)"}`,
  });
  const res = await callGemini("generateContent", {
    systemInstruction: { parts: [{ text: EXTRACT_SYSTEM }] },
    contents: [{ role: "user", parts }],
    generationConfig: { responseMimeType: "application/json", responseJsonSchema: STORY_SCHEMA, maxOutputTokens: 32000 },
  });
  const parsed = JSON.parse(textOf(await res.json()));
  return { ...parsed, job_description: parsed.job_description || jobDescription || "", updated_at: new Date().toISOString() };
}

const KO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answers"],
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "answer_ko"],
        properties: { id: { type: "string" }, answer_ko: { type: "string" } },
      },
    },
  },
};

/** Profiles made before Korean answers existed: write answer_ko for the stories that lack one. */
export async function addKoreanAnswers(profile) {
  const missing = profile.stories.filter((s) => !s.answer_ko);
  if (!missing.length) return profile;
  const res = await callGemini("generateContent", {
    systemInstruction: {
      parts: [
        {
          text: `For each story, write "answer_ko": the same story as a Korean job-interview answer. About 1 minute, first person, 습니다체, short sentences, natural spoken Korean (not a word-for-word translation). Use only the facts given; do not invent numbers, names or outcomes. Keep each id unchanged.`,
        },
      ],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: JSON.stringify(missing.map(({ id, title, situation, task, action, result, answer_en }) => ({ id, title, situation, task, action, result, answer_en }))) }],
      },
    ],
    generationConfig: { responseMimeType: "application/json", responseJsonSchema: KO_SCHEMA, maxOutputTokens: 16000 },
  });
  const { answers } = JSON.parse(textOf(await res.json()));
  const byId = new Map(answers.map((a) => [a.id, a.answer_ko]));
  return { ...profile, stories: profile.stories.map((s) => (s.answer_ko || !byId.has(s.id) ? s : { ...s, answer_ko: byId.get(s.id) })) };
}

export function askQuestion(profile, { asked = [], lastAnswer = "", focus = "", lang = "ko" }, onText) {
  const prompt =
    `Questions already asked:\n${asked.map((q) => `- ${q}`).join("\n") || "(none - this is the first question)"}\n\n` +
    (lastAnswer ? `Candidate's last answer:\n${lastAnswer}\n\n` : "") +
    (focus ? `Focus area requested by the candidate: ${focus}\n\n` : "") +
    "Ask the next question.";
  return streamText({ system: [interviewerSystem(lang), profileContext(profile)], prompt }, onText);
}

export function getFeedback(profile, { question, answer, lang = "ko" }, onText) {
  return streamText(
    {
      system: [coachSystem(lang), profileContext(profile)],
      prompt: `Interview question: ${question}\n\nMy answer (transcript): ${answer || "(no answer)"}`,
      maxTokens: 8000,
    },
    onText,
  );
}

export function getHint(profile, { utterance, context = "", lang = "ko" }, onText, signal) {
  return streamText(
    {
      system: [liveSystem(lang), profileContext(profile)],
      prompt: `Recent transcript:\n${context || "(start of interview)"}\n\nLatest interviewer utterance:\n${SPEAKER.interviewer}: ${utterance}`,
    },
    onText,
    signal,
  );
}

// ---------- Deepgram (live mode) ----------

// Korean uses nova-2, which has supported Korean the longest; English uses nova-3.
export function openDeepgram(lang = "en") {
  const params = new URLSearchParams({
    model: lang === "ko" ? "nova-2" : "nova-3",
    language: lang,
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
