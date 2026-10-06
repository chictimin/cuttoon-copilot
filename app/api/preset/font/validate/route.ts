// issue #209 F2: 프로젝트 폰트 확인 API (라우트).
// 판정·정책 로직은 갖지 않는다 — `validateFontUrl`이 기본 정책(httpsOnly)으로
// `resolveFontSource`를 호출하고, 이 라우트는 그 결과를 그대로 돌려준다.
import { validateFontUrl } from "@/lib/llm/font-probe";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }
  const result = await validateFontUrl(body);
  console.info("[POST /api/preset/font/validate]", result.ok ? result.kind : result.reason);
  return Response.json(result, { status: 200 });
}
