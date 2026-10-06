// issue #209 F2: 프로젝트 폰트 확인 API용 응답 조립 (서버).
// 판정은 `lib/render/font.ts`의 공용 함수 `resolveFontSource`가 하고,
// 이 파일은 그 결과를 확인 API 응답 형태로 바꾸는 일만 한다(spec-209 rev2 4절).

import type { FontKind } from "./preset-guard";
import {
  httpsOnly,
  resolveFontSource,
  type FontResolveResult,
  type UrlPolicy,
} from "@/lib/render/font";

export const FONT_ERROR = "폰트 경로가 잘못되었습니다" as const;

export type ValidateReason =
  | import("@/lib/render/font").FontResolveReason
  | "bad_request"
  | "family_invalid";

export type ValidateResponse =
  | { ok: true; family: string; url: string; kind: FontKind }
  | { ok: false; error: typeof FONT_ERROR; reason: ValidateReason };

const MAX_URL_LENGTH = 2048;
const MAX_FAMILY_CODEPOINTS = 60;

/**
 * 폰트 파일 URL에서 family 이름을 만든다(spec-209 rev2 4-3 file).
 * `new URL(inputUrl).pathname`의 마지막 조각 → decodeURIComponent(실패 시 원문) →
 * 마지막 `.` 이후 확장자 제거 → 제어문자 제거·앞뒤 공백 제거 →
 * 60자(코드포인트) 자르기 → 비면 `"ProjectFont"`.
 */
export function fileNameFamily(url: string): string {
  let last: string;
  try {
    last = new URL(url).pathname.split("/").pop() ?? "";
  } catch {
    return "ProjectFont";
  }
  let decoded = last;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    decoded = last;
  }
  const noExt = decoded.includes(".") ? decoded.slice(0, decoded.lastIndexOf(".")) : decoded;
  const cleaned = noExt.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const sliced = [...cleaned].slice(0, MAX_FAMILY_CODEPOINTS).join("");
  return sliced.length > 0 ? sliced : "ProjectFont";
}

/**
 * `resolveFontSource` 결과를 확인 API 응답으로 바꾼다(spec-209 rev2 4-2·4-3).
 * `inputUrl`은 trim된 입력 URL. 성공 응답의 `url`은 입력 trim 그대로 둔다.
 */
export function toValidateResponse(inputUrl: string, r: FontResolveResult): ValidateResponse {
  if (!r.ok) {
    return { ok: false, error: FONT_ERROR, reason: r.reason };
  }
  if (r.kind === "css") {
    const family = (r.cssFamily ?? "").trim();
    if ([...family].length < 1 || [...family].length > MAX_FAMILY_CODEPOINTS) {
      return { ok: false, error: FONT_ERROR, reason: "family_invalid" };
    }
    return { ok: true, family, url: inputUrl, kind: "css" };
  }
  return { ok: true, family: fileNameFamily(inputUrl), url: inputUrl, kind: "file" };
}

function badRequest(): ValidateResponse {
  return { ok: false, error: FONT_ERROR, reason: "bad_request" };
}

/**
 * 확인 API 본문을 받아 폰트 주소를 검증한다(spec-209 rev2 4-1).
 * `raw`는 라우트가 파싱한 JSON 본문(`{url: string}` 모양이어야 함).
 * trim 후 빈 값·2048자 초과, `new URL` 실패·host 빈 값이면 `bad_request`(8절 R2).
 */
export async function validateFontUrl(
  raw: unknown,
  opts?: { policy?: UrlPolicy; fetchImpl?: typeof fetch },
): Promise<ValidateResponse> {
  const urlRaw =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>).url
      : undefined;
  if (typeof urlRaw !== "string") return badRequest();
  const trimmed = urlRaw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) return badRequest();
  try {
    if (!new URL(trimmed).host) return badRequest();
  } catch {
    return badRequest();
  }
  const r = await resolveFontSource(trimmed, {
    policy: opts?.policy ?? httpsOnly,
    fetchImpl: opts?.fetchImpl,
  });
  return toValidateResponse(trimmed, r);
}
