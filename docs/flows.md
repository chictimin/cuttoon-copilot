# 사용자·프로세스 흐름

- 기준 커밋: `a06a040` (main, 2026-10-08)
- 작성일: 2026-10-08
- 원칙: 코드(기준 커밋)를 직접 따라 그린다 — 문서 문구를 옮기지 않는다. 확인 못한 연결은 점선 + "미확인"으로 표시한다.
- 함수 단위 상세 흐름은 `docs/pipeline.md` 1~4절, 흐름 점검 근거는 `.roster/inv-flow-lozu.md`를 본다.
- 실선 = 코드에서 확인한 연결, 점선 = 미확인·진행중.

## 1. 사용자 흐름 — 첫 진입부터 Export까지

```mermaid
flowchart TD
  F1["목록 보기"]
  F2["새 프로젝트 만들기"]
  F3["레퍼런스 올리기"]
  F4["상세 입력·마스코트 고르기"]
  F5["캐릭터 시트 만들기"]
  F6["소재 적기"]
  F7["3턴 대화·말투 고르기"]
  F8["표지 3안 고르기"]
  F9["나머지 컷 만들기"]
  F10["저장하기"]
  F11["대사 고치기·말풍선 옮기기"]
  F12["ZIP으로 내보내기"]
  B1["표지 실패하면 다시 뽑기"]
  B2["컷 실패하면 이어서 만들기"]
  B3["저장 실패하면 복구 안내"]
  B4["저장된 세션 다시 열기"]
  B5["미완성이면 목록으로"]
  B6["나갔다 들어오면 경고"]
  B7["뒤로가기 미확인"]

  F1 --> F2 --> F3 --> F4 --> F5 --> F6 --> F7 --> F8 --> F9 --> F10 --> F11 --> F12
  F8 --> B1
  F9 --> B2
  F10 --> B3
  F10 -- "저장된 id 재방문" --> B4 --> F11
  F11 -- "미완성 id" --> B5
  F9 -- "generating·미저장" --> B6
  F11 -- "미저장 수정" --> B6
  F9 -. "미확인" .-> B7
  F11 -. "미확인" .-> B7
```

## 2. 프로세스 흐름 — 화면 입력부터 ZIP까지

```mermaid
sequenceDiagram
  participant U as 사용자 화면
  participant A as API 라우트
  participant T as 텍스트 생성(LLM)
  participant G as 이미지 생성
  participant V as 저장 검사
  participant D as DB·버킷
  participant E as Export 합성

  rect rgb(240, 245, 255)
  Note over U,G: ① 세션 생성
  U->>A: 소재 보내기
  A->>T: 3턴 대화 만들기
  T-->>U: 선택지 보여주기
  U->>U: 답하기 ×3 · 말투 고르기
  U->>A: 대사 요청
  A->>T: 4컷 대사 만들기
  U->>A: 표지 3안 요청
  A->>G: 표지 만들기
  alt 표지 실패
    U->>U: 다시 뽑기
  end
  U->>U: 표지 1안 고르기
  U->>A: 나머지 컷 요청
  loop 이어서 만들기
    A->>G: 컷 만들기
  end
  alt 컷 실패
    U->>U: 이어서 만들기
  end
  end

  rect rgb(240, 255, 240)
  Note over U,D: ② 저장
  U->>A: 세션 저장
  A->>V: 스키마·선택 기록 검사
  alt 검사 실패
    V-->>U: 400 · 고치기 안내
  else 통과
    V->>D: 세션·선택 기록 저장
    D-->>U: 저장됨(선택 기록 결과 포함)
  end
  end

  rect rgb(255, 248, 240)
  Note over U,D: ③ 에디터 저장
  U->>A: 버전 저장
  A->>D: 버전 저장하기
  end

  rect rgb(255, 240, 245)
  Note over U,E: ④ Export
  U->>A: ZIP 요청
  A->>D: 세션·폰트 읽기
  alt 데모 캐시면
    D-->>E: public 파일
  else 아니면
    D-->>E: 버킷 이미지
  end
  E->>E: 말풍선 합성(좌표·화자 꼬리)
  E-->>U: ZIP 내려주기
  end
```

## 3. 상세 — 소유자별 레인 · 파일 경로

<details><summary>소유자별 레인 · 파일 경로 (펼쳐 보기)</summary>

```mermaid
flowchart TD
  subgraph UI["화면 — JEON-DAEJIN (app/(studio)/, 단 storyboard-assembly.ts는 제외)"]
    U_ON["OnboardingFlow + style-analysis.ts uploadReference"]
    U_SESS["SessionFlow + generate-client.ts"]
    U_ED["EditorFlow + resolveImages"]
  end
  subgraph SRV["서버·DB·스키마 — chictimin"]
    A_SEMB["storyboard-assembly.ts assembleStoryboard (소유 예외: chictimin)"]
    S_UP["POST /api/upload → lib/asset-store.ts uploadAsset"]
    S_BRAIN["POST /api/brainstorm/route.ts → lib/llm/brainstorm.ts"]
    S_CAP["POST /api/session/captions/route.ts (대사 생성)"]
    S_PRE["POST /api/preset/route.ts → assertValidPreset + dedupePresetArrays (#263)"]
    S_SESS["POST /api/session/route.ts → validate.ts 저장 검사 (#280·#295) + selections 검증"]
    S_VER["POST /api/session/version + /revert"]
    S_EXP["GET /api/session/export/route.ts → toRenderCuts + getPreset 폰트"]
    S_DB["lib/db/sessions.ts + selections.ts + presets.ts (Supabase)"]
    S_STORE["Storage 버킷 미확인"]
  end
  subgraph GEN["생성·추출 — joniverse-ai (app/api/extract/ + app/api/generate/ + lib/openai/)"]
    S_EX["POST /api/extract (asset-store에서 읽기)"]
    S_GENR["POST /api/generate (라우트: kind 분기)"]
    G_EXT["extract.ts: extractStyle + generateCharacterSheet"]
    G_GEN["generate.ts: generateCut + generateCoverVariants"]
  end
  subgraph RND["렌더·Export — smartman3514-commits (lib/render/)"]
    R_EXP["export.ts: exportCuts"]
    R_COMP["compose.ts composeCut: anchor 읽기 + 화자 꼬리 (#242)"]
    R_ZIP["zip.ts: buildZip → ZIP 응답"]
  end
  C0["데모 캐시 연결 #307 (미확인·진행중)"]

  U_ON --> S_UP
  U_ON --> S_EX --> G_EXT
  U_SESS --> A_SEMB
  U_ON --> S_GENR --> G_EXT
  S_GENR --> G_GEN
  U_SESS --> S_BRAIN
  U_SESS --> S_CAP
  U_SESS --> S_GENR
  U_ON --> S_PRE --> S_DB
  U_SESS --> S_SESS --> S_DB
  U_ED --> S_VER --> S_DB
  U_ED --> S_EXP --> R_EXP --> R_COMP --> R_ZIP --> U_ED
  S_UP -. "미확인" .-> S_STORE
  U_ED -. "미확인" .-> C0
```

| 단계 | 파일 | 소유 |
| --- | --- | --- |
| 화면 | `app/(studio)/` (단 `session/[id]/storyboard-assembly.ts`는 제외) | JEON-DAEJIN |
| 스토리보드 조립 | `app/(studio)/session/[id]/storyboard-assembly.ts` (소유 예외) | chictimin |
| 세션·프리셋·업로드·브레인스토밍 API | `app/api/session/` · `app/api/preset/` · `app/api/upload/` · `app/api/brainstorm/` | chictimin |
| 스키마·LLM·DB | `spec/` · `lib/llm/` · `lib/db/` · `lib/asset-store.ts` · `lib/session/` | chictimin |
| 생성·추출 API | `app/api/generate/` · `app/api/extract/` | joniverse-ai |
| 이미지 생성·추출 | `lib/openai/` | joniverse-ai |
| 렌더·Export | `lib/render/` | smartman3514-commits |

</details>
