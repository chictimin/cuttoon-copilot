// POST /api/generate 스모크 테스트. dev 서버를 띄운 뒤 실행한다.
//   npm run dev
//   node app/api/generate/_smoke-test.mjs
// 표준 라이브러리만 사용 — 테스트 러너를 추가하지 않는다.
//
// #18: generateCharacterSheet/generateCut/generateCoverVariants가 실제 모델을
// 호출하므로(스텁 아님), 기본 실행에서는 400 계열(무료) 케이스만 돈다. 실제
// 호출까지 확인하려면 RUN_REAL_GENERATION=1로 실행 — OpenAI 과금이 발생한다.
import assert from "node:assert/strict";

const URL_ = process.env.SMOKE_URL ?? "http://localhost:3000/api/generate";
const RUN_REAL = process.env.RUN_REAL_GENERATION === "1";

const json = (body) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body,
});

// [설명, fetch 옵션, 기대 status, 응답 검사, 실제 API 호출 여부]
const cases = [
  [
    "character_sheet (실제 호출)",
    json('{"kind":"character_sheet","preset":{"style":{},"context":{"industry":[],"age_band":[],"life_stage":[],"main_subjects":[]}}}'),
    200,
    (r) => assert.match(r.result.asset, /^asset:\/\//),
    true,
  ],
  [
    "cut (실제 호출)",
    json('{"kind":"cut","preset":{},"storyboard":{"cuts":[{"cut_index":1,"generated_image":null}]},"referenceAssets":[]}'),
    200,
    (r) => assert.match(r.result.asset, /^asset:\/\//),
    true,
  ],
  ["preset 없음", json('{"kind":"cut"}'), 400, (r) => assert.ok(r.error), false],
  ["kind 불명", json('{"kind":"nope","preset":{}}'), 400, (r) => assert.ok(r.error), false],
  ["깨진 JSON", json("{oops"), 400, (r) => assert.ok(r.error), false],
  ["null 본문", json("null"), 400, (r) => assert.ok(r.error), false],
  ["GET (405)", { method: "GET" }, 405, null, false],
].filter(([, , , , realCall]) => RUN_REAL || !realCall);

if (!RUN_REAL) {
  console.log("(RUN_REAL_GENERATION=1이 아니라 실제 호출 케이스는 건너뜀)\n");
}

let failed = 0;

for (const [name, init, status, check] of cases) {
  try {
    const res = await fetch(URL_, init);
    assert.equal(res.status, status, `status ${res.status} (기대 ${status})`);
    if (check) check(await res.json());
    console.log(`ok   ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL ${name} — ${err.message}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log(`\n${cases.length}건 통과`);
