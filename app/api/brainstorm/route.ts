import { generateBrainstormTurns, type DraftStoryboard } from "@/lib/llm/brainstorm";

export const runtime = "nodejs";

// draft는 부분 채워진 storyboard다. 이 값을 넘기지 않으면 generateBrainstormTurns가
// 슬롯이 하나도 안 찼다고 보고 항상 3턴 전부를 만든다 — PRD 6절의 "소재에 이미
// 정보가 있으면 해당 턴은 건너뛴다"와 종료 판정이 통째로 죽는다. #75(route가
// continueFrom을 본문에서 읽지 않아 조용히 버리던 사고)와 같은 유형이라, 읽는
// 자리를 명시해 둔다.
//
// 요소 내부까지는 검증하지 않는다 — cast[].role과 cuts[].narrative_beat는
// 라이브러리 쪽에서 optional로 다루고, 형태가 어긋나면 아래 catch가 500으로 받는다.
function parseDraft(value: unknown): DraftStoryboard | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { cast, cuts } = value as Record<string, unknown>;
  if (!Array.isArray(cast) || !Array.isArray(cuts)) return undefined;
  return { cast, cuts } as DraftStoryboard;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const subject = body.subject as string | undefined;

    if (!subject || subject.trim().length === 0) {
      return Response.json({ error: "소재가 필요합니다" }, { status: 400 });
    }

    const turns = await generateBrainstormTurns(subject.trim(), parseDraft(body.draft));
    return Response.json({ turns });
  } catch (error) {
    console.error("브레인스토밍 에러:", error);
    return Response.json(
      { error: "브레인스토밍 생성에 실패했습니다. 다시 시도해주세요." },
      { status: 500 }
    );
  }
}
