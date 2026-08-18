# 컷툰 제작 AI 코파일럿

리브라이블리 기업 연계 프로젝트. 4컷 컷툰 생성 코파일럿.

## 스택

| 영역 | 선택 |
| --- | --- |
| 앱 | Next.js (App Router) |
| 언어 | TypeScript |
| 이미지 | Gemini (나노바나나) |
| 텍스트 | OpenAI |
| DB·스토리지 | Supabase |

## 폴더 소유권

| 폴더 | 담당 |
| --- | --- |
| `app/(studio)/` | A② |
| `app/api/preset/`, `app/api/session/` | A③ |
| `lib/llm/`, `spec/` | A① |
| `app/api/generate/`, `lib/gemini/generate.ts` | B① |
| `lib/gemini/extract.ts` | B② |
| `lib/render/` | B③ |

## 브랜치

1인 1브랜치: `feat/a1` `feat/a2` `feat/a3` `feat/b1` `feat/b2` `feat/b3`

## git 규칙

1. main 직접 push 금지, PR로만
2. 빌드 확인 후 머지, 조금씩 자주
3. 되감기(rebase·force-push)는 본인 브랜치만, main은 그대로
4. DB 구조 변경은 A③만
5. `.env`와 API 키 올리지 않기
6. 발표 전날 태그 하나 찍고 멈추기, 이후 수정 시 태그 새로

## 로컬 실행

```
npm install
npm run dev
```
