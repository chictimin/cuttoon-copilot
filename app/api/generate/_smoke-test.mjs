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

  // #108: allSettled 라 1~2안만 돌아올 수 있다. 화면이 배열 길이대로 그리므로
  // 요청 개수를 같이 내려보내지 않으면 조용히 줄어든 상태가 된다.
  const coverCase = src.slice(src.indexOf("case 'cover_variants'"), src.indexOf("case 'cut'"));
  assert.match(
    coverCase,
    /requested:\s*3/,
    "cover_variants 응답에 requested가 없습니다 — 화면이 부족분을 알 수 없습니다 (#108)"
  );
}

// #104: 3안은 각각 별도 유료 호출이다. Promise.all 로 되돌리면 한 안의 후처리
// 실패가 이미 성공한 안의 생성비까지 날린다. 실제 동작은 유료 호출이 필요해
// 확인할 수 없으므로 되돌림만 막는다 — 이 검사는 필터 로직의 정확성은 보증하지 않는다.
function checkCoverVariantsSettled() {
  const src = readFileSync(
    new URL("../../../lib/openai/generate.ts", import.meta.url),
    "utf8"
  ).replace(/\/\/.*$/gm, "");

  const at = src.indexOf("export const generateCoverVariants");
  assert.notEqual(at, -1, "generate.ts에서 generateCoverVariants를 찾지 못했습니다");
  const fn = src.slice(at);
  assert.match(
    fn,
    /Promise\.allSettled/,
    "generateCoverVariants가 Promise.allSettled를 쓰지 않습니다 — 한 안의 실패가 성공한 안의 생성비를 날립니다 (#104)"
  );
  assert.doesNotMatch(
    fn,
    /Promise\.all\(/,
    "generateCoverVariants에 Promise.all(이 남아 있습니다 (#104)"
  );

  // #114 의 부족분 재시도(#108)에 붙인 안전장치. 배치가 통째로 실패하는 것은
  // 이미지별 문제가 아니라 환경 문제라(업로드 계열) 재시도해도 같이 실패하고
  // 생성비만 두 배가 된다 — #67 이 그 상황이었다. 그 상태에서 멈추는지 본다.
  assert.match(
    fn,
    /gained === 0[\s\S]{0,400}break/,
    "배치가 통째로 실패해도 재시도를 계속합니다 — 환경 문제에 생성비를 두 배로 씁니다 (#67)"
  );

  // #118: 재시도 토글. 예산 하나로 표현해야 한다 — 분기를 따로 두면 한쪽만 고쳐진다.
  assert.match(
    fn,
    /attemptsLeft\s*=\s*retry\s*\?\s*input\.count\s*\*\s*2\s*:\s*input\.count/,
    "재시도 예산이 토글을 반영하지 않습니다 (#118)"
  );
  // 미달 원인이 세 갈래로 찍혀야 한다. retry 불리언만 보고 찍으면 배치 전멸로 조기
  // break 한 경우도 "한도 소진" 으로 나온다 — 예산이 남아 있는데도 그렇게 찍히고,
  // #113 이 요약 줄만 세어 통계를 내면 원인이 왜곡된다.
  //
  // 변수명이 아니라 라벨 문자열로 검사한다. 등가 리팩터로 변수명이 바뀌어도 라벨이
  // 남아 있으면 동작은 같다.
  for (const label of ['배치 전멸로 중단', '재시도 한도 소진', '재시도 꺼짐']) {
    assert.ok(fn.includes(label), `미달 원인 라벨 "${label}" 이 없습니다 — 원인이 뭉쳐 찍힙니다 (#118)`);
  }
  assert.match(
    fn,
    /gained === 0[\s\S]{0,300}=\s*true/,
    "배치 전멸로 중단할 때 원인을 기록하지 않습니다 — '한도 소진' 으로 잘못 찍힙니다 (#118)"
  );

  // 기본값은 on 이어야 한다. 오타('ture')가 조용히 off 로 떨어지면 시연에서
  // 3안이 2안으로 줄어드는 쪽으로 실패한다 — 끄는 값만 명시적으로 받는다.
  const toggle = src.slice(src.indexOf("function retryEnabled"));
  assert.notEqual(src.indexOf("function retryEnabled"), -1, "retryEnabled를 찾지 못했습니다 (#118)");
  assert.match(
    toggle.slice(0, 400),
    /return\s*!\(/,
    "retryEnabled가 기본 on 이 아닙니다 — 끄는 값만 받아야 합니다 (#118)"
  );
}

// 캐릭터 동일성(P0 게이트)의 방어선이 켜져 있는지 확인한다. reference 이미지가
// 0장인 채로 유료 호출이 나가면 4컷이 다 나온 뒤에야 드러난다.
//
// 실제 동작(시트를 못 읽을 때 정말 던지는지)은 HTTP 로 구분할 수 없다 — route.ts
// 가 원인을 감추고 일괄 500 을 주기 때문에 조기 차단이든 모델 호출 실패든 같은
// 응답이다. 그래서 배선만 검사한다.
function checkReferenceGuard() {
  const src = readFileSync(
    new URL("../../../lib/openai/generate.ts", import.meta.url),
    "utf8"
  ).replace(/\/\/.*$/gm, "");

  assert.match(
    src,
    /preset\.assets\?\.character_sheet/,
    "호출부가 referenceAssets를 빼먹었을 때 preset.assets.character_sheet로 채우지 않습니다"
  );

  const at = src.indexOf("async function toInputImages");
  assert.notEqual(at, -1, "generate.ts에서 toInputImages를 찾지 못했습니다");
  const fn = src.slice(at, src.indexOf("\n}", at));
  assert.match(
    fn,
    /images\.length === 0[\s\S]*throw/,
    "reference 이미지가 0장일 때 던지지 않습니다 — 동일성 방어선 없이 유료 호출이 나갑니다"
  );
  assert.match(
    fn,
    /console\.(error|warn)/,
    "readAsset 실패를 조용히 넘깁니다 — 방어선이 꺼진 것을 아무도 모릅니다 (#67)"
  );
}

// 캐릭터 시트(extract.ts, B②)와 컷 프롬프트가 같은 스타일 지시를 받아야 한다.
// 시트만 palette·keywords 를 쓰고 컷은 안 쓰던 상태가 실제로 있었고, 그때 시트와
// 컷의 스타일이 구조적으로 어긋났다. 사용자가 적은 forbidden 은 어느 쪽도 안 썼다.
//
// 이 검사는 "컷이 그 값들을 읽는가" 까지만 본다 — 문구가 시트와 같은지, 모델이
// 실제로 따르는지는 육안 검증 영역이다.
function checkStyleParity() {
  const src = readFileSync(
    new URL("../../../lib/openai/generate.ts", import.meta.url),
    "utf8"
  ).replace(/\/\/.*$/gm, "");

  const at = src.indexOf("function buildCutPrompt");
  assert.notEqual(at, -1, "generate.ts에서 buildCutPrompt를 찾지 못했습니다");
  // buildCutPrompt 본문만 잘라낸다. 파일 전체를 보면 MinimalPreset의 타입 선언에
  // 이름이 있는 것만으로 통과해, 값을 실제로 읽지 않아도 검사가 넘어간다.
  const end = src.indexOf("function nextUngeneratedCut", at);
  assert.notEqual(end, -1, "buildCutPrompt의 끝 경계를 찾지 못했습니다");
  const fn = src.slice(at, end);

  // #113: 런타임 시트는 preset.context 로 그려진 제3의 인물이라 컷 인물과 대응하지
  // 않는다. "시트 인물과 일치시켜라" 가 참이 되는 컷이 없으므로 4컷 전부 이 문구가
  // 나가야 한다 — 조건 분기가 되살아나면 그때는 preset 쪽 매핑 필드를 근거로 해야
  // 하고, 이 검사도 같이 고쳐야 한다.
  //
  // 문구로 검사한다. 앞서 분기 모양을 정규식으로 잡으려다 옵셔널 체이닝(`?.`)에
  // 걸려 미탐이 났다.
  assert.match(
    fn,
    // 소스에서 문자열이 여러 줄로 이어붙여지므로(`… from ` + `the one drawn …`)
    // 연결 지점을 넘는 문구는 매칭되지 않는다. 한 줄 안에 있는 조각으로 본다.
    /a different character/,
    "지도사가 프레임에 없을 때의 문구가 없습니다 — 시트 동일성 문장이 항상 붙습니다 (#113)"
  );

  // 폴백 규칙이 다시 인라인되지 않게 막는다. promptHint('character_ratio', …) 가
  // ratioClause 밖에서 또 나오면 그 자리에 규칙이 복사된 것이고, 그게 #126·#129 로
  // 두 번 사고가 난 형태다.
  const ratioLookups = (src.match(/promptHint\(\s*['"]character_ratio['"]/g) ?? []).length;
  assert.equal(
    ratioLookups,
    1,
    `character_ratio 사전 조회가 ${ratioLookups}곳에 있습니다 — ratioClause 한 곳에만 있어야 합니다 (#126, #129)`
  );
  assert.match(
    src,
    /export function ratioClause/,
    "ratioClause를 export하지 않습니다 — extract.ts가 폴백 규칙을 복사해야 합니다 (#128)"
  );

  for (const [field, why] of [
    // #121 이 힌트를 추가하면 갈라지는 유일한 필드다 — 컷은 hint() 로 서술문을
    // 집어가는데 extract.ts 는 raw 토큰을 쓴다. 기준물(시트)이 5~6두신으로
    // 그려지고 컷만 2두신 지시를 받으면 #113 게이트 1 판정을 오독한다 (PR #120 리뷰).
    ["character_ratio", "캐릭터 비율을 컷 프롬프트가 읽지 않습니다 — 시트와 비율이 어긋납니다"],
    ["palette", "색상 팔레트를 컷 프롬프트가 읽지 않습니다 — 시트와 색이 어긋납니다"],
    ["keywords", "사용자가 입력한 그림체 키워드를 컷 프롬프트가 읽지 않습니다"],
    ["forbidden", "사용자가 적은 금지 요소를 컷 프롬프트가 읽지 않습니다"],
  ]) {
    assert.ok(fn.includes(field), why);
  }
}

let failed = 0;

try {
  checkWiring();
  console.log("ok   [정적] route가 continueFrom을 읽어 generateCut에 전달");
} catch (err) {
  failed++;
  console.error(`FAIL [정적] ${err.message}`);
}

try {
  checkCoverVariantsSettled();
  console.log("ok   [정적] 표지 3안이 allSettled로 성공분을 보존");
} catch (err) {
  failed++;
  console.error(`FAIL [정적] ${err.message}`);
}

try {
  checkReferenceGuard();
  console.log("ok   [정적] reference 0장이면 유료 호출 전에 차단");
} catch (err) {
  failed++;
  console.error(`FAIL [정적] ${err.message}`);
}

try {
  checkStyleParity();
  console.log("ok   [정적] 컷 프롬프트가 palette·keywords·forbidden을 읽음");
} catch (err) {
  failed++;
  console.error(`FAIL [정적] ${err.message}`);
}

const json = (body) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body,
});

// cut·cover_variants 는 reference 이미지를 하나도 못 읽으면 유료 호출 전에 던진다
// (캐릭터 동일성이 P0 게이트라 시트 없이 만든 이미지는 어차피 버린다). 실제 호출
// 케이스는 읽을 수 있는 시트 애셋이 있어야 하므로 URI 를 환경변수로 받는다.
const SHEET = process.env.SMOKE_SHEET_ASSET;
if (RUN_REAL && !SHEET) {
  console.error(
    "FAIL RUN_REAL_GENERATION=1 인데 SMOKE_SHEET_ASSET 이 없습니다 — 읽을 수 있는 asset:// 시트 URI를 지정하세요"
  );
  process.exit(1);
}

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
    json(
      `{"kind":"cut","preset":{"assets":{"character_sheet":"${SHEET}"}},"storyboard":{"cuts":[{"cut_index":1,"generated_image":null}]},"referenceAssets":[]}`
    ),
    200,
    (r) => assert.match(r.result.asset, /^asset:\/\//),
    true,
  ],
  [
    // 3장을 생성하므로 다른 실제 호출 케이스보다 비싸다.
    "cover_variants (실제 호출 3장)",
    json(
      `{"kind":"cover_variants","preset":{"assets":{"character_sheet":"${SHEET}"}},"storyboard":{"cuts":[{"cut_index":1}]},"referenceAssets":[]}`
    ),
    200,
    (r) => {
      assert.ok(Array.isArray(r.result), "result가 배열이 아닙니다");
      // allSettled 로 바뀌어 1~3안이 올 수 있다. 유료 결과를 버리지 않는 것이
      // 목적이므로 개수 자체는 3 이하를 허용하고 0 만 실패로 본다 (#104).
      assert.ok(r.result.length >= 1 && r.result.length <= 3, `1~3안이어야 합니다 (받음: ${r.result.length})`);
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

const total = cases.length + 4; // + 정적 검사 4건
if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log(`\n${total}건 통과`);
