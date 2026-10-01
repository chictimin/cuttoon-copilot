// subject-tags.ts 회귀 반례(PR #215 리뷰)를 저장소에 고정하는 스크립트.
// 테스트 러너를 추가하지 않는다 — storyboard-guard.demo.ts와 같은 컨벤션.
// K9(추론)는 fetch 가로채기가 필요해 범위 밖이다. 여기는 순수 함수 K8만 다룬다.
//
// 실행: npx tsx lib/llm/subject-tags.demo.ts

import {
  normalizeTagText,
  projectForModel,
  restoreFirstMention,
  type SubjectTag,
} from "./subject-tags";

let failed = 0;

function eq(name: string, actual: string, expected: string) {
  if (actual === expected) {
    console.log(`ok   ${name}`);
  } else {
    failed++;
    console.error(`FAIL ${name} — 기대 ${JSON.stringify(expected)}, 실제 ${JSON.stringify(actual)}`);
  }
}

/**
 * 누출 대조. 출력에 소재의 모든 괄호 안 원문([A:B]는 A, 파싱 상한과 무관하게
 * 전부)이 대소문자·공백 무시 기준으로 남아 있으면 실패다. 괄호 기호나
 * ":카테고리" 잔여가 있어도 실패다.
 */
function assertNoLeak(name: string, output: string, subject: string, categories: string[]) {
  const raws: string[] = [];
  for (const match of subject.matchAll(/\[([^\[\]\n]+)\]/g)) {
    const inner = match[1].trim();
    if (!inner) continue;
    const colon = inner.indexOf(":");
    const raw = (colon < 0 ? inner : inner.slice(0, colon)).trim();
    if (raw.length >= 2) raws.push(raw);
  }
  const normOut = normalizeTagText(output);
  const leaked = raws.filter((raw) => normOut.includes(normalizeTagText(raw)));
  const leftoverBracket = /[\[\]]/.test(output);
  const leftoverCategory = categories.some((c) => output.includes(`:${c}`));
  if (leaked.length === 0 && !leftoverBracket && !leftoverCategory) {
    console.log(`ok   ${name}`);
  } else {
    failed++;
    console.error(
      `FAIL ${name} — 잔존 원문 [${leaked.join(", ")}] 괄호잔여 ${leftoverBracket} 카테고리잔여 ${leftoverCategory}`
    );
  }
}

// 1. [A:B] span 전체 투영 — ":category"가 남으면 안 된다.
{
  const subject = "[리브라이블리 앱:운동 앱] 안내";
  const tags: SubjectTag[] = [{ raw: "리브라이블리 앱", category: "운동 앱" }];
  const out = projectForModel("이야기 [리브라이블리 앱:운동 앱]", subject, tags);
  eq("[A:B] span 투영", out, "이야기 운동 앱");
  assertNoLeak("[A:B] 누출 대조", out, subject, ["운동 앱"]);
}

// 2. 4번째 이후 태그도 "제품"으로 투영 (2자 이상 이름).
{
  const subject = "[가나][다라][마바][사아]";
  const tags: SubjectTag[] = [
    { raw: "가나", category: "음료" },
    { raw: "다라", category: "과자" },
    { raw: "마바", category: "책" },
  ];
  const out = projectForModel(`${subject} 모두`, subject, tags);
  eq("4번째 태그도 제품", out, "음료과자책제품 모두");
  assertNoLeak("4번째 태그 누출 대조", out, subject, ["음료", "과자", "책"]);

  const bare = projectForModel("사아가 좋다", subject, tags);
  eq("맨몸 4번째도 제품", bare, "제품가 좋다");
  assertNoLeak("맨몸 4번째 누출 대조", bare, subject, ["음료", "과자", "책"]);
}

// 3. 누출 대조 변형 — 30자 초과 원문, 대소문자·공백 변형, category가 원문을 포함한 경우.
{
  const long = "X".repeat(35);
  const out = projectForModel(long, `[${long}] 설명`, [{ raw: long.slice(0, 30), category: "음료" }]);
  eq("30자 초과 원문 매칭", out, "음료");
  assertNoLeak("30자 초과 누출 대조", out, `[${long}] 설명`, ["음료"]);
}
{
  const out = projectForModel("new balance와 나 이 키", "[New Balance] [나이키]", [
    { raw: "New Balance", category: "운동화" },
    { raw: "나이키", category: "신발" },
  ]);
  eq("대소문자·공백 변형 매칭", out, "운동화와 신발");
  assertNoLeak("변형 누출 대조", out, "[New Balance] [나이키]", ["운동화", "신발"]);
}
{
  const out = projectForModel("[리브라이블리]", "[리브라이블리]", [
    { raw: "리브라이블리", category: "**리브라이블리**" },
  ]);
  eq("원문 포함 category → 제품", out, "제품");
  assertNoLeak("원문 포함 누출 대조", out, "[리브라이블리]", ["제품"]);
}

// 4. restoreFirstMention — subjectTags 없음·개수 불일치면 불변.
{
  const captions = [{ cut_index: 3, text: "음료 등장" }];
  const noTags = restoreFirstMention(captions, "[가나] 설명", undefined);
  if (noTags === captions) {
    console.log("ok   restore 태그 없음 → 불변");
  } else {
    failed++;
    console.error("FAIL restore 태그 없음 → 바뀌었음");
  }
  const mismatch = restoreFirstMention(captions, "[가나]와 [다라]", [{ raw: "가나", category: "음료" }]);
  if (mismatch === captions && captions[0].text === "음료 등장") {
    console.log("ok   restore 개수 불일치 → 불변");
  } else {
    failed++;
    console.error("FAIL restore 개수 불일치 → 바뀌었음");
  }
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log("\n전부 통과");
