# 팀 운영

<!-- 기준점 id는 변경 금지 -->

## 문서

| 문서 | 담는 것 | 변경 권한 |
| --- | --- | --- |
| [`PRD.md`](../PRD.md) | 제품 요구사항 · 제약 · 제외 기능 · 아키텍처 결정 | chictimin 승인 (5-1절 의존성 목록은 예외 — 승인 불필요) |
| [`README.md`](../README.md) | 도구 소개 · 실행법 | chictimin 승인 |
| `docs/operations.md` (이 문서) | 팀 운영 · 일정 · 소유권 · 현황 · 작업 표 | chictimin 승인 |
| `spec/*.schema.json` | 데이터 계약(필드·enum) | chictimin 승인 |
| [`pipeline.md`](./pipeline.md) | 온보딩→세션→에디터 호출 순서 · 소유 경계 · 파이프라인 사실 정리 | chictimin 승인 |
| [`gate-evidence/`](./gate-evidence/) | P0 게이트(캐릭터 동일성 · 말풍선 억제) 판정 근거 이미지 | chictimin 승인 |
| `spec/data/*.json`(`cta_presets.json`·`narrative-flow.json`·`style-vocabulary.json`) | 값 목록 데이터 파일(CTA 문구 · 서사 흐름 템플릿 · 스타일 키워드 매핑) | chictimin 승인 |
| `spec/vocabulary.json` | enum별 프롬프트 힌트(영문 서술) | chictimin 승인 |

**구현 전에 `PRD.md`를 확인한다.** 개인 로컬 문서(각자의 PRD 초안·노트)는 정본이 아니다.

<a id="ops-team"></a>
## 2차 일정 · 팀

09-30(수) 시작 → 10-14(수) 기능 동결 → 10-15(목) 마감 → 10-16(금) 발표. 10-09(한글날) 휴일, 작업일 11일.

| 팀원 | 맡는 곳 |
| --- | --- |
| chictimin | 스키마 · 데이터 계약 · LLM · 백엔드 (`spec/` 변경 승인권자) |
| JEON-DAEJIN | 화면 전체 |
| joniverse-ai | 이미지 생성 · 추출 · 캐릭터 시트 |
| smartman3514-commits | 렌더링 버그 수정 + QA 검증(모든 기능·버그 PR의 머지 전 동작 확인) |

## 폴더 구조와 소유권

```
cuttoon-copilot/
├─ app/
│  ├─ (studio)/                화면 전체                      JEON-DAEJIN
│  │   ├─ page.tsx             프로젝트 목록
│  │   ├─ onboarding/          온보딩 + 프리셋 생성
│  │   ├─ session/[id]/        소재 입력 → 3턴·말투·대사 → 표지 3안 → 4컷 완성
│  │   ├─ editor/[id]/         대사 수정 · 드래그 · 되돌리기
│  │   └─ projects/            세션 목록
│  └─ api/
│      ├─ preset/              프리셋 CRUD                    chictimin
│      │   ├─ font/              폰트 확인 API                  chictimin
│      │   └─ mascot-suggestion/ 마스코트 제안                  chictimin
│      ├─ session/             세션 관리 · Export · 대사 생성  chictimin
│      ├─ upload/              레퍼런스 업로드                chictimin
│      ├─ brainstorm/          브레인스토밍 3턴                chictimin
│      ├─ generate/            이미지 생성                    joniverse-ai
│      └─ extract/             스타일 추출                    joniverse-ai
├─ lib/
│  ├─ asset-store.ts           업로드 검증 · Storage 저장      chictimin
│  ├─ llm/                     브레인스토밍 3턴 · 캡션         chictimin
│  │   ├─ caption-tones.ts       컷 대사 톤 목록                chictimin
│  │   └─ font-probe.ts          폰트 URL 확인                  chictimin
│  ├─ session/                  표지 선택 기록                 chictimin
│  │   └─ selection-log.ts       라운드 기록 헬퍼 (#207)        chictimin
│  ├─ openai/
│  │   ├─ generate.ts          컷 생성 (멀티턴 세션 관리)      joniverse-ai
│  │   ├─ extract.ts           레퍼런스 VLM 추출 · 시트 생성   joniverse-ai
│  │   ├─ image-setting.ts     이미지 설정 선택 (#196)         joniverse-ai
│  │   ├─ comfyui.ts           로컬 ComfyUI (#226)             joniverse-ai
│  │   ├─ prompt.demo.ts       프롬프트 검사 demo              joniverse-ai
│  │   └─ provider.ts          ImageProvider 인터페이스        joniverse-ai
│  ├─ render/                  텍스트 레이어 합성 · ZIP        smartman3514-commits
│  │   ├─ font.ts                프로젝트 폰트 읽기             smartman3514-commits
│  │   └─ position-box.ts        말풍선 칸별 자리 비율 (#279)   smartman3514-commits
│  └─ db/                      Supabase 클라이언트 · 쿼리      chictimin
├─ spec/                       계약 (변경은 chictimin 승인)    chictimin
│  ├─ preset.schema.json
│  ├─ storyboard.schema.json
│  ├─ vocabulary.json          계약 ⑤ 어휘 사전
│  ├─ data/                    값 목록 데이터
│  └─ samples/                 샘플 응답 JSON + 이미지
└─ public/
   └─ demo-cache/              발표용 캐시 폴백 (예정 — 아직 없음)
```

| 담당 | 폴더 · 파일 | 역할 |
| --- | --- | --- |
| chictimin | `spec/`, `lib/llm/`, `app/(studio)/session/[id]/storyboard-assembly.ts`(컷 대사·연출 상수, #152), `app/api/brainstorm/`, `app/api/preset/`, `app/api/session/`, `app/api/upload/`, `lib/db/`, `lib/asset-store.ts` | 스키마 · 데이터 계약 · LLM · 백엔드. 데이터 계약(`spec/`) 변경 승인권자 |
| JEON-DAEJIN | `app/(studio)/` (단 `session/[id]/storyboard-assembly.ts`는 제외) | 화면 전체 |
| joniverse-ai | `lib/openai/`, `app/api/generate/`, `app/api/extract/` | 이미지 생성 · 추출 · 캐릭터 시트 |
| smartman3514-commits | `lib/render/` | 렌더링 버그 수정(#105, #169, #170) + QA 검증 |
| (지정 없음) | `scripts/`(`p0-storyboard-scan`·`demo-cache-build`·`two-person-check`) | 작업용 스크립트 |

1차에는 A①~B③ 6파트 체제였다. `pipeline.md`는 각자 자기 영역 절을 고친다. `public/demo-cache/`는 아직 만들어지지 않았고 담당은 joniverse-ai(10-10 생성 예정)이다.

<a id="ops-git"></a>
## 브랜치 · git 규칙

1. main 직접 push 금지, PR로만
2. `npm run build` 확인 후 머지, 조금씩 자주
3. 되감기(rebase·force-push)는 본인 브랜치만, main은 그대로
4. DB 구조 변경(`lib/db/`)은 chictimin 승인
5. `.env`는 커밋하지 않는다(저장소 추적 제외)
6. 마감(10-15) 전에 태그 하나 찍고 멈추기, 이후 수정 시 태그 새로
7. 스텁 3규칙(#60): ① 스텁 표식 유지(`stub:true`, `asset://stub/` · `asset://mock/`) ② 실패 가시화(조용히 성공처럼 보이지 않게) ③ PR 본문에 스텁 명시

### 개발용 명령

```
npm install
npm run dev              # 개발 서버
npm run build            # 머지 전 빌드 확인
npm start                # 프로덕션 실행
npm run lint             # 린트
npm run spec:sync-check  # 어휘·힌트 동기화 — 저장값 검증 아님
npm run spec:docs        # 문서 생성 — 검사 아님
```

위 블록은 순서가 아니다 — 처음 실행 순서는 [README](../README.md#readme-first-run) 참고. `npm start`는 `build` 산출물이 있어야 동작한다(단독 실행 불가).

<a id="ops-status"></a>
## 구현 현황

골든패스 각 단계가 지금 어디까지 됐는지. **main에 머지된 것만** 센다 — 열려 있는 PR이나 작업 브랜치 코드만으로 완료 처리하지 않는다.

상태: 완료(쓸 수 있음) / 부분(일부만 동작, 비고·관련 이슈 참고) / 미완. 이슈·PR 번호는 `https://github.com/chictimin/cuttoon-copilot` 저장소에서 연다.

| 단계 | 로직 · API | 화면 | 상태 | 관련 이슈 |
| --- | --- | --- | --- | --- |
| 1. 레퍼런스 업로드 | `POST /api/upload` · `lib/asset-store.ts` (10MB · png/jpeg/webp, #68 확정) | 연결됨 | 완료 | #68 |
| 2. 스타일 추출 | `lib/openai/extract.ts` (실제 호출) | 연결됨 | 완료 | — |
| 3. 프리셋 자동 확정 | `lib/llm/preset-guard.ts` | 있음 | 완료 | #125(닫힘 — PR #233 · #234 · #243 머지) |
| 4. 프리셋 저장 | `GET·POST /api/preset` | 연결됨 | 완료 | — |
| 5. 캐릭터 시트 생성·표시 | `POST /api/generate` `kind: 'character_sheet'` (생성·저장까지) | 없음 | 부분 | — |
| 6. 프로젝트 목록 | `GET /api/preset` (id 없이) · 세션 목록 | 연결됨 | 완료 | #136 |
| 7. 소재 입력 | — | 있음 | 부분 | #206(서버 PR #231 · 이미지 PR #237 · 태그 검사 PR #244 · 화면 배선 PR #251 · 복원 표식 PR #256 머지, #247 닫힘 — #206 닫힘 10-08, 남은 것: 사람 QA 확인(#217·#240·#307로 이월)) |
| 8. 브레인스토밍 3턴 | `POST /api/brainstorm` · `lib/llm/brainstorm.ts` (업종 주입 · 질문 문구 단일화 PR #204) | 연결됨 | 완료 | #119(턴 건너뛰기 PR #154로 완료. 흐름 턴은 #157 종료 — 3종 유지) |
| 9. 표지컷 3안 | `kind: 'cover_variants'` | 연결됨 | 완료 | #102(닫힘) |
| 10. 4컷 생성 | `POST /api/generate` 체이닝 | 연결됨 | 완료 | #103(닫힘) · #104(`generateChainedCuts` 중간 실패 시 만든 컷 보존·이어서 만들기 — 2차 작업 10번) · #138(나머지 3컷 진행률 "n/3" — 2차 작업 5번) |
| 11. 대사 수정 · 드래그 | — | 있음 | 완료 | PR #302 (에디터 드래그 저장, 10-08 머지) |
| 12. v2 저장 · 되돌리기 | `/api/session`(선택 기록 `selections` 동봉 · #207) `/version` `/revert` · 재진입 복원 | 연결됨 | 완료 | #143 · #207(PR #210 · #213 머지) |
| 13. Export ZIP | `GET /api/session/export` | 연결됨 | 완료 | 프로젝트 폰트 반영(스키마 PR #241 · 합성·Export PR #236 · 확인 API PR #245 · 온보딩 입력 PR #250 · 에디터 PR #246 머지 — #209 닫힘 10-08, 남은 것: 사람 QA 확인(#217·#240·#307로 이월)) |

1차 추가 완료분: 화면 간 이동(#134), 프로젝트 이름 변경 · 비활성화(#161, `PATCH`/`DELETE /api/preset` — API만, 화면 없음), 흐름 템플릿 JSON 분리(PR #153).

2차 착수 전 머지: PR #163 — 말풍선 꼬리 길이를 목표점까지 거리 비율로 조정(`lib/render/compose.ts`).

이 표는 손으로 갱신합니다. 단계를 완료하는 PR을 올릴 때 함께 고쳐주세요.

<a id="ops-tasks"></a>
## 2차 작업 표

| # | 구분 | 항목 | 우선순위 | 기한 | 담당 | 관련 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 기능 | 소재에 맞는 컷 대사 · 연출 (**완료** — PR #204 머지) | 발표 필수 | 대사 10-06, 연출 10-08 | chictimin | #152 |
| 2 | 기능 | 조연 마스코트 고정 (**완료** — 서버 PR #212 · 시트·컷 PR #224 · 화면 PR #220 머지, #150 닫힘) | 품질 | 10-08 | joniverse-ai | #150 · 화면 계약 #200 |
| 3 | 기능 | 사용자 그림체 키워드 반영 (**완료** — PR #233 · #234 · #243 머지, #151 · #125 닫힘) | 품질 | 10-08 | JEON-DAEJIN | #151, #125 |
| 4 | 기능 | 건너뛰면 기본값 채우기 ("알아서 해줘") (**완료** — PR #191 머지, #181 닫힘) | 품질 | 10-08 | JEON-DAEJIN | #181 |
| 5 | 기능 | 나머지 3컷 생성 진행률 표시 (**완료** — PR #177 머지, #138 닫힘) | 품질 | 10-08 | JEON-DAEJIN | #138 |
| 6 | 기능 | 브레인스토밍 흐름 턴 LLM 선택 (**완료** — 3종 유지로 종료) | 품질 | 10-04 | chictimin | #157, #201 |
| 7 | 버그 | 숫자 소재가 이미지에 글자로 박힘 (수정 머지됨, 9/30 재실행 통과 — 근거 PR #165 머지됨) | 발표 필수 | 10-06 | joniverse-ai | #146 |
| 8 | 버그 | 긴 대사에서 말풍선 꼬리 미노출 (**해결** — main에서 재현 안 됨, 9/30 QA. 꼬리 길이 조정은 PR #163 머지) | 발표 필수 | 10-06 | smartman3514-commits | PR #163 |
| 9 | 버그 | 크롭이 말풍선 여백을 깎을 수 있음 (**완료** — PR #166 머지, #105 닫힘) | 품질 | 10-08 | smartman3514-commits | #105 |
| 10 | 버그 | 생성 결과 유실 방지 잔여분 (`generateChainedCuts`) (**완료** — PR #177 머지, #104 닫힘) | 품질 | 10-08 | JEON-DAEJIN | #104 |
| 11 | 버그 | **완료**(PR #192 머지) — 아주 긴 대사 말풍선이 그림 오른쪽 밖으로 잘림 (`top_right`) | 품질 | 10-08 | smartman3514-commits | #169 |
| 12 | 버그 | **완료**(PR #192 머지) — 아주 긴 대사 center 말풍선이 인물을 덮어 꼬리가 사라짐 | 품질 | 10-08 | smartman3514-commits | #170 |
| 13 | 버그 | center 말풍선 꼬리를 화자 방향으로 (PR #235 머지로 함수 완료, #199 닫음 — #242 반영: wide 컷 목표점 보정 완료(#273, full 제외) · 스키마·저장 검사 PR #295 · 에디터 드래그 PR #302 · Export 화자 연결 PR #299 · Export 좌표 PR #305 머지 — 잔여: 인물 순서 변경 저장 검사는 동결 후 · "2인 컷 좌우 프롬프트 10-09"와 #285 관계 미확인) | 품질 | 10-09 | smartman3514-commits · chictimin · joniverse-ai | #242 |
| 14 | 기능 | CTA를 세션 단위로 — 마무리 강도 3단계 + 이번 편 목적 (**완료** — 1단 PR #223 · 2단 온보딩 기본 강도 PR #229 머지. "이번 편에 알릴 내용"은 #206에서 이어서 검토) | 품질 | 미정 | chictimin · JEON-DAEJIN | #205 |
| 15 | 기능 | 소재 [브랜드·제품명] 표기 (서버 PR #231 · 이미지 투영 PR #237 · 태그 저장 검사 PR #244 · 화면 배선 PR #251 · 복원 표식 PR #256 머지, #247 닫힘 — #206 닫힘 10-08, 남은 것: 사람 QA 확인(#217·#240·#307로 이월)) | 품질 | 미정 | chictimin | #206 |
| 16 | 기능 | 표지 선택 기록 (**완료** — 서버 PR #210 · 화면 PR #213 머지, #207 · #216 닫힘) | 품질 | 미정 | chictimin · JEON-DAEJIN | #207 |
| 17 | 기능 | 미매핑 단어 안내 (**완료** — PR #255 · #257 머지: 한 줄 안내 + 확정 시 확인 팝업(다시 보지 않기)) | 품질 | 미정 | JEON-DAEJIN | #238 |
| 18 | 기능 | 데모 캐시 (발표용 고정 결과물 — #239 닫힘 10-08, 후속 #307 10-08~10-12: 캐시 생성 joniverse-ai · Export 읽기 smartman3514-commits · 화면 연결 JEON-DAEJIN) | 발표 필수 | 10-10 | joniverse-ai · smartman3514-commits · JEON-DAEJIN | #307 (구 #239) |
| 19 | 기능 | 골든 패스 2분 리허설 (P4, 10-13 사전 · 10-14 최종) | 발표 필수 | 10-13 사전 · 10-14 최종 | smartman3514-commits · joniverse-ai | #240 |
| 20 | 버그 | 브레인스토밍 선택지 0개 턴에서 "알아서 해줘" 숨김 — 타이핑 강제 (**완료** — PR #251 머지, #247 닫힘) | 발표 필수 | 10-13 | chictimin | #247 |
| 21 | 기능 | 프로젝트 폰트 에셋화 (스키마 PR #241 · 합성·Export PR #236 · 확인 API PR #245 · 온보딩 입력 PR #250 · 에디터 PR #246 머지 — #209 닫힘 10-08, 남은 것: 사람 QA 확인(#217·#240·#307로 이월)) | 품질 | 미정 | chictimin · smartman3514-commits · JEON-DAEJIN | #209 |
| 22 | 기타 | 2차 골든패스 점검 — 기능 누락·확인 필요 항목 묶음 (항목별 진행 여부 판단 중) | 품질 | 미정 | 4인 공동 | #249 |

3번 선행: chictimin의 그림체 키워드 선정 스크립트. 4번 선행 해소: 6번 완료(#157 종료), PRD 8절 기본값 확정(#181).

기능·버그 PR은 머지 전에 QA 담당(smartman3514-commits)이 골든패스로 동작을 확인하고 결과를 PR에 남기는 것을 권장한다. 확인이 늦어질 때는 머지 후 확인으로 대체할 수 있다. 문서·데이터 계약(`spec/`) 변경 승인은 chictimin이 한다.

<a id="ops-p0"></a>
## P0 판정 현황

판정 기준 근거 #133(종료), 기록 #113.

- 최종 판정(조건부 통과, #113): 게이트 1 4/5(09-30 케이스 기록), 게이트 2 위반 0컷(#146, 근거 이미지 PR #165 머지됨). 한계 3가지는 #113 기록과 함께 인용 — 케이스 4는 3컷 기준 인정, 케이스 5는 #148 이전 조건 실패 잔류, 케이스 2는 `8460d73`에서 실행
- 남은 것: 10-14 이후 최종 회귀·리허설(OpenAI 기본 설정)에서 발표 경로 확인
