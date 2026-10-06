// subject-tags.ts 회귀 반례(PR #215 리뷰)를 저장소에 고정하는 스크립트.
// 테스트 러너를 추가하지 않는다 — storyboard-guard.demo.ts와 같은 컨벤션.
// K9(추론)는 fetch 가로채기가 필요해 범위 밖이다. 여기는 순수 함수 K8만 다룬다.
//
// 실행: npx tsx lib/llm/subject-tags.demo.ts

import {
  applyBrandMarkers,
  batchimKindOf,
  normalizeStoredSubjectTags,
  normalizeTagText,
  projectForModel,
  restoreFirstMention,
  type SubjectTag,
} from "./subject-tags";
import { subjectTagInstruction } from "./captions";

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

// 5. normalizeStoredSubjectTags — 현재 소재와 저장본 대조(spec-a3 T1).
{
  function eqNorm(name: string, actual: unknown, expected: unknown) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
      console.log(`ok   ${name}`);
    } else {
      failed++;
      console.error(`FAIL ${name} — 기대 ${e}, 실제 ${a}`);
    }
  }
  const f = normalizeStoredSubjectTags;
  eqNorm("태그 없음+undefined", f(undefined, "그냥 이야기"), { tags: [], dropped: null });
  eqNorm("태그 없음+빈 배열", f([], "그냥 이야기"), { tags: [], dropped: null });
  eqNorm(
    "2태그 순서 일치 유지",
    f(
      [
        { raw: "가나", category: " 음료 " },
        { raw: "다라", category: "과자" },
      ],
      "[가나][다라] 이야기"
    ),
    { tags: [{ raw: "가나", category: "음료" }, { raw: "다라", category: "과자" }], dropped: null }
  );
  eqNorm(
    "category 없음·공백 → 제품",
    f([{ raw: "가나" }, { raw: "다라", category: "   " }], "[가나][다라] x"),
    { tags: [{ raw: "가나", category: "제품" }, { raw: "다라", category: "제품" }], dropped: null }
  );
  eqNorm(
    "category가 raw 포함 → 제품",
    f([{ raw: "별빛핏", category: "별빛핏 앱" }], "[별빛핏]으로 운동 시작"),
    { tags: [{ raw: "별빛핏", category: "제품" }], dropped: null }
  );
  eqNorm("비배열 → not_array", f("x", "[가나] y"), { tags: [], dropped: "not_array" });
  const one = { raw: "가나", category: "음료" };
  eqNorm("4개 → count_mismatch", f([one, one, one, one], "[가나] y"), {
    tags: [],
    dropped: "count_mismatch",
  });
  eqNorm(
    "순서 뒤바뀜 → raw_mismatch",
    f(
      [
        { raw: "다라", category: "과자" },
        { raw: "가나", category: "음료" },
      ],
      "[가나][다라] z"
    ),
    { tags: [], dropped: "raw_mismatch" }
  );
}

// 6. spec-c1 rev2 5절 결정표 1~12 (3번 컷 기준) + 6-1 무료 케이스.
{
  const S1 = "[별빛핏] 신메뉴";
  const T1: SubjectTag[] = [{ raw: "별빛핏", category: "커피 브랜드" }];
  const c3 = (t: string) => [{ cut_index: 3, text: t }];
  const o3 = (t: string, s: string, tt: SubjectTag[] | undefined) =>
    applyBrandMarkers(c3(t), s, tt)[0].text;

  // 표식 0개: 대입 없음(apply는 category를 건드리지 않음).
  eq("C1-0개", o3("커피 브랜드 최고", S1, T1), "커피 브랜드 최고");
  // 표식 1개.
  eq("C1-1개", o3("맛은 [브랜드1] 최고", S1, T1), "맛은 별빛핏 최고");
  // 표식 2개(같은 순번 반복): 첫 1곳만.
  eq("C1-2개-반복", o3("[브랜드1]와 [브랜드1] 최고", S1, T1), "별빛핏와 [브랜드1] 최고");
  // 표식 3개(같은 순번 3회): 첫 1곳만.
  eq("C1-3개-반복", o3("[브랜드1][브랜드1][브랜드1]", S1, T1), "별빛핏[브랜드1][브랜드1]");

  // 5-1: 3번에 [브랜드1] 1회.
  eq("C1-5.1", o3("[브랜드1] 최고", S1, T1), "별빛핏 최고");
  // 5-2: 3번에 [브랜드1] 2회.
  eq("C1-5.2", o3("[브랜드1]와 [브랜드1] 최고", S1, T1), "별빛핏와 [브랜드1] 최고");
  // 5-3: 1번과 3번에 [브랜드1].
  {
    const both = applyBrandMarkers(
      [
        { cut_index: 1, text: "1번 [브랜드1]" },
        { cut_index: 3, text: "3번 [브랜드1]" },
      ],
      S1,
      T1
    );
    eq("C1-5.3-1번유지", both[0].text, "1번 [브랜드1]");
    eq("C1-5.3-3번대입", both[1].text, "3번 별빛핏");
  }
  // 5-4: 1번에만 [브랜드1] (3번 대입 없음).
  eq(
    "C1-5.4",
    applyBrandMarkers([{ cut_index: 1, text: "1번 [브랜드1]" }], S1, T1)[0].text,
    "1번 [브랜드1]"
  );
  // 5-5: 3번 재생성 표식 → 대입(3번 경로).
  eq("C1-5.5", o3("[브랜드1] 최고", S1, T1), "별빛핏 최고");
  // 5-6: 1번 재생성 표식 → 대입 없음.
  eq(
    "C1-5.6",
    applyBrandMarkers([{ cut_index: 1, text: "[브랜드1] 최고" }], S1, T1)[0].text,
    "[브랜드1] 최고"
  );
  // 5-7: 3번에 [브랜드1]+[브랜드7](태그 1개).
  eq("C1-5.7", o3("[브랜드1]와 [브랜드7] 최고", S1, T1), "별빛핏와 [브랜드7] 최고");
  // 5-8: 3번에 표식 없이 category만 → apply는 그대로(폴백은 호출부).
  eq("C1-5.8-apply유지", o3("커피 브랜드 최고", S1, T1), "커피 브랜드 최고");
  eq(
    "C1-5.8-폴백",
    restoreFirstMention(c3("커피 브랜드 최고"), S1, T1)[0].text,
    "별빛핏 최고"
  );
  // 5-9: 태그 2개, 3번에 [브랜드1]만.
  {
    const S2 = "[별빛핏][달빛핏] 비교";
    const T2: SubjectTag[] = [
      { raw: "별빛핏", category: "음료" },
      { raw: "달빛핏", category: "과자" },
    ];
    eq("C1-5.9", o3("[브랜드1] 최고", S2, T2), "별빛핏 최고");
  }
  // 5-10: 태그 2개, 3번에 [브랜드1]+태그2 category → category 그대로.
  {
    const S2 = "[별빛핏][달빛핏] 비교";
    const T2: SubjectTag[] = [
      { raw: "별빛핏", category: "음료" },
      { raw: "달빛핏", category: "과자" },
    ];
    eq("C1-5.10", o3("[브랜드1] 과자 최고", S2, T2), "별빛핏 과자 최고");
  }
  // 5-11: [ 브랜드 1 ] 공백 변형.
  eq("C1-5.11-공백", o3("맛은 [ 브랜드 1 ] 최고", S1, T1), "맛은 별빛핏 최고");
  eq("C1-5.11-탭", o3("맛은 [\t브랜드\t1\t] 최고", S1, T1), "맛은 별빛핏 최고");
  // 5-12: 전각·괄호·영문·두 자리 변형은 그대로.
  eq("C1-5.12-전각숫자", o3("맛은 [브랜드１] 최고", S1, T1), "맛은 [브랜드１] 최고");
  eq("C1-5.12-전각괄호", o3("맛은 【브랜드1】 최고", S1, T1), "맛은 【브랜드1】 최고");
  eq("C1-5.12-영문", o3("맛은 [Brand1] 최고", S1, T1), "맛은 [Brand1] 최고");
  eq("C1-5.12-두자리", o3("맛은 [브랜드10] 최고", S1, T1), "맛은 [브랜드10] 최고");
  // 5-13: 지어낸 이름은 그대로(감지 불가).
  eq("C1-5.13", o3("카페X 최고", S1, T1), "카페X 최고");

  // 같은 category 두 태그: 순번 지시 둘 다 존재.
  {
    const S3 = "[별빛핏][달빛핏] 출시";
    const T3: SubjectTag[] = [
      { raw: "별빛핏", category: "커피 브랜드" },
      { raw: "달빛핏", category: "커피 브랜드" },
    ];
    eq("C1-같은카테고리-대입", o3("[브랜드1]와 [브랜드2] 최고", S3, T3), "별빛핏와 달빛핏 최고");
    const inst = subjectTagInstruction(S3, T3);
    eq(
      "C1-같은카테고리-지시둘다",
      String(inst.includes("[브랜드1]") && inst.includes("[브랜드2]")),
      "true"
    );
  }

  // 순번 충돌 raw: 소재 [별빛핏]과 [브랜드1] 비교.
  {
    const SC = "[별빛핏]과 [브랜드1] 비교";
    const TC: SubjectTag[] = [
      { raw: "별빛핏", category: "커피 브랜드" },
      { raw: "브랜드1", category: "음료" },
    ];
    eq("C1-순번충돌", o3("[브랜드1]와 [브랜드2]", SC, TC), "별빛핏와 브랜드1");
  }

  // raw에 브랜드2 포함: 재치환 없음.
  {
    const S4 = "[AB브랜드2CD] 출시";
    const T4: SubjectTag[] = [{ raw: "AB브랜드2CD", category: "커피 브랜드" }];
    eq("C1-재치환없음", o3("[브랜드1] 최고", S4, T4), "AB브랜드2CD 최고");
  }

  // 태그 누락·개수 불일치·빈 category.
  eq("C1-태그없음", o3("[브랜드1] 최고", S1, undefined), "[브랜드1] 최고");
  eq(
    "C1-개수불일치",
    o3("[브랜드1] 최고", "[가나]와 [다라]", [{ raw: "가나", category: "음료" }]),
    "[브랜드1] 최고"
  );
  eq("C1-빈category", o3("[브랜드1] 최고", "[별빛핏] 출시", [{ raw: "별빛핏" }]), "[브랜드1] 최고");
  {
    const SM = "[별빛핏][달빛핏] 출시";
    const TM: SubjectTag[] = [{ raw: "별빛핏" }, { raw: "달빛핏", category: "과자" }];
    eq("C1-혼합빈category", o3("[브랜드1]와 [브랜드2] 최고", SM, TM), "[브랜드1]와 달빛핏 최고");
  }

  // 편집·저장 문자열 불변: 복원済み 텍스트에 apply 재실행해도 그대로.
  eq("C1-재실행불변", o3("별빛핏 최고", S1, T1), "별빛핏 최고");
  eq("C1-적용후재적용", o3(o3("[브랜드1] 최고", S1, T1), S1, T1), "별빛핏 최고");

  // 이미지 프롬프트에 표식 지시 없음: 투영 출력에 표식이 생기지 않음.
  {
    const out = projectForModel("[별빛핏] 신메뉴 라떼 출시", S1, T1);
    eq("C1-이미지표식없음", String(!out.includes("[브랜드")), "true");
  }

  // 받침 판정: 있음·없음·ㄹ 종성·비한글.
  eq("C1-받침있음", batchimKindOf("별빛핏"), "yes");
  eq("C1-받침없음", batchimKindOf("하루노트"), "no");
  eq("C1-ㄹ종성", batchimKindOf("서울"), "yes");
  eq("C1-비한글", batchimKindOf("Cafe24"), "non-hangul");

  // 지시 문구: 순번별 줄·조사 줄.
  {
    const i1 = subjectTagInstruction(S1, T1);
    eq("C1-지시-표식", String(i1.includes("[브랜드1]")), "true");
    eq("C1-지시-글자그대로", String(i1.includes("글자 그대로")), "true");
    eq("C1-지시-받침있음", String(i1.includes("받침 있는")), "true");
    const iN = subjectTagInstruction("[하루노트] 기록", [{ raw: "하루노트", category: "메모 앱" }]);
    eq("C1-지시-받침없음", String(iN.includes("받침 없는")), "true");
    const iE = subjectTagInstruction("[Cafe24] 안내", [{ raw: "Cafe24", category: "쇼핑몰" }]);
    eq("C1-지시-비한글", String(iE.includes("조사를 붙이지 않는")), "true");
    eq("C1-지시-태그없음", subjectTagInstruction("그냥 이야기", []), "");
  }
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log("\n전부 통과");
