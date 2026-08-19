import { generateBrainstormTurns } from "@/lib/llm/brainstorm";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const subject = body.subject as string | undefined;

    if (!subject || subject.trim().length === 0) {
      return Response.json({ error: "소재가 필요합니다" }, { status: 400 });
    }

    const turns = await generateBrainstormTurns(subject.trim());
    return Response.json({ turns });
  } catch (error) {
    const message = error instanceof Error ? error.message : "브레인스토밍 생성 실패";
    console.error("브레인스토밍 에러:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
