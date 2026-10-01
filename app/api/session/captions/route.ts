import {
  generateCutCaptions,
  generateSingleCutCaption,
  type CaptionContext,
} from "@/lib/llm/captions";
import { isValidToneId } from "@/lib/llm/caption-tones";

export const runtime = "nodejs";

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((x) => typeof x === "string");
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
 * body: { subject, flow, beats(4개), cast(description 목록), tone_id, context, cut_index?, supporting_id? }
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

  const input = {
    subject: subject.trim(),
    flow: flow.trim(),
    beats: beats as string[],
    cast: cast as string[],
    tone_id,
    context: parsedContext,
    ...(resolvedSupportingId !== undefined ? { supporting_id: resolvedSupportingId } : {}),
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
