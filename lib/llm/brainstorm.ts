/**
 * Issue #5: 3턴 브레인스토밍 — 소재에서 주인공·조연·흐름 선택지 생성
 *
 * PRD.md 6절:
 * - 최대 3턴, 매 턴 선택지 3개 + "직접 쓸게" + "알아서 해줘"
 * - 소재에 이미 정보가 있으면 해당 턴은 건너뛴다
 * - 종료 판정은 "필수 슬롯이 전부 찼는가"로 결정적이어야 한다
 */

import { NO_SUPPORTING_OPTION } from "./brainstorm-options";

export interface BrainstormTurn {
  key: "protagonist" | "supporting" | "flow";
  question: string;
  options: string[];
}

// draft storyboard의 필드만 필요하므로 간단하게 정의.
// route가 본문에서 이 값을 읽어 넘겨야 턴 건너뛰기가 실제로 동작하므로 export한다.
export interface DraftStoryboard {
  cast: Array<{ role: "protagonist" | "supporting" }>;
  cuts: Array<{ narrative_beat?: string }>;
}

/**
 * 브레인스토밍 턴이 이미 채워졌는지 확인합니다.
 */
function isSlotFilled(
  key: "protagonist" | "supporting" | "flow",
  draft?: DraftStoryboard
): boolean {
  if (!draft) return false;

  switch (key) {
    case "protagonist":
      // cast에 protagonist 역할이 있으면 이미 선택됨
      return draft.cast.some((member) => member.role === "protagonist");

    case "supporting":
      // cast가 비어있거나, supporting이 있거나, 또는 1명뿐이면 (supporting 없음으로 결정됨)
      // draft에 cast가 있고, protagonist가 있으면 supporting이 이미 결정됨 (있거나 없거나)
      return draft.cast.length > 0;

    case "flow":
      // 모든 컷에 narrative_beat가 채워졌으면 flow 완성
      return (
        draft.cuts.length === 4 &&
        draft.cuts.every((cut) => cut.narrative_beat && cut.narrative_beat.length > 0)
      );

    default:
      return false;
  }
}

/**
 * 모든 필수 슬롯이 채워졌는지 확인합니다.
 */
function areAllSlotsComplete(draft?: DraftStoryboard): boolean {
  if (!draft) return false;

  const hasProtagonist = draft.cast.some((member) => member.role === "protagonist");
  const hasCast = draft.cast.length > 0; // supporting이 결정됨 (있거나 없거나)
  const hasFlow =
    draft.cuts.length === 4 &&
    draft.cuts.every((cut) => cut.narrative_beat && cut.narrative_beat.length > 0);

  return hasProtagonist && hasCast && hasFlow;
}

/**
 * 소재를 받아서 브레인스토밍 턴을 생성합니다.
 *
 * @param subject 소재
 * @param draft 부분 채워진 storyboard (있으면 이미 채워진 턴은 건너뜀)
 * @returns 생성할 턴 배열 (최대 3개, 이미 채워진 것은 제외)
 */
export async function generateBrainstormTurns(
  subject: string,
  draft?: DraftStoryboard
): Promise<BrainstormTurn[]> {
  // 모든 슬롯이 이미 채워졌으면 빈 배열 반환 (종료)
  if (areAllSlotsComplete(draft)) {
    return [];
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY 환경 변수가 없습니다");
  }

  // 생성할 턴 결정 (이미 채워진 것은 제외)
  const allTurns: Array<"protagonist" | "supporting" | "flow"> = [
    "protagonist",
    "supporting",
    "flow",
  ];
  const turnsToGenerate = allTurns.filter((key) => !isSlotFilled(key, draft));

  if (turnsToGenerate.length === 0) {
    return [];
  }

  // 생성할 턴들에 대한 프롬프트 구성
  const turnDescriptions = turnsToGenerate
    .map((key) => {
      switch (key) {
        case "protagonist":
          return `{
    "key": "protagonist",
    "question": "주인공은 누구인가요?",
    "options": ["선택지1", "선택지2", "선택지3"]
  }`;
        case "supporting":
          return `{
    "key": "supporting",
    "question": "함께 등장할 인물이 있나요?",
    "options": ["선택지1", "선택지2", "${NO_SUPPORTING_OPTION}"]
  }`;
        case "flow":
          return `{
    "key": "flow",
    "question": "어떤 흐름으로 풀어볼까요?",
    "options": ["선택지1", "선택지2", "선택지3"]
  }`;
      }
    })
    .join(",\n  ");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.7,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `한국 보건/의료 컷툰의 소재가 주어졌을 때, 브레인스토밍 선택지를 생성하세요.

소재: "${subject}"

아래 항목들만 JSON으로 반환하세요. 다른 텍스트는 없이 JSON만.

[
  ${turnDescriptions}
]

요구사항:
- 각 턴마다 정확히 3개의 선택지
- protagonist: 소재와 관련된 연령대/상황의 구체적인 주인공 3명 후보
- supporting: 조연 3가지 옵션 (반드시 "${NO_SUPPORTING_OPTION}" 포함)
- flow: 보건/의료 컷툰에 맞는 스토리 흐름 3가지 (예: 문제→해결, 질문→답변, 전후 비교)
- JSON 형식만 반환`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    console.error("브레인스토밍 OpenAI API 에러:", error);
    throw new Error("브레인스토밍 생성에 실패했습니다. 다시 시도해주세요.");
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = data.choices[0]?.message.content;
  if (!content) {
    console.error("브레인스토밍: OpenAI에서 응답을 받지 못함");
    throw new Error("브레인스토밍 생성에 실패했습니다. 다시 시도해주세요.");
  }

  // JSON 파싱
  let parsed: BrainstormTurn[];
  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error("JSON 형식을 찾을 수 없습니다");
    }
    parsed = JSON.parse(jsonMatch[0]) as BrainstormTurn[];
  } catch (err) {
    console.error("브레인스토밍 JSON 파싱 실패:", err, "응답:", content);
    throw new Error("브레인스토밍 생성에 실패했습니다. 다시 시도해주세요.");
  }

  // 검증
  if (!Array.isArray(parsed)) {
    console.error("브레인스토밍: 응답이 배열이 아님");
    throw new Error("브레인스토밍 생성에 실패했습니다. 다시 시도해주세요.");
  }

  for (const turn of parsed) {
    if (
      !turn.key ||
      !turn.question ||
      !Array.isArray(turn.options) ||
      turn.options.length !== 3
    ) {
      console.error("브레인스토밍: 턴 형식이 맞지 않음", turn);
      throw new Error("브레인스토밍 생성에 실패했습니다. 다시 시도해주세요.");
    }
  }

  // 프롬프트가 turnsToGenerate만 요청해도 모델이 지시를 무시하고 이미 채워진
  // 턴까지 같이 만들어 보낼 수 있다 (실측 확인됨 — protagonist가 채워진 draft를
  // 넘겨도 응답에 protagonist가 다시 포함됨). 턴 건너뛰기가 프롬프트 지시에만
  // 의존하면 조용히 깨지므로, 실제로 요청한 집합으로 응답을 다시 한번 좁힌다.
  const requested = new Set(turnsToGenerate);
  const filtered = parsed.filter((turn) => requested.has(turn.key));
  if (filtered.length !== turnsToGenerate.length) {
    console.error("브레인스토밍: 응답이 요청한 턴 집합과 다름", {
      requested: turnsToGenerate,
      received: parsed.map((t) => t.key),
    });
  }

  return filtered;
}

/**
 * issue #119-1: 소재 텍스트에서 이미 정해진 정보(주인공·조연)를 뽑아 부분
 * DraftStoryboard를 만든다. PRD 6절 "소재에 이미 정보가 있으면 해당 턴은
 * 건너뛴다"를 실현하는 자리 — 이 함수가 만든 draft를 generateBrainstormTurns에
 * 넘기면 기존 isSlotFilled/areAllSlotsComplete(위)가 이미 처리한다.
 *
 * 별도 LLM 호출로 분리한 이유(#119 작업안): generateBrainstormTurns 안에서 한
 * 호출로 합치면 응답이 "일부는 값, 일부는 선택지"로 섞여 파싱이 복잡해지고,
 * 이미 실측된 문제(위 filtered 처리 참고 — 모델이 요청 안 한 턴도 같이 보낼 수
 * 있음)를 더 복잡한 형태로 반복할 위험이 있다. 실패해도 draft 없음(빈 배열)으로
 * 폴백해 골든패스를 막지 않는다.
 *
 * supporting은 protagonist와 항상 같이 결정한다 — isSlotFilled("supporting")이
 * "cast.length > 0"(협업자 유무가 이미 결정됨)만 보는 구조라, protagonist만 알고
 * supporting이 모호한 상태로 draft를 반쪽만 채우면 "조연 없음으로 결정됨"으로
 * 잘못 읽혀 그 턴이 부당하게 스킵된다. 그래서 둘 다 확실할 때만 draft를 채우고,
 * 하나라도 불확실하면 통째로 빈 draft(둘 다 물어봄)로 되돌린다.
 */
export interface ExtractedSlot {
  key: "protagonist" | "supporting";
  /** 화면 안내 배너에 보여줄 값. supporting이 "없음으로 판단"인 경우 그 문구를 담는다. */
  value: string;
}

export interface ExtractedDraft {
  draft: DraftStoryboard;
  /** 소재에서 이미 파악된 슬롯 — 화면이 "이미 파악한 것" 안내에 쓴다. 빈 배열이면 안내 없음. */
  resolved: ExtractedSlot[];
}

const EMPTY_EXTRACTED_DRAFT: ExtractedDraft = { draft: { cast: [], cuts: [] }, resolved: [] };

export async function extractDraftFromSubject(subject: string): Promise<ExtractedDraft> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // 실패해도 골든패스를 막지 않는다 — 3턴 전부 묻는 기존 동작으로 돌아간다.
    return EMPTY_EXTRACTED_DRAFT;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0,
        max_tokens: 256,
        messages: [
          {
            role: "user",
            content: `아래 소재 문장에 주인공·조연 정보가 이미 명확히 들어있는지 판단하세요.

소재: "${subject}"

JSON으로만 반환하세요. 다른 텍스트는 없이 JSON만.

{
  "protagonist": "소재에 구체적으로 드러난 주인공 서술" 또는 null,
  "supporting": "소재에 구체적으로 드러난 조연 서술" 또는 "없음"(조연이 없다는 것이 명확한 경우) 또는 null
}

규칙:
- 명확히 드러나지 않으면 반드시 null로 답하세요. 추측해서 지어내지 마세요.
- protagonist가 null이면 supporting도 null로 답하세요 — 주인공을 모르는데 조연 유무만 아는 경우는 없습니다.
- JSON 형식만 반환`,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error("소재 분석 OpenAI API 에러:", await response.json().catch(() => ({})));
      return EMPTY_EXTRACTED_DRAFT;
    }

    const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
    const content = data.choices[0]?.message.content;
    if (!content) return EMPTY_EXTRACTED_DRAFT;

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return EMPTY_EXTRACTED_DRAFT;

    const parsed = JSON.parse(jsonMatch[0]) as { protagonist?: unknown; supporting?: unknown };

    const protagonist = typeof parsed.protagonist === "string" ? parsed.protagonist.trim() : null;
    if (!protagonist) {
      // protagonist가 없으면 위 규칙대로 supporting도 무시 — 둘 다 물어본다.
      return EMPTY_EXTRACTED_DRAFT;
    }

    const supportingRaw = typeof parsed.supporting === "string" ? parsed.supporting.trim() : null;
    if (!supportingRaw) {
      // protagonist는 확실한데 supporting이 모호하면(null) 통째로 폴백한다 — 반쪽 draft가
      // "조연 없음"으로 잘못 읽히는 것을 막는다(위 함수 설명 참고).
      return EMPTY_EXTRACTED_DRAFT;
    }

    // 추출 프롬프트가 "없음"을 조연 부재 마커로 쓴다 — 화면의 NO_SUPPORTING_OPTION과는
    // 다른 문자열이다(혼동 방지용으로 이름을 분리했다). 아래 resolved에서 최종적으로
    // NO_SUPPORTING_OPTION으로 치환한다.
    const EXTRACTION_ABSENT_MARKER = "없음";
    const hasSupporting = supportingRaw !== EXTRACTION_ABSENT_MARKER;

    const draft: DraftStoryboard = {
      cast: hasSupporting
        ? [{ role: "protagonist" }, { role: "supporting" }]
        : [{ role: "protagonist" }],
      cuts: [],
    };
    const resolved: ExtractedSlot[] = [
      { key: "protagonist", value: protagonist },
      { key: "supporting", value: hasSupporting ? supportingRaw : NO_SUPPORTING_OPTION },
    ];

    return { draft, resolved };
  } catch (err) {
    console.error("소재 분석 실패:", err);
    return EMPTY_EXTRACTED_DRAFT;
  }
}
