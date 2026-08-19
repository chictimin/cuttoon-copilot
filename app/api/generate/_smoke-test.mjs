// POST /api/generate 스모크 테스트. dev 서버를 띄운 뒤 실행한다.
//   npm run dev
//   node app/api/generate/_smoke-test.mjs
// 표준 라이브러리만 사용 — 테스트 러너를 추가하지 않는다.
import assert from "node:assert/strict";

const URL_ = process.env.SMOKE_URL ?? "http://localhost:3000/api/generate";

const json = (body) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body,
});

// [설명, fetch 옵션, 기대 status, 응답 검사]
const cases = [
  [
    "character_sheet",
    json('{"kind":"character_sheet","preset":{}}'),
    200,
    (r) => assert.match(r.result.asset, /^asset:\/\//),
  ],
  [
    "cut",
    json('{"kind":"cut","preset":{},"storyboard":{},"referenceAssets":["a"]}'),
    200,
    (r) => assert.match(r.result.asset, /^asset:\/\//),
  ],
  ["preset 없음", json('{"kind":"cut"}'), 400, (r) => assert.ok(r.error)],
  ["kind 불명", json('{"kind":"nope","preset":{}}'), 400, (r) => assert.ok(r.error)],
  ["깨진 JSON", json("{oops"), 400, (r) => assert.ok(r.error)],
  ["null 본문", json("null"), 400, (r) => assert.ok(r.error)],
  ["GET (405)", { method: "GET" }, 405, null],
];

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
