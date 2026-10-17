import { keys, read, write, buildProfile, askQuestion, getFeedback, getHint, openDeepgram, synthesize, VOICES } from "./ai.js";

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

function englishVoices() {
  return speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
}

// Prefer high-quality system voices (macOS Premium/Enhanced, Edge Natural, Google) over the robotic defaults.
function bestBrowserVoice() {
  const voices = englishVoices();
  const chosen = voices.find((v) => v.name === voiceSettings.browserVoice);
  if (chosen) return chosen;
  const rank = (v) =>
    (/Premium|Enhanced|Natural|Neural/i.test(v.name) ? 4 : 0) +
    (/Google US English/.test(v.name) ? 3 : 0) +
    (/Ava|Zoe|Evan|Nathan|Samantha/.test(v.name) ? 1 : 0) +
    (v.lang === "en-US" ? 1 : 0);
  return voices.sort((a, b) => rank(b) - rank(a))[0];
}

function speakWithBrowser(text, slow) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
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
  $("#browserVoice").innerHTML = englishVoices()
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
  speak("Thanks for joining us today. To start, could you tell me a little about yourself and what you're working on right now?"),
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

$("#resumeFile").addEventListener("change", () => {
  const files = [...$("#resumeFile").files];
  const total = files.reduce((n, f) => n + f.size, 0);
  $("#fileList").innerHTML =
    files.map((f) => `<li><span>${escapeHtml(f.name)}</span><span class="muted">${formatSize(f.size)}</span></li>`).join("") +
    (total > MAX_TOTAL_BYTES ? `<li class="warn">합계 ${formatSize(total)}: 18MB를 넘으면 실패할 수 있어요. 큰 파일은 빼거나 텍스트로 붙여넣어 주세요.</li>` : "");
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
  if (!text && !pdfs.length) return ($("#importState").textContent = "PDF를 올리거나 텍스트를 붙여넣어 주세요.");
  $("#importBtn").disabled = true;
  $("#importState").textContent = `자료 ${files.length || 1}개를 읽고 스토리를 만드는 중이에요… (1~3분)`;
  try {
    profile = await buildProfile({ text, pdfs, jobDescription: $("#jobDesc").value.trim() });
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
  $("#pitchEn").value = profile.pitch_en;
  $("#pitchKo").textContent = profile.pitch_ko;
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
    node.querySelector(".answer-en").value = s.answer_en;
    node.querySelector(".star").innerHTML = ["situation", "task", "action", "result"]
      .map((k) => `<dt>${k[0].toUpperCase() + k.slice(1)}</dt><dd>${escapeHtml(s[k])}</dd>`)
      .join("");
    node.querySelector(".fits").innerHTML = s.fits.map((f) => `<li>${escapeHtml(f)}</li>`).join("");
    node.querySelector(".speak").addEventListener("click", () => speak(card.querySelector(".answer-en").value));
    wrap.appendChild(node);
  }
  updatePracticeReady();
}

document.querySelector('[data-speak="pitch_en"]').addEventListener("click", () => speak($("#pitchEn").value));

$("#saveProfile").addEventListener("click", async () => {
  profile.pitch_en = $("#pitchEn").value;
  for (const card of document.querySelectorAll(".story")) {
    const s = profile.stories.find((x) => x.id === card.dataset.id);
    s.answer_en = card.querySelector(".answer-en").value;
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
      await askQuestion(profile, { asked, lastAnswer: asked.length ? lastAnswer : "", focus: $("#focus").value }, (t) => ($("#question").textContent = t))
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
  recog.lang = "en-US";
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
    await getFeedback(profile, { question: currentQ, answer: lastAnswer }, (t) => ($("#feedback").innerHTML = renderFeedback(t)));
  } catch (err) {
    $("#feedback").textContent = `오류: ${err.message}`;
  } finally {
    $("#feedbackBtn").disabled = false;
  }
});

// ---------- 3. live hints ----------

let liveStream = null;
let recorder = null;
let sttSocket = null;
let utteranceParts = [];
const history = [];
let hintAbort = null;

function addTranscript(text) {
  history.push(text);
  const p = document.createElement("p");
  p.textContent = text;
  $("#transcript").appendChild(p);
  $("#transcript").scrollTop = $("#transcript").scrollHeight;
}

function finalizeUtterance() {
  const text = utteranceParts.join(" ").trim();
  utteranceParts = [];
  $("#interim").textContent = "";
  if (!text) return;
  addTranscript(text);
  if (text.split(/\s+/).length >= 3) requestHint(text);
}

async function requestHint(utterance) {
  hintAbort?.abort();
  hintAbort = new AbortController();
  const context = history.slice(-7, -1).join("\n");
  let shown = false;
  try {
    await getHint(
      profile,
      { utterance, context },
      (t) => {
        if (t.trim().startsWith("SKIP")) return;
        const get = (key) => (t.match(new RegExp(`^${key}:\\s*(.*)$`, "m")) || [])[1] || "";
        if (!shown && get("Q")) {
          shown = true;
          for (const id of ["#hintStory", "#hintKeywords", "#hintOpener"]) $(id).textContent = "";
        }
        if (!shown) return;
        $("#hintQ").textContent = get("Q");
        $("#hintStory").textContent = get("STORY") ? `📌 ${get("STORY")}` : "";
        $("#hintKeywords").textContent = get("KEYWORDS");
        $("#hintOpener").textContent = get("OPENER") ? `“${get("OPENER")}”` : "";
      },
      hintAbort.signal,
    );
  } catch (err) {
    if (err.name !== "AbortError") $("#hintQ").textContent = `오류: ${err.message}`;
  }
}

$("#liveStart").addEventListener("click", async () => {
  if (!profile) return alert("먼저 ‘1. 내 경험’에서 스토리를 만들어 주세요.");
  if (!keys.gemini || !keys.deepgram) {
    showTab("settings");
    return alert("실시간 모드에는 Gemini 키와 Deepgram 키가 모두 필요해요. 설정 탭에서 넣어 주세요.");
  }
  try {
    liveStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch {
    return;
  }
  const audioTracks = liveStream.getAudioTracks();
  if (!audioTracks.length) {
    liveStream.getTracks().forEach((t) => t.stop());
    return alert("오디오가 공유되지 않았어요. 다시 시작해서 ‘탭 오디오 공유’를 켜 주세요.");
  }
  // Only audio is needed; drop the video track right away.
  liveStream.getVideoTracks().forEach((t) => t.stop());
  audioTracks[0].addEventListener("ended", stopLive);

  sttSocket = openDeepgram();
  sttSocket.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "Error" || msg.err_msg) return ($("#hintQ").textContent = `음성인식 오류: ${msg.message || msg.err_msg}`);
    if (msg.type === "UtteranceEnd") return finalizeUtterance();
    if (msg.type !== "Results") return;
    const text = msg.channel?.alternatives?.[0]?.transcript || "";
    if (msg.is_final) {
      if (text) utteranceParts.push(text);
      $("#interim").textContent = utteranceParts.join(" ");
      if (msg.speech_final) finalizeUtterance();
    } else {
      $("#interim").textContent = `${utteranceParts.join(" ")} ${text}`;
    }
  };
  sttSocket.onopen = () => {
    recorder = new MediaRecorder(new MediaStream(audioTracks), { mimeType: "audio/webm;codecs=opus" });
    recorder.ondataavailable = (e) => e.data.size && sttSocket.readyState === WebSocket.OPEN && sttSocket.send(e.data);
    recorder.start(250);
    $("#hintQ").textContent = "듣는 중… 면접관의 질문을 기다리고 있어요.";
  };
  sttSocket.onclose = (e) => {
    if (!recorder) return;
    stopLive();
    // 1008 / 4xxx: Deepgram rejected the key or the request.
    if (e.code !== 1000) $("#hintQ").textContent = `음성인식 연결이 끊겼어요 (${e.code}). 설정 탭에서 Deepgram 키를 확인하세요.`;
  };

  $("#liveStart").disabled = true;
  $("#liveStop").disabled = false;
  $("#forceHint").disabled = false;
  $("#popout").disabled = !("documentPictureInPicture" in window);
});

function stopLive() {
  recorder?.state === "recording" && recorder.stop();
  recorder = null;
  liveStream?.getTracks().forEach((t) => t.stop());
  liveStream = null;
  if (sttSocket?.readyState === WebSocket.OPEN) sttSocket.close();
  sttSocket = null;
  $("#liveStart").disabled = false;
  $("#liveStop").disabled = true;
  $("#forceHint").disabled = true;
  $("#hintQ").textContent = "중지됨";
}

$("#liveStop").addEventListener("click", stopLive);

function forceHint() {
  const pending = utteranceParts.join(" ").trim();
  if (pending) finalizeUtterance();
  else if (history.length) requestHint(history[history.length - 1]);
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

// ---------- boot ----------

renderStatus();
profile = loadProfile();
renderProfile();
updatePracticeReady();
if (!keys.gemini) showTab("settings");
