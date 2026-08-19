// POST /api/upload 스모크 테스트. dev 서버를 띄운 뒤 실행한다.
//   npm run dev
//   node app/api/upload/_smoke-test.mjs
// 표준 라이브러리만 사용 — 테스트 러너를 추가하지 않는다 (app/api/generate/_smoke-test.mjs와 동일 컨벤션).
import assert from "node:assert/strict";

const URL_ = process.env.SMOKE_URL ?? "http://localhost:3000/api/upload";

function formDataWith(file) {
  const fd = new FormData();
  if (file) fd.append("file", file);
  return fd;
}

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

const cases = [
  [
    "file 없음",
    formDataWith(null),
    400,
    (r) => assert.equal(r.error, "파일이 없습니다"),
  ],
  [
    "지원하지 않는 MIME (text/plain)",
    formDataWith(new File(["hello"], "a.txt", { type: "text/plain" })),
    400,
    (r) => assert.equal(r.error, "PNG · JPG · WebP 이미지만 올릴 수 있습니다"),
  ],
  [
    "10MB 초과",
    formDataWith(
      new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.png", { type: "image/png" })
    ),
    400,
    (r) => assert.equal(r.error, "이미지는 10MB까지 올릴 수 있습니다"),
  ],
  [
    "정상 PNG",
    formDataWith(new File([PNG_1PX], "ok.png", { type: "image/png" })),
    200,
    (r) => assert.match(r.assetUri, /^asset:\/\//),
  ],
];

let failed = 0;

for (const [name, formData, status, check] of cases) {
  try {
    const res = await fetch(URL_, { method: "POST", body: formData });
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
