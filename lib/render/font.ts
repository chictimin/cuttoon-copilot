// 프로젝트 웹폰트로 말풍선 대사를 그리기 위한 폰트 로더(#209). 렌더링 방식은 (가) "글자를
// 패스로 변환"이다 — sharp(librsvg)는 SVG 안 @font-face를 무시하고 시스템 폰트로 그려서
// (10-05 실측, #209 코멘트) OS마다 결과가 달라진다. 폰트 파일을 opentype.js로 직접 읽어
// 글자 모양(<path>)과 실제 글자 폭을 얻으면 OS와 무관하게 같은 그림이 나온다.
//
// 폰트 확인 API와 Export가 폰트를 같은 규칙으로 고르고 읽도록 공용 함수 resolveFontSource를
// 둔다(#236 계약, 캡틴 결정 10-06). 처리 순서·실패 이유(reason)는 확인 API 검증 기준과 직결되므로
// 바꿀 때는 먼저 #236에서 합의한다.

import opentype from "opentype.js";
import type { FontKind, PresetFont } from "@/lib/llm/preset-guard";

export type { FontKind, PresetFont };
export type LoadedFont = opentype.Font;

export type FontResolveReason =
  | "url_rejected" // 입력 URL·redirect 최종 URL·선택된 src URL 중 하나가 정책 함수에서 거부, 또는 URL 파싱 실패
  | "fetch_failed" // 네트워크·DNS·TLS 오류
  | "timeout" // 요청 1건이 FETCH_TIMEOUT_MS 안에 본문까지 끝나지 않음
  | "http_status" // 최종 응답이 2xx 아님
  | "too_large" // 해제 후 본문이 MAX_FONT_BYTES 초과 (스트리밍 중 초과 시점에 중단)
  | "empty_body" // 본문 0바이트
  | "css_no_usable_src" // CSS인데 정책 통과 + WOFF2 아닌 src 후보가 0개
  | "woff2" // 받은 폰트 파일이 WOFF2 (매직 wOF2)
  | "parse_failed" // opentype.parse 예외 또는 font.supported === false (HTML·손상 파일 포함)
  | "kind_mismatch"; // expectKind가 주어졌는데 감지한 kind와 다름

export type UrlPolicy = (url: URL) => boolean;
export const httpsOnly: UrlPolicy = (url) => url.protocol === "https:";

export type FontResolveResult =
  | { ok: true; font: LoadedFont; kind: FontKind; cssFamily: string | null; fontFileUrl: string }
  | { ok: false; reason: FontResolveReason };

export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_FONT_BYTES = 30 * 1024 * 1024;
// 구글 폰트 CSS는 요청 User-Agent에 따라 다른 파일을 준다(10-05 실측): 브라우저 UA면
// unicode-range로 쪼갠 WOFF2 여러 개, 브라우저가 아닌 UA면 전체 글리프가 든 TTF 1개.
// opentype.js 1.x는 WOFF2를 못 읽으므로 브라우저가 아닌 UA로 받는다. 파일·CSS를 구분하기
// 전이므로 첫 요청부터 항상 붙인다(계약 3-2의 2).
export const CSS_USER_AGENT = "cuttoon-copilot-export";

class ResolveError extends Error {
  constructor(readonly reason: FontResolveReason) {
    super(reason);
  }
}

/**
 * 폰트 주소(CSS 또는 폰트 파일)를 받아 실제로 쓸 폰트를 고르고 읽는다. 확인 API와 Export 공용.
 * 예외를 던지지 않는다(모든 실패는 {ok:false, reason}). 캐시하지 않는다(loadFont의 몫).
 */
export async function resolveFontSource(
  url: string,
  opts: { policy: UrlPolicy; expectKind?: FontKind; fetchImpl?: typeof fetch },
): Promise<FontResolveResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    // 1. URL 파싱·정책
    const first = parseAllowed(url, opts.policy);
    // 2. fetch 1
    const res1 = await fetchLimited(first, opts.policy, fetchImpl);
    // 3. 본문으로 종류 감지
    const text = stripCssComments(decodeUtf8(res1.bytes));
    const kind: FontKind = /@font-face/i.test(text) ? "css" : "file";
    // 4. 기대 종류와 비교
    if (opts.expectKind && opts.expectKind !== kind) throw new ResolveError("kind_mismatch");
    // 5. 파일
    if (kind === "file") {
      return { ok: true, font: parseFontBytes(res1.bytes), kind, cssFamily: null, fontFileUrl: res1.finalUrl };
    }
    // 6. CSS — 첫 사용 가능 후보 1개만
    const pick = pickCssSource(text, res1.finalUrl, opts.policy);
    if (!pick) throw new ResolveError("css_no_usable_src");
    // 7. fetch 2
    const res2 = await fetchLimited(pick.url, opts.policy, fetchImpl);
    return { ok: true, font: parseFontBytes(res2.bytes), kind, cssFamily: pick.family, fontFileUrl: res2.finalUrl };
  } catch (err) {
    if (err instanceof ResolveError) return { ok: false, reason: err.reason };
    return { ok: false, reason: "fetch_failed" };
  }
}

function parseAllowed(raw: string, policy: UrlPolicy): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ResolveError("url_rejected");
  }
  if (!policy(u)) throw new ResolveError("url_rejected");
  return u;
}

// 요청 1건: redirect는 기본 follow, 최종 URL을 정책으로 재검사, 본문은 스트림으로 읽으며 상한 초과 시
// 즉시 중단. 시간 제한은 헤더+본문 전체에 적용한다(계약 3-3).
async function fetchLimited(
  url: URL, policy: UrlPolicy, fetchImpl: typeof fetch,
): Promise<{ bytes: Uint8Array; finalUrl: string }> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, FETCH_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetchImpl(url.toString(), {
        headers: { "User-Agent": CSS_USER_AGENT },
        redirect: "follow",
        signal: controller.signal,
      });
    } catch (err) {
      throw new ResolveError(timedOut || isTimeoutError(err) ? "timeout" : "fetch_failed");
    }
    const finalUrl = res.url || url.toString();
    let final: URL;
    try {
      final = new URL(finalUrl);
    } catch {
      throw new ResolveError("url_rejected");
    }
    if (!policy(final)) {
      await res.body?.cancel().catch(() => {});
      throw new ResolveError("url_rejected");
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new ResolveError("http_status");
    }
    const bytes = await readLimited(res, () => timedOut);
    if (bytes.byteLength === 0) throw new ResolveError("empty_body");
    return { bytes, finalUrl: final.toString() };
  } finally {
    clearTimeout(timer);
  }
}

async function readLimited(res: Response, timedOut: () => boolean): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_FONT_BYTES) {
        await reader.cancel().catch(() => {});
        throw new ResolveError("too_large");
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof ResolveError) throw err;
    throw new ResolveError(timedOut() || isTimeoutError(err) ? "timeout" : "fetch_failed");
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function isTimeoutError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
}

function stripCssComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * @font-face 블록을 문서 순서로 나누고, 블록 안 src의 url(...)을 순서대로 후보로 만든다.
 * 상대 경로는 fetch 1의 최종 URL을 base로 푼다. WOFF2(format 또는 확장자)와 정책 거부 후보를
 * 빼고 남은 첫 후보 1개만 돌려준다(다음 후보로 재시도하지 않음).
 */
function pickCssSource(css: string, baseUrl: string, policy: UrlPolicy): { url: URL; family: string | null } | null {
  const blocks = [...css.matchAll(/@font-face\s*\{([^}]*)\}/gi)].map((m) => m[1]);
  for (const block of blocks) {
    const familyMatch = block.match(/font-family\s*:\s*([^;]+)/i);
    const family = familyMatch ? familyMatch[1].trim().replace(/^['"]|['"]$/g, "").trim() || null : null;
    for (const srcValue of srcDeclarations(block)) {
      const candidates = srcValue.matchAll(
        /url\(\s*(['"]?)([^'")]+)\1\s*\)\s*(?:format\(\s*['"]?([\w-]+)['"]?\s*\))?/gi,
      );
      for (const c of candidates) {
        let u: URL;
        try {
          u = new URL(c[2].trim(), baseUrl);
        } catch {
          continue;
        }
        const format = (c[3] ?? "").toLowerCase();
        if (format === "woff2" || u.pathname.toLowerCase().endsWith(".woff2")) continue;
        if (!policy(u)) continue;
        return { url: u, family };
      }
    }
  }
  return null;
}

// 블록을 선언 단위로 나눠 src 값만 돌려준다. ';'로 나누되 괄호·따옴표 안의 ';'는 무시한다 —
// url(data:font/ttf;base64,...)처럼 주소 안에 ';'가 있으면 단순 분리로는 뒤 후보를 놓친다.
function srcDeclarations(block: string): string[] {
  const decls: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i <= block.length; i++) {
    const ch = block[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if ((ch === ";" && depth === 0) || i === block.length) {
      decls.push(block.slice(start, i));
      start = i + 1;
    }
  }
  return decls
    .map((d) => d.match(/^\s*src\s*:\s*([\s\S]*)$/i)?.[1])
    .filter((v): v is string => v !== undefined);
}

/** 폰트 파일 바이트를 읽는다. WOFF2는 opentype.js 1.x가 못 읽어 명시적으로 거른다. */
function parseFontBytes(bytes: Uint8Array): LoadedFont {
  if (bytes.byteLength >= 4 && String.fromCharCode(...bytes.slice(0, 4)) === "wOF2") {
    throw new ResolveError("woff2");
  }
  let font: LoadedFont;
  try {
    font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  } catch {
    throw new ResolveError("parse_failed");
  }
  if (!font.supported) throw new ResolveError("parse_failed");
  return font;
}

// Export용 — 같은 폰트(kind|url)는 프로세스당 한 번만 받는다. 디스크·DB에는 저장하지 않는다
// (#209 "스토리지·DB 변경 없음"). 실패(null)도 캐시해서 Export 한 번에 같은 실패 요청을 컷마다
// 반복하지 않는다. 실패는 전부 null — 호출하는 쪽은 시스템 폰트(FONT_FAMILY)로 그리고 Export는
// 계속된다(#209 완료 기준).
const cache = new Map<string, Promise<LoadedFont | null>>();

export function loadFont(asset: PresetFont | null | undefined): Promise<LoadedFont | null> {
  if (!asset?.url) return Promise.resolve(null);
  const key = `${asset.kind}|${asset.url}`;
  let p = cache.get(key);
  if (!p) {
    p = resolveFontSource(asset.url, { policy: httpsOnly, expectKind: asset.kind }).then((r) => {
      if (r.ok) return r.font;
      console.warn(`[font] 웹폰트를 쓰지 못해 시스템 폰트로 그립니다 (${asset.url}): ${r.reason}`);
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

/** 공백을 뺀 모든 글자가 폰트에 있는지 — 하나라도 없으면 그 대사는 시스템 폰트로 그린다. */
export function coversText(font: LoadedFont, text: string): boolean {
  for (const ch of text) {
    if (/\s/.test(ch)) continue;
    if (font.charToGlyph(ch).index === 0) return false;
  }
  return true;
}
