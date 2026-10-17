# Interview Copilot

영어 면접을 준비하는 한국어 사용자를 위한 웹앱입니다. 서버 없이 브라우저에서만 동작하고, 각자 자기 API 키를 넣어 씁니다.

1. **내 경험**: 한국어 이력서·포트폴리오(PDF/TXT/MD, 여러 개 가능)를 영어 STAR 스토리와 자기소개로 정리합니다. 원문에 없는 내용은 만들지 않도록 지시되어 있습니다.
2. **연습 모드**: AI 면접관이 영어로 질문을 읽어 주고, 마이크나 직접 입력으로 답하면 한국어 피드백을 줍니다. 피드백에는 고칠 표현, STAR 구조 점검, 다시 말해 볼 영어 답변이 들어갑니다.
3. **실시간 모드**: Zoom이나 Google Meet 탭의 오디오를 자막으로 바꾸고, 질문이 나오면 내 스토리 중 맞는 것의 키워드와 첫 문장만 보여 줍니다.

> 실제 면접에서 이런 도구를 쓰는 것을 금지하는 회사가 많습니다. 쓰기 전에 면접 규정을 꼭 확인하세요.

## 필요한 것

| 키 | 용도 | 비용 |
|---|---|---|
| Gemini API 키 ([AI Studio](https://aistudio.google.com/apikey)) | 모든 AI 기능 | 무료 등급 있음 (분당·일일 한도) |
| Deepgram API 키 ([Console](https://console.deepgram.com)) | 실시간 모드 자막 | 가입 시 무료 크레딧 |

- 키는 앱의 **⚙ 설정** 탭에 넣습니다. 키는 그 브라우저의 localStorage에만 저장되고, Google과 Deepgram에 직접 전송됩니다. 이 저장소에는 키가 들어 있지 않습니다.
- Gemini 무료 등급에 보낸 내용은 Google이 서비스 개선에 사용할 수 있습니다. 이력서에서 연락처 같은 개인정보는 지우고 올리세요.
- Chrome에서 쓰는 것을 권장합니다. 연습 모드의 음성 인식, 실시간 모드의 탭 오디오 공유와 작은 창(Document Picture-in-Picture)이 Chrome 기준으로 만들어졌습니다.

## 내 컴퓨터에서 실행

빌드할 것이 없는 정적 사이트입니다.

```bash
git clone https://github.com/DoyuIm/interview-copilot.git
cd interview-copilot
python3 -m http.server 5178
```

Chrome에서 http://localhost:5178 을 엽니다. 마이크는 `localhost`나 `https` 주소에서만 동작합니다.

## 파일 구성

- `index.html`, `style.css`: 화면
- `app.js`: 화면 동작 (탭, 녹음, 실시간 자막, 작은 창)
- `ai.js`: 프롬프트, Gemini REST 호출, Deepgram 연결

모델은 `ai.js`의 `MODEL`(기본값 `gemini-flash-latest`)에서 바꿀 수 있습니다.
