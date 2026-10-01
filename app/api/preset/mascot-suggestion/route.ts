import { suggestMascots } from "@/lib/llm/mascot-suggestions";

export const runtime = "nodejs";

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((x) => typeof x === "string");
}

/**
 * 마스코트 초안 제안 (issue #150 C6-api).
 * body: { context: { industry: string[], interests: string[] }, style?: { keywords?: string[] } }
 * - 응답: {mascots:[{label:"mascot",description}] 1~3개}. 화면은 후보를 선택지로
 *   보여주고 확정은 사용자가 한다(확정 UI는 C6-ui 몫).
 * - 빈 배열이어도 호출한다 — 비어 있음을 프롬프트에 밝히고 억지로 채우지 않는다.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON 본문을 파싱할 수 없습니다" }, { status: 400 });
  }

  const { context, style } = (body ?? {}) as Record<string, unknown>;
  if (typeof context !== "object" || context === null) {
    return Response.json({ error: "context가 필요합니다" }, { status: 400 });
  }
  const { industry, interests } = context as Record<string, unknown>;
  if (!isStringArray(industry) || !isStringArray(interests)) {
    return Response.json(
      { error: "context.industry·context.interests는 문자열 배열이어야 합니다" },
      { status: 400 }
    );
  }
  const rawKeywords = (style as Record<string, unknown> | undefined)?.keywords;
  if (rawKeywords !== undefined && !isStringArray(rawKeywords)) {
    return Response.json(
      { error: "style.keywords는 문자열 배열이어야 합니다" },
      { status: 400 }
    );
  }
  const keywords = isStringArray(rawKeywords) ? rawKeywords : [];

  try {
    const result = await suggestMascots({ industry, interests, keywords });
    return Response.json(result);
  } catch (error) {
    console.error("마스코트 제안 에러:", error);
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "마스코트 제안에 실패했습니다. 다시 시도해주세요.",
      },
      { status: 500 }
    );
  }
}
