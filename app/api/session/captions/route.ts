import {
  generateCutCaptions,
  generateSingleCutCaption,
  type CaptionContext,
} from "@/lib/llm/captions";
import { isValidToneId } from "@/lib/llm/caption-tones";
import { isValidCtaId } from "@/lib/llm/cta-presets";

export const runtime = "nodejs";

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((x) => typeof x === "string");
}

type CtaStrength = "none" | "soft" | "clear";

/**
 * cta 요청을 검증한다 (issue #205 K4). 형식 오류는 400 — 다른 강도·기본값으로
 * 보정하지 않는다. none이면 purpose_id를 보내도 무시한다.
 * cta 없음(undefined)도 정상 — clear + 프로젝트 기본 목적(현행)이다.
 */
function parseCta(
  value: unknown
): { ok: true; cta?: { strength: CtaStrength; purpose_id?: string | null } } | { ok: false; error: string } {
  if (value === undefined) return { ok: true };
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: "cta는 객체여야 합니다" };
  }
  const { strength, purpose_id } = value as Record<string, unknown>;
  if (strength !== "none" && strength !== "soft" && strength !== "clear") {
    return { ok: false, error: "cta.strength는 none·soft·clear 중 하나여야 합니다" };
  }
  if (strength === "none") return { ok: true, cta: { strength } };
  if (purpose_id === undefined || purpose_id === null) {
    return { ok: true, cta: { strength, purpose_id: null } };
  }
  if (typeof purpose_id !== "string" || purpose_id.length === 0) {
    return { ok: false, error: "cta.purpose_id는 cta_presets id 문자열 또는 null이어야 합니다" };
  }
  if (!isValidCtaId(purpose_id)) {
    return { ok: false, error: `cta.purpose_id "${purpose_id}"가 cta_presets.json의 preset id가 아님` };
  }
  return { ok: true, cta: { strength, purpose_id } };
}

function parseContext(value: unknown): CaptionContext | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { industry, interests, cta_format } = value as Record<string, unknown>;
  if (!isStringArray(industry) || !isStringArray(interests)) return undefined;
  if (typeof cta_format !== "string") return undefined;
  return { industry, interests, cta_format };
}

/**
 * F2 컷 대사 + F4 컷 연출 생성. 이미지 호출 전에 화면이 부른다.
 * body: { subject, flow, beats(4개), cast(description 목록), tone_id, context, cut_index?, supporting_id?, cta? }
 * - cta: {strength:"none"}(purpose_id는 보내도 무시) 또는 {strength:"soft"|"clear", purpose_id: null|유효 id}.
 *   없으면 clear + 프로젝트 기본 목적(현행). 형식 오류는 400(보정 없음). 컷별 다시 뽑기도 같은 입력.
 * - supporting_id: 조연 character_id(마스코트 조연이면 mascot.label). 없으면 "supporting".
 * - cut_index(1~4)가 있으면 그 컷의 대사와 연출을 함께 다시 뽑아
 *   {captions:[1개], directions:[1개]}로 돌려준다.
 * - 없으면 4컷 전체를 {captions:[4개], directions:[4개]}로 돌려준다.
 * - fallbackCutIndexes: 기본 대사로 채운 컷. 화면은 해당 컷을 `기본 대사`로 표시한다.
 * - fallbackDirectionCuts: 연출 필드 하나라도 기본값으로 돌아간 컷.
 *   화면은 검증된 연출만 적용한다.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON 본문을 파싱할 수 없습니다" }, { status: 400 });
  }

  const {
    subject,
    flow,
    beats,
    cast,
    tone_id,
    context,
    cut_index,
    supporting_id,
    cta,
  } = (body ?? {}) as Record<string, unknown>;

  if (typeof subject !== "string" || subject.trim().length === 0) {
    return Response.json({ error: "소재가 필요합니다" }, { status: 400 });
  }
  if (typeof flow !== "string" || flow.trim().length === 0) {
    return Response.json({ error: "flow가 필요합니다" }, { status: 400 });
  }
  if (
    !Array.isArray(beats) ||
    beats.length !== 4 ||
    !beats.every((b) => typeof b === "string" && b.length > 0)
  ) {
    return Response.json({ error: "beats 4개가 필요합니다" }, { status: 400 });
  }
  if (
    !Array.isArray(cast) ||
    cast.length === 0 ||
    !cast.every((c) => typeof c === "string" && c.length > 0)
  ) {
    return Response.json({ error: "cast description 1개 이상이 필요합니다" }, { status: 400 });
  }
  if (typeof tone_id !== "string" || !isValidToneId(tone_id)) {
    return Response.json({ error: "tone_id가 유효하지 않습니다" }, { status: 400 });
  }
  const parsedContext = parseContext(context);
  if (!parsedContext) {
    return Response.json(
      { error: "context(industry·interests·cta_format)가 필요합니다" },
      { status: 400 }
    );
  }
  // 조연 character_id(issue #150 C4). 없으면 lib에서 "supporting"으로 둔다.
  let resolvedSupportingId: string | undefined;
  if (supporting_id !== undefined) {
    if (typeof supporting_id !== "string" || supporting_id.length === 0) {
      return Response.json({ error: "supporting_id는 비어 있지 않은 문자열이어야 합니다" }, { status: 400 });
    }
    resolvedSupportingId = supporting_id;
  }

  const parsedCta = parseCta(cta);
  if (!parsedCta.ok) {
    return Response.json({ error: parsedCta.error }, { status: 400 });
  }
  // beats·강도 교차 검증 (issue #205 계약 "형식 오류는 400, 보정 없음"과 같은 원칙).
  // none인데 beats에 cta가 있으면 400 — none 폴백이 cta 문장을 낼 경로를 없앤다.
  // soft/clear(없음 포함)인데 4번이 cta가 아니면 400.
  const beatList = beats as string[];
  if (parsedCta.cta?.strength === "none") {
    if (beatList.includes("cta")) {
      return Response.json({ error: "cta.strength가 none인데 beats에 cta가 있습니다" }, { status: 400 });
    }
  } else if (beatList[3] !== "cta") {
    return Response.json({ error: "beats 4번이 cta여야 합니다" }, { status: 400 });
  }

  const input = {
    subject: subject.trim(),
    flow: flow.trim(),
    beats: beats as string[],
    cast: cast as string[],
    tone_id,
    context: parsedContext,
    ...(resolvedSupportingId !== undefined ? { supporting_id: resolvedSupportingId } : {}),
    ...(parsedCta.cta !== undefined ? { cta: parsedCta.cta } : {}),
  };

  try {
    // 컷별 다시 뽑기: cut_index 하나만 받아 그 컷만 교체한다. 횟수 제한 없음.
    if (cut_index !== undefined) {
      if (cut_index !== 1 && cut_index !== 2 && cut_index !== 3 && cut_index !== 4) {
        return Response.json({ error: "cut_index는 1~4여야 합니다" }, { status: 400 });
      }
      const result = await generateSingleCutCaption(input, cut_index);
      return Response.json(result);
    }

    const result = await generateCutCaptions(input);
    return Response.json(result);
  } catch (error) {
    console.error("캡션 생성 에러:", error);
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "대사 생성에 실패했습니다. 다시 시도해주세요.",
      },
      { status: 500 }
    );
  }
}
