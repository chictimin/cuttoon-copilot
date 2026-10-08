# 사용자·프로세스 흐름

- 기준 커밋: `73395e2` (main, 2026-10-08)
- 작성일: 2026-10-08
- 원칙: 코드(기준 커밋)를 직접 따라 그린다 — 문서 문구를 옮기지 않는다. 확인 못한 연결은 점선 + "미확인"으로 표시한다.
- 함수 단위 상세 흐름은 `docs/pipeline.md` 1~4절, 흐름 점검 근거는 `.roster/inv-flow-lozu.md`를 본다.
- 실선 = 코드에서 확인한 연결, 점선 = 미확인·진행중.

## 1. 사용자 흐름 — 첫 진입부터 Export ZIP까지

```mermaid
flowchart TD
  L0["첫 진입 / (app/(studio)/ProjectList.tsx)"]
  L1["0건 안내 + 새 프로젝트 만들기 → /onboarding"]
  L2["온보딩 (app/(studio)/onboarding/OnboardingFlow.tsx): 레퍼런스·상세 입력·마스코트·캐릭터 시트"]
  L3["새 컷툰 만들기 → /session/uuid (sessionStorage에 project-id·preset-id 기록)"]
  S0["세션 (app/(studio)/session/[id]/SessionFlow.tsx): 소재·3턴 대화·말투·표지 3안 선택·컷 생성"]
  S1a["표지 생성 실패 → 다시 시도·다시 뽑기 → loadCoverVariants (step cover 유지)"]
  S1b["나머지 컷 생성 실패 → 이어서 만들기 → runChainedCuts chainRef (step generating 유지)"]
  S2["저장 handleSave → POST /api/session (+selections 동봉)"]
  S3["저장 실패: 400 subject_tags 전용 복구 버튼 / 그 외 error 문구 · selectionsSaved=false면 비차단 토스트"]
  S4["saved 단계 → /editor/id"]
  R0["저장된 세션 재방문 → GET 복원뷰 (저장 버튼 없음, 에디터에서 수정하기)"]
  R1["프로젝트 상세 세션 카드 → /editor 직행 (app/(studio)/projects/[projectId]/ProjectSessions.tsx)"]
  E0["에디터 (app/(studio)/editor/[id]/EditorFlow.tsx): 대사 편집·말풍선 드래그·되돌리기"]
  E1["미완성 id 접근: 아직 완성된 컷툰이 없어요 + 목록 링크"]
  E2["Export: 미저장 수정이 있으면 먼저 저장, 실패하면 내보내지 않음 → GET /api/session/export → ZIP"]
  W0["새로고침 경고 beforeunload: generating(나머지 컷 생성)·미저장 cuts + 에디터 미저장 수정 (cover·온보딩 시트 생성중에는 없음 #297)"]
  W1["브라우저 뒤로가기 실동작 미확인"]

  L0 --> L1 --> L2 --> L3 --> S0
  S0 --> S1a
  S0 --> S1b
  S0 --> S2
  S2 --> S3
  S2 --> S4 --> E0 --> E2
  S0 -- "저장된 id 재방문" --> R0 -- "에디터에서 수정하기" --> E0
  L0 --> R1 --> E0
  E0 -- "미완성 id" --> E1
  S0 -- "generating·미저장 cuts" --> W0
  E0 -- "미저장 수정" --> W0
  S0 -. "미확인" .-> W1
  E0 -. "미확인" .-> W1
```

## 2. 프로세스 흐름 — 소유자별 레인

레인 기준: `docs/operations.md` 폴더 구조와 소유권 표.

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
