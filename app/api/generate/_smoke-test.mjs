// POST /api/generate 스모크 테스트. dev 서버를 띄운 뒤 실행한다.
//   npm run dev
//   node app/api/generate/_smoke-test.mjs
// 표준 라이브러리만 사용 — 테스트 러너를 추가하지 않는다.
//
// #18: generateCharacterSheet/generateCut/generateCoverVariants가 실제 모델을
// 호출하므로(스텁 아님), 기본 실행에서는 400 계열(무료) 케이스만 돈다. 실제
// 호출까지 확인하려면 RUN_REAL_GENERATION=1로 실행 — OpenAI 과금이 발생한다.
//
// 앞부분의 정적 배선 검사는 서버도 크레딧도 필요 없다 — 언제나 돈다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const URL_ = process.env.SMOKE_URL ?? "http://localhost:3000/api/generate";
const RUN_REAL = process.env.RUN_REAL_GENERATION === "1";

// ── 정적 배선 검사 ──────────────────────────────────────────────────────────
// #75: route가 continueFrom을 본문에서 읽지 않아 조용히 버려지던 사고. 당시엔
// 스텁이 받은 값을 에코해 HTTP로 확인했지만, 실제 모델 호출(#18, PR #80)로
// 바뀌면서 성공 경로가 유료가 되어 그 방식을 쓸 수 없게 됐다. 배선 자체는
// 소스에서 확인할 수 있으므로 여기서 검사한다 — 무료이고 서버도 필요 없다.
function checkWiring() {
  // 라인 주석을 먼저 걷어낸다. 이 전처리가 없으면 배선을 주석으로 바꾸기만 해도
  // (`// continueFrom: 잠시 끊음`) 아래 검사가 그 주석 텍스트에 매칭돼 통과한다 —
  // #75가 재발하는데도 조용히 넘어가는 미탐이다. 반대로 아래 doesNotMatch 쪽은
  // 주석에 든 continueFrom 때문에 멀쩡한 코드가 실패하는 오탐이 났다.
  // `://` 를 포함한 문자열 리터럴까지 잘라내긴 하지만, 그때는 검사가 실패하는
  // 쪽으로 기울기 때문에 배선이 끊긴 채 통과하는 일은 없다.
  const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8").replace(
    /\/\/.*$/gm,
    ""
  );

  const destructure = src.match(/const\s*\{([^}]*)\}\s*=\s*body/);
  assert.ok(destructure, "route.ts에서 body destructuring을 찾지 못했습니다");
  assert.match(
    destructure[1],
    /\bcontinueFrom\b/,
    "route.ts가 body에서 continueFrom을 읽지 않습니다 (#75 재발)"
  );

  const call = src.match(/generateCut\(\{([\s\S]*?)\}\)/);
  assert.ok(call, "route.ts에서 generateCut 호출을 찾지 못했습니다");
  assert.match(
    call[1],
    /continueFrom\s*:/,
    "route.ts가 continueFrom을 generateCut에 전달하지 않습니다 (#75 재발)"
  );

  // 표지 3안은 count 를 리터럴 3 으로 고정해야 한다 (#50) — 호출부가 안 개수를
  // 임의로 늘리지 못하게 한 계약이다. 그리고 체이닝 토큰을 받지 않아야 한다:
  // 3안이 서로 독립이어야 2안이 1안에 끌려가지 않는다 (PRD 6절).
  const cover = src.match(/generateCoverVariants\(\{([\s\S]*?)\}\)/);
  assert.ok(cover, "route.ts에서 generateCoverVariants 호출을 찾지 못했습니다");
  assert.match(
    cover[1],
    /count\s*:\s*3/,
    "route.ts가 generateCoverVariants에 count: 3 을 전달하지 않습니다"
  );
  assert.doesNotMatch(
    cover[1],
    /continueFrom/,
    "표지 3안은 독립 호출이어야 합니다 — continueFrom을 넘기면 안 됩니다 (PRD 6절)"
  );
}

let failed = 0;

try {
  checkWiring();
  console.log("ok   [정적] route가 continueFrom을 읽어 generateCut에 전달");
} catch (err) {
  failed++;
  console.error(`FAIL [정적] ${err.message}`);
}

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
  [
    // 3장을 생성하므로 다른 실제 호출 케이스보다 비싸다.
    "cover_variants (실제 호출 3장)",
    json('{"kind":"cover_variants","preset":{},"storyboard":{"cuts":[{"cut_index":1}]},"referenceAssets":[]}'),
    200,
    (r) => {
      assert.ok(Array.isArray(r.result), "result가 배열이 아닙니다");
      assert.equal(r.result.length, 3, `3안이어야 합니다 (받음: ${r.result.length})`);
      for (const v of r.result) assert.match(v.asset, /^asset:\/\//);
    },
    true,
  ],
  ["preset 없음", json('{"kind":"cut"}'), 400, (r) => assert.ok(r.error), false],
  ["kind 불명", json('{"kind":"nope","preset":{}}'), 400, (r) => assert.ok(r.error), false],
  ["깨진 JSON", json("{oops"), 400, (r) => assert.ok(r.error), false],
  ["null 본문", json("null"), 400, (r) => assert.ok(r.error), false],
  ["GET (405)", { method: "GET" }, 405, null, false],
].filter(([, , , , realCall]) => RUN_REAL || !realCall);

if (!RUN_REAL) {
  console.log("(RUN_REAL_GENERATION=1이 아니라 실제 호출 케이스는 건너뜀)");
}

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

const total = cases.length + 1; // + 정적 배선 검사
if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log(`\n${total}건 통과`);
