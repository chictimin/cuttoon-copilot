# 사용자·프로세스 흐름

- 기준 커밋: `f60d4b2` (main, 태그 `v2.0-rc1`)
- 작성일: 2026-10-08 · 최종 갱신: 2026-10-13
- 원칙: 코드(기준 커밋)를 직접 따라 그린다 — 문서 문구를 옮기지 않는다. 확인 못한 연결은 점선 + "미확인"으로 표시한다.
- 함수 단위 상세 흐름은 `docs/pipeline.md` 1~4절을 본다.
- 실선 = 코드에서 확인한 연결, 점선 = 미확인·진행중.
- 화면 문구는 "첫 번째 컷"을 쓴다 — 이전 "표지 3안" 단계는 없어졌다.

## 1. 사용자 흐름 — 첫 진입부터 Export까지

```mermaid
flowchart TD
  F1["목록 보기"]
  F2["새 프로젝트 만들기"]
  F3["레퍼런스 올리기"]
  F4["상세 입력·마스코트 고르기"]
  F5["캐릭터 시트 만들기"]
  F6["소재 적기"]
   F7["최대 3턴 대화·말투·마무리·구도 고르기 (소재 파악분 생략)"]
  F7a["콘티 확인"]
  F7b["대사 확인·다듬기"]
  F8["첫 번째 컷 정하기"]
  F9["2~4번째 컷 만들기"]
  F10["저장하기"]
  F11["대사 고치기·말풍선 옮기기"]
  F12["ZIP으로 내보내기"]
  B1["첫 번째 컷 다시 만들기·실패하면 다시 시도"]
  B2["컷 실패하면 이어서 만들기"]
  B3["저장 실패하면 복구 안내"]
  B4["저장된 세션 다시 열기"]
  B5["미완성이면 목록으로"]
  B6["생성 중·미저장이면 새로고침·탭 닫기 전 경고"]
  B7["뒤로가기 미확인"]
  B8["2~4번째 컷 한 장씩 다시 그리기"]
  D1["데모 캐시(?demo=1): 첫 번째 컷 확정만·디테일 수정·다시 그리기 숨김"]

  F1 --> F2 --> F3 --> F4 --> F5 --> F6 --> F7 --> F7a --> F7b --> F8 --> F9 --> F10 --> F11 --> F12
  F7a -- "항목 눌러 앞 턴으로·골라서 복귀" --> F7
  F8 --> B1
  F9 --> B2
  F9 --> B8
  F10 --> B3
  F10 -- "저장된 id 재방문" --> B4 --> F11
  F11 -- "미완성 id" --> B5
  F5 -- "시트 생성·프로젝트 저장 중" --> B6
  F8 -- "첫 번째 컷 생성 중·선택 전(실패 시 해제)" --> B6
  F9 -- "generating·미저장" --> B6
  F11 -- "미저장 수정" --> B6
   F7b -- "데모 캐시면 디테일 수정만 숨김" --> D1
  F9 -- "데모 캐시면 확정만·다시 그리기 없음" --> D1
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
  Note over U,T: ① 조립·콘티 (이 화면까지 대사 생성 호출 0회)
  U->>A: 소재 보내기
  A->>T: 최대 3턴 대화 만들기 (소재 파악분 제외)
  T-->>U: 선택지 보여주기
  U->>U: 답하기 최대 3 (소재에서 파악된 턴은 생략) · 말투·마무리 강도·구도 변화 고르기
  U->>U: 조립 (서버 호출 없음·컷1 상반신·눈높이 고정)
  U->>U: 콘티 확인
  alt 항목 눌러 되돌아가기
    U->>U: 앞 턴으로 돌아가 한 항목만 고르기
    U->>U: 재조립 후 콘티 확인으로 복귀
  end
  U->>U: 이대로 만들기
  end

  rect rgb(235, 250, 235)
  Note over U,T: ② 대사 (마무리 강도 none·soft·clear 반영)
  Note over A,T: 강도 none이면 마무리 비트 없음·soft·clear면 4번 컷 마무리(어긋나면 400)
  U->>A: 대사 요청 (강도·구도 변화 포함)
  A->>T: 4컷 대사·연출 만들기
  T-->>U: 대사 보여주기
  U->>U: 직접 고치기·컷별 다시 뽑기
  opt 디테일 수정 켜면 (일반 모드만·첫 번째 컷 고정)
    U->>U: 컷별 구도·앵글 고르기
  end
  end

  rect rgb(240, 245, 255)
  Note over U,G: ③ 첫 번째 컷 (확정 뒤 잠금·일반/캐시 배타)
  alt 일반 경로
    U->>A: 첫 번째 컷 1장 요청
    A->>G: 첫 번째 컷 그리기 (상반신·눈높이 고정)
    U->>U: 후보 넘겨 보기
    opt 마음에 안 들면 (일반 모드만)
      U->>A: 다시 만들기 (시간대·자유 입력)
      A->>G: 첫 번째 컷 다시 그리기
    end
    U->>U: 이 그림으로 정하고 진행
  else 캐시 모드 (생성 호출 없음)
    U->>U: manifest cover_pick 1장 확정만 (다시 만들기 없음)
  end
  end

  rect rgb(245, 240, 255)
  Note over U,G: ④ 2~4번째 컷 (확정한 첫 번째 컷 참조·일반/캐시 배타)
  alt 일반 경로
    loop 컷마다 순서대로 (이미 만든 컷 건너뜀)
      U->>A: 그 컷 1장 요청 (컷1 참조)
      A->>G: 그 컷 그리기 (앞 컷 이어받기)
    end
    alt 컷 실패
      U->>U: 이어서 만들기 (다음 컷부터)
    end
    opt 한 컷 다시 그리기 (일반 모드·컷1 제외)
      U->>A: 그 컷 한 장 요청 (컷1 참조·자유 입력)
      A->>G: 그 컷 다시 그리기
    end
  else 캐시 모드 (생성 호출 없음)
    U->>U: manifest 컷 2~4 확정 (생성 호출 없음)
  end
  end

  rect rgb(240, 255, 240)
  Note over U,D: ⑤ 저장
  U->>A: 세션 저장
  A->>V: 스토리보드 계약 검사
  alt 계약 실패
    V-->>U: 400 · 고치기 안내
  else 통과
    V->>D: 세션 저장
    alt 캐시 모드 (선택 기록 키 없음)
      Note over V,D: 선택 기록 저장·실패 안내 생략
      D-->>U: 200 · 저장됨
    else 일반 경로
      V->>D: 선택 기록 저장(키 있음·유효 라운드만·없으면 키 생략)
      alt 유효 라운드 0개·저장 실패
        D-->>U: 200 · 저장됨 + 선택 기록 실패 안내(막지 않음)
      else 성공
        D-->>U: 200 · 저장됨
      end
    end
  end
  end

  rect rgb(255, 248, 240)
  Note over U,D: ⑥ 에디터 저장
  U->>A: 버전 저장
  A->>D: 버전 저장하기
  end

  rect rgb(255, 240, 245)
  Note over U,E: ⑦ Export
  U->>A: ZIP 요청
  A->>D: 세션·폰트 읽기
  alt 데모 캐시면
    E->>E: public/demo-cache 파일 읽기(manifest 허용 목록)
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
     U_SESS["SessionFlow (소재→최대 3턴(파악분 생략)→말투·마무리·구도→콘티→대사→첫 번째 컷→2~4컷) + generate-client.ts"]
    U_ED["EditorFlow + resolveImages"]
  end
  subgraph SRV["서버·DB·스키마 — chictimin"]
    A_SEMB["storyboard-assembly.ts assembleStoryboard (소유 예외: chictimin)"]
    S_UP["POST /api/upload → lib/asset-store.ts uploadAsset"]
    S_BRAIN["POST /api/brainstorm/route.ts → lib/llm/brainstorm.ts"]
    S_CAP["POST /api/session/captions/route.ts (대사·연출: 강도·구도 변화·컷별 다시 뽑기)"]
    S_PRE["POST /api/preset/route.ts → assertValidPreset + dedupePresetArrays (#263)"]
    S_SESS["POST /api/session/route.ts → validate.ts 저장 검사 (#280·#295) + selections 검증"]
    S_VER["POST /api/session/version + /revert"]
    S_EXP["GET /api/session/export/route.ts → toRenderCuts + getPreset 폰트"]
    S_DB["lib/db/sessions.ts + selections.ts + presets.ts (Supabase)"]
    S_STORE["Storage 버킷 미확인"]
  end
  subgraph GEN["생성·추출 — joniverse-ai (app/api/extract/ + app/api/generate/ + lib/openai/)"]
    S_EX["POST /api/extract (asset-store에서 읽기)"]
    S_GENR["POST /api/generate (라우트: kind 분기 — cover_variants count 1은 첫 번째 컷 · cut은 참조·이어받기)"]
    G_EXT["extract.ts: extractStyle + generateCharacterSheet"]
    G_GEN["generate.ts: generateCut + generateCoverVariants(첫 번째 컷 1장)"]
  end
  subgraph RND["렌더·Export — smartman3514-commits (lib/render/)"]
    R_EXP["export.ts: exportCuts"]
    R_COMP["compose.ts composeCut: anchor 읽기 + 화자 꼬리 (#242)"]
    R_ZIP["zip.ts: buildZip → ZIP 응답"]
  end
  C0["데모 캐시 #307 (?demo=1): manifest cover_pick 1장이 컷 1 · 선택 기록 없음"]

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
  U_SESS -- "?demo=1" --> C0
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
