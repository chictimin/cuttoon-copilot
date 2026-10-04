import {
  generateBrainstormTurns,
  extractDraftFromSubject,
  type DraftStoryboard,
} from "@/lib/llm/brainstorm";
import { inferSubjectTagCategories } from "@/lib/llm/subject-tag-inference";
import {
  parseSubjectTags,
  projectForModel,
  SUBJECT_TAG_FALLBACK_CATEGORY,
  type SubjectTag,
} from "@/lib/llm/subject-tags";

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

    const trimmed = subject.trim();
    // 200자 소재는 관찰 기준으로만 둔다. 초과해도 받아들이고 길이만 로그에 남긴다.
    if (trimmed.length > 200) {
      console.info(`[llm-length] brainstorm-subject length=${trimmed.length} over_limit=200`);
    }

    // 프로젝트 분야(문자열 배열, 없으면 빈 배열) — 프롬프트의 <프로젝트 분야> 태그에 넣는다.
    const rawIndustry = (body.context as Record<string, unknown> | undefined)?.industry;
    const industry = Array.isArray(rawIndustry)
      ? rawIndustry.filter((v): v is string => typeof v === "string")
      : [];

    // 프로젝트 마스코트(issue #150 C5) — supporting 첫 후보 고정용. 형태가
    // 어긋나면 무시하고 마스코트 없이 진행한다.
    const rawMascot = (body.context as Record<string, unknown> | undefined)?.mascot;
    const mascot =
      typeof rawMascot === "object" &&
      rawMascot !== null &&
      typeof (rawMascot as Record<string, unknown>).label === "string" &&
      ((rawMascot as Record<string, unknown>).label as string).length > 0 &&
      typeof (rawMascot as Record<string, unknown>).description === "string" &&
      ((rawMascot as Record<string, unknown>).description as string).length > 0
        ? (rawMascot as { label: string; description: string })
        : undefined;

    // issue #206 S2: 화면이 보낸 subject_tags는 받지 않는다 — 매 호출 재추론한다.
    // 태그가 없으면 아래 infer·투영을 통째로 건너뛰어 현행 그대로(추가 호출 0) 둔다.
    const parsedTags = parseSubjectTags(trimmed);
    let subjectTags: SubjectTag[] = [];
    let modelSubject = trimmed;
    if (parsedTags.length > 0) {
      const inferStart = Date.now();
      try {
        subjectTags = await inferSubjectTagCategories({ subject: trimmed, industry });
      } catch {
        subjectTags = parsedTags.map((tag) => ({
          raw: tag.raw,
          category: tag.category ?? SUBJECT_TAG_FALLBACK_CATEGORY,
        }));
      }
      console.info(`[subject-tags] infer ms=${Date.now() - inferStart}`);
      modelSubject = projectForModel(trimmed, trimmed, subjectTags);
    }

    // issue #119-1: 클라이언트가 draft를 보내는 경로는 아직 없다(첫 호출 시점엔
    // 답변이 하나도 없어 만들 수 없다) — 대신 서버가 subject에서 자체 추출한다.
    // body.draft가 명시적으로 오면(향후 확장 대비, 지금은 안 옴) 그걸 우선한다.
    // 태그가 있으면 투영 소재(modelSubject)로 추출한다 — 원문은 추출·브레인스토밍에 안 간다.
    const suppliedDraft = parseDraft(body.draft);
    const extracted = suppliedDraft ? undefined : await extractDraftFromSubject(modelSubject);
    const draft = suppliedDraft ?? extracted?.draft;

    const { turns, flowSupplement } = await generateBrainstormTurns(modelSubject, draft, {
      industry,
      ...(mascot ? { mascot } : {}),
    });
    // flowSupplement: flow 옵션 중 로컬 목록으로 보충한 위치. 화면은 서버가
    // 정규화한 flow 옵션을 사용한다(F1 계약).
    return Response.json({ turns, resolved: extracted?.resolved ?? [], flowSupplement, subjectTags });
  } catch (error) {
    console.error("브레인스토밍 에러:", error);
    return Response.json(
      { error: "브레인스토밍 생성에 실패했습니다. 다시 시도해주세요." },
      { status: 500 }
    );
  }
}
