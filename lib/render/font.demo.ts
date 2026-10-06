// 프로젝트 웹폰트 경로(#209)의 경계를 확인하는 스크립트. 공용 함수 resolveFontSource의 처리 순서와
// 실패 이유(reason) 10종은 폰트 확인 API 검증 기준과 직결되므로(#236 계약) 여기서 하나씩 고정한다.
// 기본은 네트워크 없이 도는 검사만(CI용) — 가짜 fetch와 opentype.js로 직접 만든 작은 폰트를 쓴다.
// --online을 붙이면 실제 구글 폰트(나눔고딕)를 받아 패스로 그려지는지도 본다.
//
// 실행: npx tsx lib/render/font.demo.ts            (오프라인 검사)
//       npx tsx lib/render/font.demo.ts --online   (실제 웹폰트까지)

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import opentype from "opentype.js";
import sharp from "sharp";
import { composeCut } from "./compose";
import {
  clearFontCache, coversText, httpsOnly, loadFont, MAX_FONT_BYTES, resolveFontSource,
  type FontResolveReason, type PresetFont,
} from "./font";
import type { Caption } from "./types";

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`ok   ${name}`); }
  else { failed++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

// ── 테스트용 폰트: 'A'와 '가' 두 글자만 있는 작은 TTF ──────────────────────────────
function demoFontBytes(): Uint8Array {
  const box = (x0: number, x1: number) => {
    const p = new opentype.Path();
    p.moveTo(x0, 0); p.lineTo(x0, 700); p.lineTo(x1, 700); p.lineTo(x1, 0); p.close();
    return p;
  };
  const glyphs = [
    new opentype.Glyph({ name: ".notdef", unicode: 0, advanceWidth: 600, path: new opentype.Path() }),
    new opentype.Glyph({ name: "A", unicode: 65, advanceWidth: 600, path: box(100, 500) }),
    new opentype.Glyph({ name: "uniAC00", unicode: 0xac00, advanceWidth: 1000, path: box(100, 900) }),
  ];
  const font = new opentype.Font({ familyName: "Demo", styleName: "Regular", unitsPerEm: 1000, ascender: 800, descender: -200, glyphs });
  return new Uint8Array(font.toArrayBuffer());
}
const FONT = demoFontBytes();

// ── 가짜 fetch: 주소별로 응답을 정한다. 요청 기록을 남겨 요청 수·헤더를 확인한다 ─────────────
type Route = { status?: number; body?: Uint8Array | string | ReadableStream<Uint8Array>; finalUrl?: string; throws?: unknown };
function fakeFetch(routes: Record<string, Route>) {
  const calls: { url: string; ua: string | null }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, ua: new Headers(init?.headers).get("User-Agent") });
    const r = routes[url];
    if (!r) throw new TypeError("fetch failed");
    if (r.throws) throw r.throws;
    const body = typeof r.body === "string" ? new TextEncoder().encode(r.body) : r.body;
    const res = new Response((body ?? null) as BodyInit | null, { status: r.status ?? 200 });
    Object.defineProperty(res, "url", { value: r.finalUrl ?? url });
    return res;
  }) as typeof fetch;
  return { impl, calls };
}
function bigStream(bytes: number): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(1024 * 1024);
  let sent = 0;
  return new ReadableStream({
    pull(c) {
      if (sent >= bytes) { c.close(); return; }
      c.enqueue(chunk); sent += chunk.byteLength;
    },
  });
}

async function expectReason(name: string, url: string, routes: Record<string, Route>, reason: FontResolveReason, expectKind?: "css" | "file") {
  const { impl } = fakeFetch(routes);
  const r = await resolveFontSource(url, { policy: httpsOnly, expectKind, fetchImpl: impl });
  check(`${name} → ${reason}`, !r.ok && r.reason === reason, JSON.stringify(r.ok ? { ok: true } : r));
}

async function offline() {
  const T = "https://fonts.test";
  const css = (src: string, family = "'Brand Sans'") => `/* @font-face { src: url(trap.ttf) } 주석 안은 무시 */
@font-face { font-family: ${family}; src: ${src}; }`;

  // 성공 경로
  {
    const { impl, calls } = fakeFetch({ [`${T}/a.ttf`]: { body: FONT } });
    const r = await resolveFontSource(`${T}/a.ttf`, { policy: httpsOnly, fetchImpl: impl });
    check("파일 주소 → kind file, cssFamily null", r.ok && r.kind === "file" && r.cssFamily === null && r.fontFileUrl === `${T}/a.ttf`);
    check("첫 요청부터 User-Agent를 붙임", calls[0]?.ua === "cuttoon-copilot-export");
  }
  {
    const two = `@font-face { font-family: "Woff2 Only"; src: url(w.woff2) format("woff2"); }
@font-face { font-family: 'Brand Sans'; src: url(data:font/ttf;base64,AAAA) format("truetype"), url("x/a.ttf") format("truetype"), url(b.otf); }`;
    const { impl, calls } = fakeFetch({
      [`${T}/brand.css`]: { body: two, finalUrl: "https://cdn.test/dir/brand.css" },
      "https://cdn.test/dir/x/a.ttf": { body: FONT },
    });
    const r = await resolveFontSource(`${T}/brand.css`, { policy: httpsOnly, fetchImpl: impl });
    check("CSS → WOFF2·data: 후보는 빼고 첫 후보, 상대 경로는 redirect 최종 URL 기준",
      r.ok && r.kind === "css" && r.fontFileUrl === "https://cdn.test/dir/x/a.ttf", JSON.stringify(calls));
    check("CSS → cssFamily는 선택된 블록의 font-family(따옴표 제거)", r.ok && r.cssFamily === "Brand Sans");
    check("CSS 경로는 요청 2건", calls.length === 2);
  }
  {
    const { impl } = fakeFetch({ [`${T}/n.css`]: { body: "@font-face { src: url(a.ttf); }" }, [`${T}/a.ttf`]: { body: FONT } });
    const r = await resolveFontSource(`${T}/n.css`, { policy: httpsOnly, fetchImpl: impl });
    check("CSS 블록에 font-family가 없으면 cssFamily null", r.ok && r.cssFamily === null);
  }

  // 실패 이유 10종
  await expectReason("주소 파싱 실패", "not a url", {}, "url_rejected");
  await expectReason("http 주소", "http://fonts.test/a.ttf", {}, "url_rejected");
  await expectReason("redirect 최종 URL이 http", `${T}/r.ttf`, { [`${T}/r.ttf`]: { body: FONT, finalUrl: "http://evil.test/a.ttf" } }, "url_rejected");
  await expectReason("네트워크 오류", `${T}/down.ttf`, { [`${T}/down.ttf`]: { throws: new TypeError("fetch failed") } }, "fetch_failed");
  await expectReason("시간 초과", `${T}/slow.ttf`, { [`${T}/slow.ttf`]: { throws: new DOMException("timeout", "TimeoutError") } }, "timeout");
  await expectReason("404", `${T}/404.ttf`, { [`${T}/404.ttf`]: { status: 404, body: "not found" } }, "http_status");
  await expectReason("30MB 초과(스트리밍 중 중단)", `${T}/big.ttf`, { [`${T}/big.ttf`]: { body: bigStream(MAX_FONT_BYTES + 2 * 1024 * 1024) } }, "too_large");
  await expectReason("본문 0바이트", `${T}/empty.ttf`, { [`${T}/empty.ttf`]: { body: new Uint8Array(0) } }, "empty_body");
  await expectReason("CSS에 쓸 수 있는 src 없음(WOFF2·http·data:만)", `${T}/w.css`,
    { [`${T}/w.css`]: { body: css("url(a.woff2), url(http://x.test/a.ttf), url(data:font/ttf;base64,AA)") } }, "css_no_usable_src");
  await expectReason("WOFF2 파일", `${T}/a.woff2`, { [`${T}/a.woff2`]: { body: new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0]) } }, "woff2");
  await expectReason("HTML(폰트 아님)", `${T}/page`, { [`${T}/page`]: { body: "<html><body>login</body></html>" } }, "parse_failed");
  await expectReason("저장된 kind=css인데 파일", `${T}/a.ttf`, { [`${T}/a.ttf`]: { body: FONT } }, "kind_mismatch", "css");
  await expectReason("저장된 kind=file인데 CSS", `${T}/k.css`, { [`${T}/k.css`]: { body: css("url(a.ttf)") } }, "kind_mismatch", "file");
  await expectReason("CSS가 고른 폰트 파일이 WOFF2(확장자 없음)", `${T}/c.css`,
    { [`${T}/c.css`]: { body: css("url(f1)") }, [`${T}/f1`]: { body: new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2]) } }, "woff2");

  // loadFont: 저장된 kind를 그대로 쓰고, 같은 폰트는 한 번만 받는다
  {
    const { impl, calls } = fakeFetch({ [`${T}/cache.ttf`]: { body: FONT } });
    const original = globalThis.fetch;
    globalThis.fetch = impl;
    try {
      clearFontCache();
      const asset: PresetFont = { family: "Demo", url: `${T}/cache.ttf`, kind: "file" };
      const [a, b] = [await loadFont(asset), await loadFont(asset)];
      check("loadFont: 같은 폰트는 한 번만 받음(캐시)", a !== null && a === b && calls.length === 1);
      check("loadFont: 저장된 kind가 다르면 null(시스템 폰트로)", (await loadFont({ ...asset, kind: "css" })) === null);
      check("loadFont: http 주소는 null", (await loadFont({ ...asset, url: "http://fonts.test/a.ttf" })) === null);
      check("loadFont: 폰트 지정 없음 → null", (await loadFont(null)) === null);
    } finally {
      globalThis.fetch = original;
      clearFontCache();
    }
  }

  // 합성: 폰트가 없으면 지금 동작과 바이트까지 같고(회귀 없음), 폰트에 없는 글자가 있으면 그 대사는 시스템 폰트
  const img = await sharp({ create: { width: 600, height: 600, channels: 3, background: { r: 240, g: 240, b: 240 } } }).png().toBuffer();
  for (const c of [
    { text: "아침마다 무릎이 뻣뻣해서 계단 내려갈 때 조심하게 돼요", bubble_type: "rounded", position: "top_left" },
    { text: "오늘부터 스트레칭!", bubble_type: "rect", position: "center" },
  ] as Caption[]) {
    const [a, b] = await Promise.all([composeCut(img, [c]), composeCut(img, [c], undefined, null)]);
    check(`폰트 없음 = 기존 결과 (${c.bubble_type}/${c.position})`, Buffer.compare(a, b) === 0);
  }
  const demo = opentype.parse(FONT.buffer.slice(FONT.byteOffset, FONT.byteOffset + FONT.byteLength) as ArrayBuffer);
  check("폰트에 있는 글자만이면 coversText true", coversText(demo, "가 A"));
  const partial: Caption = { text: "가나", bubble_type: "rounded", position: "top_left" };
  const [sysP, webP] = await Promise.all([composeCut(img, [partial]), composeCut(img, [partial], undefined, demo)]);
  check("폰트에 없는 글자가 있는 대사는 시스템 폰트로(결과 동일)", Buffer.compare(sysP, webP) === 0);
  const full: Caption = { text: "가가 AA", bubble_type: "rounded", position: "top_left" };
  const [sysF, webF] = await Promise.all([composeCut(img, [full]), composeCut(img, [full], undefined, demo)]);
  check("폰트에 다 있는 대사는 패스로 그려짐(결과 다름)", Buffer.compare(sysF, webF) !== 0);
}

async function online() {
  const cssUrl = "https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@700&display=swap";
  const t0 = Date.now();
  const r = await resolveFontSource(cssUrl, { policy: httpsOnly, expectKind: "css" });
  check(`구글 폰트 CSS → TTF 받아 읽기 (${Date.now() - t0}ms)`, r.ok && r.kind === "css", JSON.stringify(r.ok ? { cssFamily: r.cssFamily, file: r.fontFileUrl } : r));
  if (!r.ok) return;
  check(`cssFamily = "${r.cssFamily}"`, r.cssFamily === "Nanum Gothic");
  const asFile = await resolveFontSource(r.fontFileUrl, { policy: httpsOnly, expectKind: "file" });
  check("고른 폰트 파일 주소를 kind=file로 직접 읽기", asFile.ok && asFile.kind === "file");
  const mismatch = await resolveFontSource(cssUrl, { policy: httpsOnly, expectKind: "file" });
  check("CSS 주소를 kind=file로 저장했으면 kind_mismatch", !mismatch.ok && mismatch.reason === "kind_mismatch");
  check("한글 대사의 글자가 모두 폰트에 있음", coversText(r.font, "아침마다 무릎이 뻣뻣해 ABC 123!"));

  const img = await sharp({ create: { width: 600, height: 600, channels: 3, background: { r: 240, g: 240, b: 240 } } }).png().toBuffer();
  const c: Caption = { text: "아침마다 무릎이 뻣뻣해서 계단 내려갈 때 조심하게 돼요", bubble_type: "rounded", position: "top_left" };
  const [sys, web] = await Promise.all([composeCut(img, [c]), composeCut(img, [c], undefined, r.font)]);
  check("웹폰트로 그리면 시스템 폰트와 결과가 다름(패스로 그려짐)", Buffer.compare(sys, web) !== 0);
  const out = join(tmpdir(), "cuttoon-font-demo.png");
  writeFileSync(out, await sharp({ create: { width: 1210, height: 600, channels: 3, background: "#ffffff" } })
    .composite([{ input: sys, left: 0, top: 0 }, { input: web, left: 610, top: 0 }]).png().toBuffer());
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
