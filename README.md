# LED Board Simulator

단색 LED 전광판을 웹 브라우저에서 모사하는 어플리케이션이다. 이미지, 영상, 카메라, 텍스트를 지정한 해상도의 LED 격자로 보여 주고, 각 소자는 밝을수록 글로우가 넓어지는 발광체로 그린다.

모든 소자가 **글로우 이미지 하나를 공유하고, 소자별로는 투명도(밝기)만 바꿔** 그린다. 이 방식으로 글로우 확장이 표현되는 원리는 [설계 문서](docs/design.md)에 정리했다.

![실행 화면](docs/design/screenshot-96x48.png)

## 실행

빌드 단계와 외부 라이브러리가 없다.

- **바로 열기:** `index.html`을 브라우저(Chrome, Edge 권장)로 연다.
- **로컬 서버:** 카메라 입력을 쓰려면 보안 컨텍스트가 필요하므로 `localhost`로 띄운다.

  ```bash
  python -m http.server 8000
  # 브라우저에서 http://localhost:8000
  ```

WebGL2를 지원하지 않는 브라우저에서는 Canvas2D 렌더러로 자동 전환된다.

### 외부 프로그램에서 WebSocket으로 보내기

시뮬레이터가 WebSocket 클라이언트로 접속하고, 발신 프로그램이 서버가 된다. 시험용 발신 도구가 들어 있다.

```bash
pip install -r tools/requirements.txt   # websockets, opencv-python
python tools/ws_sender.py led                          # LED 직접 입력 (보드 해상도 그대로)
python tools/ws_sender.py image ./photos --interval 2  # JPEG·PNG·WebP 이미지
python tools/ws_sender.py raw --size 320x180           # 무압축 픽셀

# 노트북 웹캠을 보내는 테스트베드 (포트 8766)
python tools/webcam_sender.py
```

시뮬레이터는 소스에서 **외부 스트림 · WebSocket**을 고르고 주소(`ws://127.0.0.1:8765/`)를 넣은 뒤 [연결]을 누른다. 주소를 쿼리로 주면 바로 연결된다. 브라우저 주소창에는 **전체 주소**를 넣는다. `index.html?...`만 넣으면 브라우저가 `index.html`을 도메인으로 보고 `DNS_PROBE_FINISHED_NXDOMAIN` 오류를 낸다.

```text
# 파일로 열 때 (경로는 저장소 위치에 맞게)
file:///D:/workspace/_Lab/LEDBoard/index.html?ws=ws://127.0.0.1:8765/&panel=0

# 로컬 서버로 열 때 (python -m http.server 8000)
http://localhost:8000/index.html?ws=ws://127.0.0.1:8765/&panel=0
```

규격(메시지 형식, 제어 메시지, 오류 코드)은 [외부 소스 입력 인터페이스 사양](docs/source-interface.md)에 있다.

### 쿼리 파라미터와 단축키

| 쿼리 | 의미 |
|---|---|
| `ws=<URL>`, `token=<문자열>` | WebSocket 자동 연결, 인증 토큰 |
| `cols=`, `rows=` | 시작 해상도. 저장된 설정을 덮어쓰지 않음 |
| `panel=0`, `stats=0` | 설정 패널 접기, 상태 표시줄 숨김 |

단축키는 `F` 전체 화면, `H` 패널 접기·펴기, `S` 상태 표시줄 표시·숨김.

## 기능

| 분류 | 항목 |
|---|---|
| 소스 | 밝기 계단 + 파형 패턴, 플라즈마, 시계, 텍스트 스크롤, 이미지·영상 파일(드래그 앤 드롭 가능), 카메라, 외부 WebSocket 스트림(이미지·raw 픽셀·LED 직접 입력) |
| 맞춤 | contain(전체 보기), cover(채우기), stretch(늘리기) |
| 해상도 | 32 × 16 ~ 320 × 180 프리셋 또는 직접 입력(최대 1024 × 1024). 피치 자동 맞춤 또는 수동 |
| 소자 | 원형·사각형. 다이 지름, 헤일로 세기·폭, 스프라이트 반경 조절 |
| 색 | Red, Amber, Green, Blue, White 프리셋 및 색 선택기. 세기, 꺼진 소자 표시 정도 조절 |
| 톤 | 밝기, 대비, 감마, 계조(1·2·3·4·6·8 bit), 1 bit 임계값, 반전 |
| 노출 압축 | 코어를 포화시키고 꼬리를 들어 올려 번짐 강조. WebGL 전용 |
| 밝기 이징 | 가속도 모델. 소자마다 밝기·속도를 두고 목표까지의 거리를 힘으로 적분. 반응 속도(Hz)·감쇠비 ζ 조절, 계단 응답 미리보기 |
| 정지 소자 감광 | 밝기가 일정 수준 이상 변하지 않는 소자를 서서히 어둡게 함. 변화 기준·유지 시간·어두워지는 시간·최저 밝기 조절. 다시 변하면 복귀 |
| 렌더러 | WebGL2 인스턴싱, Canvas2D(소자별 `drawImage`) |
| 기타 | PNG 저장, 설정 자동 저장(`localStorage`), 패널 접기, fps 표시 |

## 사용 팁

- 번짐을 더 강하게 보려면 헤일로 세기를 0.8~1.0, 헤일로 폭을 0.6 정도로 올리거나 노출 압축을 3~6으로 준다.
- 전형적인 전광판 느낌은 계조 1 bit + 텍스트 스크롤 조합이다.
- 밝기 이징의 감쇠비를 0.3 아래로 내리면 밝기가 목표를 지나쳤다 출렁이며 자리 잡는다. 1 이상이면 지나치지 않고 부드럽게 따라간다.
- 해상도를 낮추고(예: 24 × 10) 밝기 계단 패턴을 보면 밝기별 글로우 차이를 확인하기 쉽다.

## 폴더 구조

```text
LEDBoard/
├── index.html            UI 마크업
├── css/style.css         스타일
├── js/                   빌드 없이 file://로 열리도록 전역 스크립트. index.html이 의존 순서대로 로드
│   ├── frame.js          렌더러 입력 프레임 형식 rgba·luma8·bright (LedFrame)
│   ├── glow-sprite.js    단일 글로우 이미지 생성 (GlowSprite)
│   ├── tone.js           휘도 → 밝기 변환 LUT (LedTone)
│   ├── led-dynamics.js   소자 밝기 이징, 가속도 모델 (BrightnessDynamics)
│   ├── idle-dimmer.js    정지 소자 감광 (IdleDimmer)
│   ├── pipeline.js       CPU 밝기 파이프라인: 톤 → 감광 → 이징 (BrightnessPipeline)
│   ├── source.js         입력을 LED 해상도로 샘플링 (FrameSource)
│   ├── renderer-gl.js    WebGL2 인스턴싱 렌더러 (GLRenderer)
│   ├── renderer-2d.js    Canvas2D 렌더러 (Canvas2DRenderer)
│   ├── ws-channel.js     WebSocket 외부 입력 수신 (WsChannel)
│   ├── settings.js       설정 읽기·저장·복원, 쿼리 파라미터 (Settings)
│   ├── previews.js       패널의 글로우·이징·감광 미리보기 (LedPreviews)
│   ├── conn-panel.js     연결 패널, 상태 표시, 표시 모드 UI (ConnPanel)
│   └── main.js           모듈 조립, UI 바인딩, 레이아웃, 렌더 루프
├── tools/
│   ├── requirements.txt  발신 도구 Python 의존성
│   ├── ledboard_proto.py ledboard.v1 발신 측 공통 모듈 (헤더, 메시지, LED 비트 패킹)
│   ├── test_ledboard_proto.py  위 모듈 단위 테스트
│   ├── ws_sender.py      WebSocket 시험용 발신 도구
│   └── webcam_sender.py  웹캠 → WebSocket 테스트베드
└── docs/
    ├── design.md         설계 문서
    ├── design/           설계 문서 리소스 (그림, 그림 생성 스크립트)
    ├── source-interface.md  외부 소스 입력 인터페이스 사양
    └── webcam-testbed.md    웹캠 테스트베드 사용법과 처리 과정
```

## 문서

| 문서 | 내용 |
|---|---|
| [설계 문서](docs/design.md) | 글로우 표현 원리, 아키텍처, 렌더러 구조, 제약 사항 |
| [외부 소스 입력 인터페이스 사양](docs/source-interface.md) | 외부 영상·이미지 스트림(WebRTC·WebSocket)과 LED 직접 입력 연동 규격, 관련 UX 변경. WebSocket 구현 완료, WebRTC 미구현 |
| [웹캠 테스트베드](docs/webcam-testbed.md) | 노트북 웹캠을 WebSocket으로 보내 표시하는 테스트베드. 실행 방법, 송수신 처리 과정, 측정 결과, 문제 해결 |

## 알려진 제약

- 이미지·영상 파일과 카메라 입력은 아직 직접 검증하지 않았다.
- 실제 GPU에서의 성능은 아직 측정하지 않았다.
- 외부 입력은 WebSocket만 구현했다. WebRTC(WHEP)와 화면 캡처는 사양만 있다.
- 영상은 자동 재생 정책 때문에 소리 없이 재생된다.

자세한 제약과 향후 확장 방향(HDR, bloom, 3D 깊이 표현, WebGPU)은 [설계 문서](docs/design.md)를 참고한다.
