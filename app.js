import { keys, read, write, buildProfile, askQuestion, getFeedback, getHint, openDeepgram, synthesize, VOICES, onGeminiStatus, SPEAKER, addKoreanAnswers } from "./ai.js";

const $ = (sel) => document.querySelector(sel);

// ---------- shared helpers ----------

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// ---------- voice playback ----------
// Default is a Gemini voice (sounds like a person). The browser's built-in voice is the fallback.

const voiceSettings = {
  get engine() { return read("ic.voiceEngine") || "gemini"; },
  get geminiVoice() { return read("ic.geminiVoice") || VOICES[0].id; },
  get browserVoice() { return read("ic.browserVoice"); },
};

let player = null;
let speakSeq = 0;

function stopSpeaking() {
  speakSeq++;
  speechSynthesis.cancel();
  if (player) {
    player.pause();
    URL.revokeObjectURL(player.src);
    player = null;
  }
  setVoiceState("");
}

function setVoiceState(text) {
  const el = $("#voiceState");
  el.textContent = text;
  el.classList.toggle("hidden", !text);
}

function languageVoices() {
  return speechSynthesis.getVoices().filter((v) => v.lang.startsWith(lang()));
}

// Prefer high-quality system voices (macOS Premium/Enhanced, Edge Natural, Google) over the robotic defaults.
function bestBrowserVoice() {
  const voices = languageVoices();
  const chosen = voices.find((v) => v.name === voiceSettings.browserVoice);
  if (chosen) return chosen;
  const rank = (v) =>
    (/Premium|Enhanced|Natural|Neural/i.test(v.name) ? 4 : 0) +
    (/Google US English/.test(v.name) ? 3 : 0) +
    (/Ava|Zoe|Evan|Nathan|Samantha|Yuna|Jian|Sora/.test(v.name) ? 1 : 0) +
    (v.lang === speechLang() ? 1 : 0);
  return voices.sort((a, b) => rank(b) - rank(a))[0];
}

function speakWithBrowser(text, slow) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = speechLang();
  u.rate = slow ? 0.85 : 1;
  const voice = bestBrowserVoice();
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

async function speak(text, slow = false) {
  stopSpeaking();
  if (!text?.trim()) return;
  const seq = speakSeq;
  if (voiceSettings.engine !== "gemini" || !keys.gemini) return speakWithBrowser(text, slow);
  setVoiceState("🔊 목소리 준비 중…");
  try {
    const blob = await synthesize(text, { voice: voiceSettings.geminiVoice, slow });
    if (seq !== speakSeq) return; // another playback started or it was stopped meanwhile
    player = new Audio(URL.createObjectURL(blob));
    player.onended = () => setVoiceState("");
    setVoiceState("🔊 재생 중 · 클릭하면 멈춰요");
    await player.play();
  } catch (err) {
    if (seq !== speakSeq) return;
    setVoiceState(`자연스러운 목소리를 못 불러와서 기본 목소리로 읽어요 (${err.message})`);
    setTimeout(() => seq === speakSeq && setVoiceState(""), 6000);
    speakWithBrowser(text, slow);
  }
}

let profile = null;

// One interview language for every tab: what stories show, what the practice interviewer speaks, what live mode hears.
// Older pages saved only the live-mode choice, so fall back to it.
const lang = () => read("ic.lang") || read("ic.liveLang") || "ko";
const speechLang = () => (lang() === "ko" ? "ko-KR" : "en-US");

function loadProfile() {
  try {
    return JSON.parse(read("ic.profile") || "null");
  } catch {
    return null;
  }
}

function saveProfile() {
  profile.updated_at = new Date().toISOString();
  write("ic.profile", JSON.stringify(profile));
}

// ---------- tabs & status ----------

document.querySelectorAll(".tab").forEach((btn) =>
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${btn.dataset.tab}`));
  }),
);

function showTab(name) {
  document.querySelector(`.tab[data-tab="${name}"]`).click();
}

function renderStatus() {
  const parts = [];
  parts.push(keys.gemini ? "Gemini 키 있음" : '<span class="bad">Gemini 키 없음</span>');
  parts.push(keys.deepgram ? "Deepgram 키 있음" : '<span class="bad">Deepgram 키 없음 (실시간 모드 불가)</span>');
  $("#status").innerHTML = parts.join(" · ");
}

// ---------- 0. settings ----------

$("#geminiKey").value = keys.gemini;
$("#deepgramKey").value = keys.deepgram;
$("#saveKeys").addEventListener("click", () => {
  keys.set("gemini", $("#geminiKey").value);
  keys.set("deepgram", $("#deepgramKey").value);
  renderStatus();
  $("#keyState").textContent = "저장했어요. 이 브라우저에만 저장돼요.";
});
$("#clearKeys").addEventListener("click", () => {
  keys.set("gemini", "");
  keys.set("deepgram", "");
  $("#geminiKey").value = $("#deepgramKey").value = "";
  renderStatus();
  $("#keyState").textContent = "키를 지웠어요.";
});

// voice settings
function fillVoiceSelects() {
  $("#voiceEngine").value = voiceSettings.engine;
  $("#geminiVoice").innerHTML = VOICES.map((v) => `<option value="${v.id}">${escapeHtml(v.label)}</option>`).join("");
  $("#geminiVoice").value = voiceSettings.geminiVoice;
  const best = bestBrowserVoice();
  $("#browserVoice").innerHTML = languageVoices()
    .map((v) => `<option value="${escapeHtml(v.name)}">${escapeHtml(`${v.name} (${v.lang})`)}</option>`)
    .join("");
  if (best) $("#browserVoice").value = best.name;
  $("#geminiVoiceRow").classList.toggle("hidden", voiceSettings.engine !== "gemini");
  $("#browserVoiceRow").classList.toggle("hidden", voiceSettings.engine === "gemini");
}
speechSynthesis.addEventListener?.("voiceschanged", fillVoiceSelects);
$("#voiceEngine").addEventListener("change", (e) => {
  write("ic.voiceEngine", e.target.value);
  fillVoiceSelects();
});
$("#geminiVoice").addEventListener("change", (e) => write("ic.geminiVoice", e.target.value));
$("#browserVoice").addEventListener("change", (e) => write("ic.browserVoice", e.target.value));
$("#previewVoice").addEventListener("click", () =>
  speak(
    lang() === "ko"
      ? "오늘 시간 내 주셔서 감사합니다. 먼저 간단하게 자기소개 부탁드릴게요."
      : "Thanks for joining us today. To start, could you tell me a little about yourself and what you're working on right now?",
  ),
);
$("#voiceState").addEventListener("click", stopSpeaking);
fillVoiceSelects();

// ---------- 1. profile ----------

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// Inline PDFs travel in one request; Gemini caps a request at about 20MB.
const MAX_TOTAL_BYTES = 18 * 1024 * 1024;

function formatSize(bytes) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(bytes / 1024)}KB`;
}

// Job posting attachments live in an array (not the input) so pasted screenshots can join picked files.
const jobAttachments = [];
const JOB_INLINE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

function renderFileLists() {
  const resumes = [...$("#resumeFile").files];
  const total = [...resumes, ...jobAttachments].reduce((n, f) => n + f.size, 0);
  const warn =
    total > MAX_TOTAL_BYTES
      ? `<li class="warn">이력서와 공고 파일 합계 ${formatSize(total)}: 18MB를 넘으면 실패할 수 있어요. 큰 파일은 빼거나 텍스트로 붙여넣어 주세요.</li>`
      : "";
  $("#fileList").innerHTML =
    resumes.map((f) => `<li><span>${escapeHtml(f.name)}</span><span class="muted">${formatSize(f.size)}</span></li>`).join("") + warn;
  $("#jobFileList").innerHTML = jobAttachments
    .map(
      (f, i) =>
        `<li><span>${escapeHtml(f.name)}</span><span class="muted">${formatSize(f.size)} <button class="remove" data-i="${i}" title="빼기" aria-label="${escapeHtml(f.name)} 빼기">×</button></span></li>`,
    )
    .join("");
}

function addJobFiles(files) {
  const skipped = [];
  for (const f of files) {
    if (JOB_INLINE_TYPES.includes(f.type) || /\.(txt|md)$/i.test(f.name)) jobAttachments.push(f);
    else skipped.push(f.name);
  }
  renderFileLists();
  $("#importState").textContent = skipped.length
    ? `${skipped.join(", ")}: 지원하지 않는 형식이라 뺐어요. PDF나 이미지로 저장해서 올려 주세요.`
    : "";
}

$("#resumeFile").addEventListener("change", renderFileLists);
$("#jobFiles").addEventListener("change", (e) => {
  addJobFiles([...e.target.files]);
  e.target.value = "";
});
$("#jobFileList").addEventListener("click", (e) => {
  const i = e.target.closest(".remove")?.dataset.i;
  if (i === undefined) return;
  jobAttachments.splice(Number(i), 1);
  renderFileLists();
});
// A screenshot of the posting can be pasted straight into the text box.
$("#jobDesc").addEventListener("paste", (e) => {
  const images = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
  if (!images.length) return;
  e.preventDefault();
  const stamp = new Date().toTimeString().slice(0, 8).replaceAll(":", "");
  addJobFiles(images.map((f, k) => new File([f], `붙여넣은 공고 이미지 ${stamp}${k ? `-${k}` : ""}.png`, { type: f.type })));
});

$("#importBtn").addEventListener("click", async () => {
  const files = [...$("#resumeFile").files];
  const textParts = [];
  const pdfs = [];
  for (const file of files) {
    if (file.type === "application/pdf") pdfs.push({ name: file.name, data: await fileToBase64(file) });
    else textParts.push(`--- ${file.name} ---\n${await file.text()}`);
  }
  const pasted = $("#resumeText").value.trim();
  if (pasted) textParts.push(`--- 붙여넣은 텍스트 ---\n${pasted}`);
  const text = textParts.join("\n\n");
  const jobFiles = [];
  const jobTexts = [];
  for (const file of jobAttachments) {
    if (JOB_INLINE_TYPES.includes(file.type)) jobFiles.push({ name: file.name, mimeType: file.type, data: await fileToBase64(file) });
    else jobTexts.push(`--- ${file.name} ---\n${await file.text()}`);
  }
  const jobDescription = [$("#jobDesc").value.trim(), ...jobTexts].filter(Boolean).join("\n\n");
  if (!text && !pdfs.length) return ($("#importState").textContent = "PDF를 올리거나 텍스트를 붙여넣어 주세요.");
  $("#importBtn").disabled = true;
  $("#importState").textContent = `자료 ${files.length + jobAttachments.length || 1}개를 읽고 스토리를 만드는 중이에요… (1~3분)`;
  try {
    profile = await buildProfile({ text, pdfs, jobDescription, jobFiles });
    saveProfile();
    renderProfile();
    $("#importState").textContent = `스토리 ${profile.stories.length}개를 만들었어요. 아래에서 다듬어 보세요.`;
  } catch (err) {
    $("#importState").textContent = `실패: ${err.message}`;
  } finally {
    $("#importBtn").disabled = false;
  }
});

function renderProfile() {
  if (!profile) return;
  $("#profileView").classList.remove("hidden");
  $("#roleLine").textContent = `지원 직무: ${profile.target_role}`;
  const other = lang() === "ko" ? "en" : "ko";
  $("#pitchTitle").textContent = lang() === "ko" ? "1분 자기소개" : "자기소개 (Tell me about yourself)";
  $("#pitch").value = profile[`pitch_${lang()}`] || "";
  $("#pitchOtherLabel").textContent = other === "ko" ? "한국어 버전" : "영어 버전";
  $("#pitchOther").textContent = profile[`pitch_${other}`] || "";
  const missingKo = lang() === "ko" && profile.stories.some((s) => !s.answer_ko);
  $("#koMissing").classList.toggle("hidden", !missingKo);
  $("#jobDesc").value ||= profile.job_description || "";
  const wrap = $("#stories");
  wrap.innerHTML = "";
  for (const s of profile.stories) {
    const node = $("#storyTpl").content.cloneNode(true);
    const card = node.querySelector(".story");
    card.dataset.id = s.id;
    node.querySelector(".sid").textContent = `[${s.id}]`;
    node.querySelector(".title-ko").textContent = s.title_ko;
    node.querySelector(".title").textContent = s.title;
    node.querySelector(".kw").innerHTML = s.keywords.map((k) => `<span>${escapeHtml(k)}</span>`).join("");
    node.querySelector(".answer").value = s[`answer_${lang()}`] || "";
    node.querySelector(".star").innerHTML = ["situation", "task", "action", "result"]
      .map((k) => `<dt>${k[0].toUpperCase() + k.slice(1)}</dt><dd>${escapeHtml(s[k])}</dd>`)
      .join("");
    node.querySelector(".fits").innerHTML = s.fits.map((f) => `<li>${escapeHtml(f)}</li>`).join("");
    node.querySelector(".speak").addEventListener("click", () => speak(card.querySelector(".answer").value));
    wrap.appendChild(node);
  }
  updatePracticeReady();
}

document.querySelector("#speakPitch").addEventListener("click", () => speak($("#pitch").value));

$("#makeKo").addEventListener("click", async () => {
  $("#makeKo").disabled = true;
  $("#koState").textContent = "한국어 답변을 만드는 중이에요… (30초~1분)";
  try {
    profile = await addKoreanAnswers(profile);
    saveProfile();
    renderProfile();
    $("#koState").textContent = "";
  } catch (err) {
    $("#koState").textContent = `실패: ${err.message}`;
  } finally {
    $("#makeKo").disabled = false;
  }
});

$("#saveProfile").addEventListener("click", async () => {
  profile[`pitch_${lang()}`] = $("#pitch").value;
  for (const card of document.querySelectorAll(".story")) {
    const s = profile.stories.find((x) => x.id === card.dataset.id);
    s[`answer_${lang()}`] = card.querySelector(".answer").value;
  }
  saveProfile();
  $("#saveState").textContent = "저장했어요.";
});

// Backup / restore, and moving stories between browsers.
$("#exportProfile").addEventListener("click", () => {
  if (!profile) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" }));
  a.download = "interview-profile.json";
  a.click();
  URL.revokeObjectURL(a.href);
});
$("#importProfile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.stories)) throw new Error("스토리 파일 형식이 아니에요.");
    profile = data;
    saveProfile();
    renderProfile();
    $("#importState").textContent = `스토리 ${profile.stories.length}개를 불러왔어요.`;
  } catch (err) {
    $("#importState").textContent = `불러오기 실패: ${err.message}`;
  }
  e.target.value = "";
});

// ---------- 2. practice ----------

const asked = [];
let currentQ = "";

function updatePracticeReady() {
  $("#nextQ").disabled = !profile;
  if (!profile) $("#question").textContent = "먼저 ‘1. 내 경험’에서 이력서를 올려 주세요.";
}

$("#nextQ").addEventListener("click", async () => {
  $("#nextQ").disabled = true;
  $("#feedbackCard").classList.add("hidden");
  $("#answer").value = "";
  $("#question").textContent = "…";
  try {
    currentQ = (
      await askQuestion(profile, { asked, lastAnswer: asked.length ? lastAnswer : "", focus: $("#focus").value, lang: lang() }, (t) => ($("#question").textContent = t))
    ).trim();
    asked.push(currentQ);
    speak(currentQ, $("#slowVoice").checked);
    $("#repeatQ").disabled = false;
    $("#recBtn").disabled = false;
    $("#feedbackBtn").disabled = false;
  } catch (err) {
    $("#question").textContent = `오류: ${err.message}`;
  } finally {
    $("#nextQ").disabled = false;
  }
});

$("#repeatQ").addEventListener("click", () => speak(currentQ, $("#slowVoice").checked));

// Practice answers use the browser's built-in speech recognition (Chrome), so no extra key is needed.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recog = null;
let recording = false;

function startRecording() {
  if (!SR) return alert("이 브라우저는 음성 인식을 지원하지 않아요. Chrome을 쓰거나 답변을 직접 입력해 주세요.");
  stopSpeaking();
  recog = new SR();
  recog.lang = speechLang();
  recog.continuous = true;
  recog.interimResults = true;
  const base = $("#answer").value ? `${$("#answer").value.trim()} ` : "";
  let finals = "";
  recog.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finals += `${e.results[i][0].transcript.trim()} `;
      else interim += e.results[i][0].transcript;
    }
    $("#answer").value = base + finals + interim;
  };
  // Chrome ends recognition after a pause; restart while the user is still answering.
  recog.onend = () => recording && recog.start();
  recog.start();
  recording = true;
  $("#recBtn").classList.add("on");
  $("#recBtn").textContent = "■ 말하기 끝";
}

function stopRecording() {
  recording = false;
  recog?.stop();
  $("#recBtn").classList.remove("on");
  $("#recBtn").textContent = "● 말하기 시작";
}

$("#recBtn").addEventListener("click", () => (recording ? stopRecording() : startRecording()));

let lastAnswer = "";

function renderFeedback(text) {
  return escapeHtml(text).replace(/^## (.+)$/gm, "<h4>$1</h4>");
}

$("#feedbackBtn").addEventListener("click", async () => {
  if (recording) stopRecording();
  lastAnswer = $("#answer").value.trim();
  $("#feedbackCard").classList.remove("hidden");
  $("#feedback").textContent = "피드백을 쓰는 중…";
  $("#feedbackBtn").disabled = true;
  try {
    await getFeedback(profile, { question: currentQ, answer: lastAnswer, lang: lang() }, (t) => ($("#feedback").innerHTML = renderFeedback(t)));
  } catch (err) {
    $("#feedback").textContent = `오류: ${err.message}`;
  } finally {
    $("#feedbackBtn").disabled = false;
  }
});

// ---------- 3. live hints ----------
// Two audio channels: the interview tab (interviewer) and, optionally, my mic (me).
// Only the interviewer's finished utterances ask for a hint; my lines give follow-ups their context.

const channels = []; // { speaker, stream, socket, recorder, parts }
const history = []; // { speaker, text }
let hintAbort = null;

const liveLang = lang;

function addTranscript(speaker, text) {
  history.push({ speaker, text });
  const p = document.createElement("p");
  const who = document.createElement("b");
  who.textContent = `${speaker}: `;
  who.className = speaker === SPEAKER.me ? "me" : "them";
  p.append(who, text);
  $("#transcript").appendChild(p);
  $("#transcript").scrollTop = $("#transcript").scrollHeight;
}

function showInterim() {
  $("#interim").textContent = channels
    .map((c) => (c.interim ? `${c.speaker}: ${c.interim}` : ""))
    .filter(Boolean)
    .join("  ·  ");
}

function finalizeUtterance(channel) {
  const text = channel.parts.join(" ").trim();
  channel.parts = [];
  channel.interim = "";
  showInterim();
  if (!text) return;
  addTranscript(channel.speaker, text);
  // Korean questions can be short ("자기소개 해 주세요"), so count characters too.
  if (channel.speaker === SPEAKER.interviewer && (text.split(/\s+/).length >= 3 || text.length >= 8)) requestHint(text);
}

function renderHint(t) {
  const get = (key) => (t.match(new RegExp(`^${key}:\\s*(.*)$`, "m")) || [])[1]?.trim() || "";
  const type = get("TYPE");
  $("#hintType").textContent = type;
  $("#hintType").classList.toggle("hidden", !type);
  $("#hintType").classList.toggle("follow", type.includes("꼬리"));
  $("#hintQ").textContent = get("Q");
  const story = get("STORY");
  $("#hintStory").textContent = story && story !== "none" ? `📌 ${story}` : "";
  $("#hintPoints").innerHTML = ["P1", "P2", "P3"]
    .map(get)
    .filter(Boolean)
    .map((p) => `<li>${escapeHtml(p)}</li>`)
    .join("");
  $("#hintOpener").textContent = get("OPENER") ? `“${get("OPENER")}”` : "";
}

async function requestHint(utterance) {
  hintAbort?.abort();
  hintAbort = new AbortController();
  // Everything said before this question, both speakers, so follow-ups know my last answer.
  const context = history
    .slice(-13, -1)
    .map((h) => `${h.speaker}: ${h.text}`)
    .join("\n");
  let shown = false;
  try {
    await getHint(
      profile,
      { utterance, context, lang: liveLang() },
      (t) => {
        if (t.trim().startsWith("SKIP")) return;
        if (!/^Q:/m.test(t)) return;
        if (!shown) {
          shown = true;
          renderHint("");
        }
        renderHint(t);
      },
      hintAbort.signal,
    );
  } catch (err) {
    if (err.name !== "AbortError") $("#hintQ").textContent = `오류: ${err.message}`;
  }
}

function openChannel(speaker, track) {
  const channel = { speaker, stream: new MediaStream([track]), socket: openDeepgram(liveLang()), recorder: null, parts: [], interim: "" };
  const { socket } = channel;
  socket.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "Error" || msg.err_msg) return ($("#hintQ").textContent = `음성인식 오류: ${msg.message || msg.err_msg}`);
    if (msg.type === "UtteranceEnd") return finalizeUtterance(channel);
    if (msg.type !== "Results") return;
    const text = msg.channel?.alternatives?.[0]?.transcript || "";
    if (msg.is_final) {
      if (text) channel.parts.push(text);
      channel.interim = channel.parts.join(" ");
      showInterim();
      if (msg.speech_final) finalizeUtterance(channel);
    } else {
      channel.interim = `${channel.parts.join(" ")} ${text}`.trim();
      showInterim();
    }
  };
  socket.onopen = () => {
    channel.recorder = new MediaRecorder(channel.stream, { mimeType: "audio/webm;codecs=opus" });
    channel.recorder.ondataavailable = (e) => e.data.size && socket.readyState === WebSocket.OPEN && socket.send(e.data);
    channel.recorder.start(250);
  };
  socket.onclose = (e) => {
    if (!channels.includes(channel)) return;
    stopLive();
    // 1006 / 1008 / 4xxx: Deepgram rejected the key or the request.
    if (e.code !== 1000) $("#hintQ").textContent = `음성인식 연결이 끊겼어요 (${e.code}). 설정 탭에서 Deepgram 키를 확인하세요.`;
  };
  channels.push(channel);
  return channel;
}

$("#liveStart").addEventListener("click", async () => {
  if (!profile) return alert("먼저 ‘1. 내 경험’에서 스토리를 만들어 주세요.");
  if (!keys.gemini || !keys.deepgram) {
    showTab("settings");
    return alert("실시간 모드에는 Gemini 키와 Deepgram 키가 모두 필요해요. 설정 탭에서 넣어 주세요.");
  }
  let tabStream;
  try {
    tabStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch {
    return;
  }
  const [tabAudio] = tabStream.getAudioTracks();
  // Only audio is needed; drop the video track right away.
  tabStream.getVideoTracks().forEach((t) => t.stop());
  if (!tabAudio) return alert("오디오가 공유되지 않았어요. 다시 시작해서 ‘탭 오디오 공유’를 켜 주세요.");
  tabAudio.addEventListener("ended", stopLive);

  let micAudio = null;
  if ($("#listenMe").checked) {
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      [micAudio] = micStream.getAudioTracks();
    } catch {
      $("#hintQ").textContent = "마이크를 못 써서 면접관 소리만 들어요. 꼬리 질문 힌트가 덜 정확할 수 있어요.";
    }
  }

  openChannel(SPEAKER.interviewer, tabAudio);
  if (micAudio) openChannel(SPEAKER.me, micAudio);
  renderHint("");
  $("#hintQ").textContent = `듣는 중… (${liveLang() === "ko" ? "한국어" : "영어"}) 면접관의 질문을 기다리고 있어요.`;

  $("#liveStart").disabled = true;
  $("#lang").disabled = true;
  $("#listenMe").disabled = true;
  $("#liveStop").disabled = false;
  $("#forceHint").disabled = false;
  $("#popout").disabled = !("documentPictureInPicture" in window);
});

function stopLive() {
  const closing = channels.splice(0);
  for (const c of closing) {
    if (c.recorder?.state === "recording") c.recorder.stop();
    c.stream.getTracks().forEach((t) => t.stop());
    if (c.socket.readyState === WebSocket.OPEN) c.socket.close();
  }
  hintAbort?.abort();
  $("#liveStart").disabled = false;
  $("#lang").disabled = false;
  $("#listenMe").disabled = false;
  $("#liveStop").disabled = true;
  $("#forceHint").disabled = true;
  $("#hintQ").textContent = "중지됨";
}

$("#liveStop").addEventListener("click", stopLive);

function forceHint() {
  const interviewer = channels.find((c) => c.speaker === SPEAKER.interviewer);
  if (interviewer?.parts.length) return finalizeUtterance(interviewer);
  const last = [...history].reverse().find((h) => h.speaker === SPEAKER.interviewer);
  if (last) requestHint(last.text);
}
$("#forceHint").addEventListener("click", forceHint);
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !$("#forceHint").disabled && !/TEXTAREA|INPUT|SELECT/.test(e.target.tagName)) {
    e.preventDefault();
    forceHint();
  }
});

// Document Picture-in-Picture keeps the hint panel in a small always-on-top window (Chrome 116+).
$("#popout").addEventListener("click", async () => {
  const panel = $("#hintPanel");
  const pip = await window.documentPictureInPicture.requestWindow({ width: 460, height: 280 });
  const link = pip.document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("style.css", document.baseURI).href;
  pip.document.head.appendChild(link);
  pip.document.body.style.margin = "0";
  pip.document.body.style.background = "#10141c";
  pip.document.body.appendChild(panel);
  pip.addEventListener("pagehide", () => $("#tab-live").insertBefore(panel, $("#tab-live").children[2]));
});

// Retry progress shows in the same floating pill used for voice playback.
onGeminiStatus((text) => setVoiceState(text ? `⏳ ${text}` : ""));

// ---------- interview language ----------

function applyLanguage() {
  $("#lang").value = lang();
  $("#answer").placeholder = lang() === "ko" ? "답변을 말하거나 입력하세요…" : "Your answer...";
  fillVoiceSelects();
  renderProfile();
}
$("#lang").addEventListener("change", (e) => {
  write("ic.lang", e.target.value);
  applyLanguage();
});

// ---------- boot ----------

renderStatus();
profile = loadProfile();
applyLanguage();
updatePracticeReady();
if (!keys.gemini) showTab("settings");
