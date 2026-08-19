/**
 * issue #5: 3턴 브레인스토밍 — 소재에서 주인공·조연·흐름 선택지 생성
 *
 * PRD.md 6절: "최대 3턴, 매 턴 선택지 3개 + 직접 쓸게 + 알아서 해줘"
 */

export interface BrainstormTurn {
  key: "protagonist" | "supporting" | "flow";
  question: string;
  options: string[];
}

/**
 * 소재를 받아서 3턴 브레인스토밍 턴을 생성한다.
 * GPT-4를 사용하여 소재에 맞는 주인공, 조연, 흐름 선택지를 만든다.
 */
export async function generateBrainstormTurns(subject: string): Promise<BrainstormTurn[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY 환경 변수가 없습니다");
  }

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
          content: `한국 보건/의료 컷툰의 소재가 주어졌을 때, 3턴 브레인스토밍 선택지를 생성하세요.

소재: "${subject}"

3턴의 JSON을 반환하세요. 다른 텍스트는 없이 JSON만.

[
  {
    "key": "protagonist",
    "question": "주인공은 누구인가요?",
    "options": ["선택지1", "선택지2", "선택지3"]
  },
  {
    "key": "supporting",
    "question": "함께 등장할 인물이 있나요?",
    "options": ["선택지1", "선택지2", "혼자 진행 (조연 없음)"]
  },
  {
    "key": "flow",
    "question": "어떤 흐름으로 풀어볼까요?",
    "options": ["선택지1", "선택지2", "선택지3"]
  }
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
    const error = await response.json();
    throw new Error(
      `OpenAI API 에러: ${error.error?.message ?? "알 수 없는 에러"}`
    );
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = data.choices[0]?.message.content;
  if (!content) {
    throw new Error("OpenAI에서 응답을 받지 못했습니다");
  }

  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("OpenAI 응답을 파싱할 수 없습니다");
  }

  const parsed = JSON.parse(jsonMatch[0]) as BrainstormTurn[];

  // 검증
  if (!Array.isArray(parsed) || parsed.length !== 3) {
    throw new Error("브레인스토밍 턴 개수가 맞지 않습니다");
  }

  for (const turn of parsed) {
    if (!turn.key || !turn.question || !Array.isArray(turn.options) || turn.options.length !== 3) {
      throw new Error("브레인스토밍 턴 형식이 맞지 않습니다");
    }
  }

  return parsed;
}
