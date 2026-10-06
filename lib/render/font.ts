// 프로젝트 웹폰트로 말풍선 대사를 그리기 위한 폰트 로더(#209). 렌더링 방식은 (가) "글자를
// 패스로 변환"이다 — sharp(librsvg)는 SVG 안 @font-face를 무시하고 시스템 폰트로 그려서
// (10-05 실측, #209 코멘트) OS마다 결과가 달라진다. 폰트 파일을 opentype.js로 직접 읽어
// 글자 모양(<path>)과 실제 글자 폭을 얻으면 OS와 무관하게 같은 그림이 나온다.
//
// 실패는 전부 null로 돌려준다 — 호출하는 쪽은 지금의 시스템 폰트(FONT_FAMILY)로 그리고
// Export는 계속된다(#209 완료 기준 "웹폰트를 받지 못하면 시스템 폰트로 대체").

import opentype from "opentype.js";

export type FontKind = "css" | "file";

export interface FontAsset {
  family: string;
  url: string;
  /** 등록 전 확인 API가 알려주는 주소 종류. 없으면 주소 모양으로 추측한다. */
  kind?: FontKind;
}

export type LoadedFont = opentype.Font;

const FETCH_TIMEOUT_MS = 10_000;
const MAX_FONT_BYTES = 30 * 1024 * 1024;
// 구글 폰트 CSS는 요청 User-Agent에 따라 다른 파일을 준다(10-05 실측): 브라우저 UA면
// unicode-range로 쪼갠 WOFF2 여러 개, 브라우저가 아닌 UA면 전체 글리프가 든 TTF 1개.
// opentype.js 1.x는 WOFF2를 못 읽으므로 브라우저가 아닌 UA로 받는다.
const CSS_USER_AGENT = "cuttoon-copilot-export";

// 같은 주소는 프로세스당 한 번만 받는다. 디스크·DB에는 저장하지 않는다(#209 "스토리지·DB 변경 없음").
// 실패(null)도 캐시해서 Export 한 번에 같은 실패 요청을 컷마다 반복하지 않는다.
const cache = new Map<string, Promise<LoadedFont | null>>();

export function loadFont(asset: FontAsset | null | undefined): Promise<LoadedFont | null> {
  if (!asset?.url) return Promise.resolve(null);
  const key = `${asset.kind ?? "auto"}|${asset.url}`;
  let p = cache.get(key);
  if (!p) {
    p = fetchAndParse(asset).catch((err) => {
      console.warn(`[font] 웹폰트를 쓰지 못해 시스템 폰트로 그립니다 (${asset.url}): ${(err as Error).message}`);
      return null;
    });
    cache.set(key, p);
  }
  return p;
}

/** 테스트용 — 캐시를 비운다. */
export function clearFontCache(): void {
  cache.clear();
}

async function fetchAndParse(asset: FontAsset): Promise<LoadedFont> {
  const kind = asset.kind ?? guessKind(asset.url);
  const fileUrl = kind === "css" ? await fontUrlFromCss(asset.url) : asset.url;
  return parseFont(await fetchBytes(fileUrl));
}

export function guessKind(url: string): FontKind {
  const path = url.split("?")[0].toLowerCase();
  if (/\.(ttf|otf|woff2?)$/.test(path)) return "file";
  if (path.endsWith(".css") || /fonts\.googleapis\.com\/css2?/.test(url)) return "css";
  return "file";
}

async function fetchBytes(url: string, headers: Record<string, string> = {}): Promise<Uint8Array> {
  if (!url.startsWith("https://")) throw new Error("https 주소만 받습니다");
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_FONT_BYTES) throw new Error(`파일이 너무 큽니다(${buf.byteLength} bytes)`);
  return buf;
}

async function fontUrlFromCss(cssUrl: string): Promise<string> {
  const css = new TextDecoder().decode(await fetchBytes(cssUrl, { "User-Agent": CSS_USER_AGENT }));
  return pickFontUrl(css, cssUrl);
}

/** CSS의 src: url(...) 중 opentype.js가 읽을 수 있는 첫 파일(WOFF2 제외)을 고른다. */
export function pickFontUrl(css: string, baseUrl: string): string {
  const urls = [...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)\s*(?:format\(\s*['"]?([\w-]+)['"]?\s*\))?/g)]
    .map((m) => ({ url: new URL(m[1], baseUrl).toString(), format: (m[2] ?? "").toLowerCase() }))
    .filter((u) => u.format !== "woff2" && !u.url.split("?")[0].toLowerCase().endsWith(".woff2"));
  if (urls.length === 0) throw new Error("CSS에서 읽을 수 있는 폰트 파일(TTF·OTF·WOFF)을 찾지 못했습니다");
  return urls[0].url;
}

/** 폰트 파일 바이트를 읽는다. WOFF2는 opentype.js 1.x가 못 읽어 명시적으로 거른다. */
export function parseFont(bytes: Uint8Array): LoadedFont {
  const magic = String.fromCharCode(...bytes.slice(0, 4));
  if (magic === "wOF2") throw new Error("WOFF2는 아직 지원하지 않습니다(TTF·OTF·WOFF만)");
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const font = opentype.parse(ab);
  if (!font.supported) throw new Error("지원하지 않는 폰트 형식입니다");
  return font;
}

/** 공백을 뺀 모든 글자가 폰트에 있는지 — 하나라도 없으면 그 대사는 시스템 폰트로 그린다. */
export function coversText(font: LoadedFont, text: string): boolean {
  for (const ch of text) {
    if (/\s/.test(ch)) continue;
    if (font.charToGlyph(ch).index === 0) return false;
  }
  return true;
}
