/**
 * Issue #5: 3턴 브레인스토밍 — 소재에서 주인공·조연·흐름 선택지 생성
 *
 * PRD.md 6절:
 * - 최대 3턴, 매 턴 선택지 3개 + "직접 쓸게" + "알아서 해줘"
 * - 소재에 이미 정보가 있으면 해당 턴은 건너뛴다
 * - 종료 판정은 "필수 슬롯이 전부 찼는가"로 결정적이어야 한다
 */

export interface BrainstormTurn {
  key: "protagonist" | "supporting" | "flow";
  question: string;
  options: string[];
}

// draft storyboard의 필드만 필요하므로 간단하게 정의
interface DraftStoryboard {
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
    "options": ["선택지1", "선택지2", "혼자 진행 (조연 없음)"]
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
- supporting: 조연 3가지 옵션 (반드시 "혼자 진행 (조연 없음)" 포함)
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

  return parsed;
}
