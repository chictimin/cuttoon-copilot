// 프로젝트 웹폰트로 말풍선 대사를 그리는 경로(#209)의 경계를 확인하는 스크립트.
// 기본은 네트워크 없이 도는 검사만(CI용) — 주소 종류 추측, CSS에서 폰트 파일 고르기,
// WOFF2·깨진 파일 거르기, 폰트가 없으면 결과가 지금과 바이트까지 같은지.
// --online을 붙이면 실제 구글 폰트(나눔고딕)를 받아 패스로 그려지는지도 본다.
//
// 실행: npx tsx lib/render/font.demo.ts            (오프라인 검사)
//       npx tsx lib/render/font.demo.ts --online   (실제 웹폰트까지)

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { composeCut } from "./compose";
import { coversText, guessKind, loadFont, parseFont, pickFontUrl } from "./font";
import type { Caption } from "./types";

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`ok   ${name}`); }
  else { failed++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
function throwsWith(fn: () => unknown, part: string): boolean {
  try { fn(); return false; } catch (e) { return (e as Error).message.includes(part); }
}

async function blankImage(): Promise<Buffer> {
  return sharp({ create: { width: 600, height: 600, channels: 3, background: { r: 240, g: 240, b: 240 } } }).png().toBuffer();
}

async function offline() {
  check("주소 종류: .ttf 파일", guessKind("https://example.com/a/NanumGothic.ttf?v=1") === "file");
  check("주소 종류: 구글 폰트 CSS", guessKind("https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@700") === "css");
  check("주소 종류: .css 파일", guessKind("https://cdn.example.com/fonts/brand.css") === "css");

  const googleBrowserCss = "@font-face { src: url(https://fonts.gstatic.com/s/x/a.0.woff2) format('woff2'); }";
  check("CSS에 WOFF2만 있으면 거름", throwsWith(() => pickFontUrl(googleBrowserCss, "https://fonts.googleapis.com/css2"), "찾지 못했습니다"));
  const mixed = "src: url('a.woff2') format('woff2'), url(\"fonts/a.ttf\") format('truetype');";
  check("CSS에서 TTF를 고르고 상대 주소를 풂", pickFontUrl(mixed, "https://cdn.example.com/brand.css") === "https://cdn.example.com/fonts/a.ttf");

  check("WOFF2 파일은 명확한 이유로 거름", throwsWith(() => parseFont(new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0])), "WOFF2"));
  check("깨진 파일은 예외", throwsWith(() => parseFont(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), ""));

  check("폰트 지정 없음 → null", (await loadFont(null)) === null);
  check("https가 아닌 주소 → null(시스템 폰트로 대체)", (await loadFont({ family: "x", url: "http://example.com/a.ttf" })) === null);

  // 폰트가 없으면(null) 지금 동작과 바이트까지 같아야 한다 — 폰트 미지정 프로젝트 회귀 없음(#209 완료 기준).
  const img = await blankImage();
  const caps: Caption[] = [
    { text: "아침마다 무릎이 뻣뻣해서 계단 내려갈 때 조심하게 돼요", bubble_type: "rounded", position: "top_left" },
    { text: "오늘부터 스트레칭!", bubble_type: "rect", position: "center" },
  ];
  for (const c of caps) {
    const [a, b] = await Promise.all([composeCut(img, [c]), composeCut(img, [c], undefined, null)]);
    check(`폰트 없음 = 기존 결과 (${c.bubble_type}/${c.position})`, Buffer.compare(a, b) === 0);
  }
}

async function online() {
  const asset = { family: "Nanum Gothic", url: "https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@700&display=swap" };
  const t0 = Date.now();
  const font = await loadFont(asset);
  const firstMs = Date.now() - t0;
  check(`구글 폰트 CSS → TTF 받아 읽기 (${firstMs}ms)`, font !== null);
  if (!font) return;
  const t1 = Date.now();
  check("같은 주소 두 번째는 캐시 (같은 객체)", (await loadFont(asset)) === font && Date.now() - t1 < 50);
  check("한글 대사의 글자가 모두 폰트에 있음", coversText(font, "아침마다 무릎이 뻣뻣해 ABC 123!"));
  check("폰트에 없는 글자(이모지)는 감지", !coversText(font, "좋아요 😀"));

  const img = await blankImage();
  const c: Caption = { text: "아침마다 무릎이 뻣뻣해서 계단 내려갈 때 조심하게 돼요", bubble_type: "rounded", position: "top_left" };
  const [sys, web] = await Promise.all([composeCut(img, [c]), composeCut(img, [c], undefined, font)]);
  check("웹폰트로 그리면 시스템 폰트와 결과가 다름(패스로 그려짐)", Buffer.compare(sys, web) !== 0);
  const emoji: Caption = { ...c, text: "오늘도 화이팅 😀" };
  const [sysE, webE] = await Promise.all([composeCut(img, [emoji]), composeCut(img, [emoji], undefined, font)]);
  check("폰트에 없는 글자가 있는 대사는 시스템 폰트로(결과 동일)", Buffer.compare(sysE, webE) === 0);

  const out = join(tmpdir(), "cuttoon-font-demo.png");
  const both = await sharp({ create: { width: 1210, height: 600, channels: 3, background: "#ffffff" } })
    .composite([{ input: sys, left: 0, top: 0 }, { input: web, left: 610, top: 0 }]).png().toBuffer();
  writeFileSync(out, both);
  console.log(`     비교 그림(왼쪽 시스템 폰트, 오른쪽 나눔고딕): ${out}`);
}

async function main() {
  await offline();
  if (process.argv.includes("--online")) await online();
  if (failed > 0) {
    console.error(`\n${failed}건 실패`);
    process.exit(1);
  }
  console.log(`\n${passed}건 통과`);
}

main();
