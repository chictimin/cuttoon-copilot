/**
 * 사용자가 업로드한 참고 이미지들에서 스타일을 추출한다.
 * GPT-4o Vision API를 사용하여 이미지 분석.
 */

export interface StyleExtractionResult {
  line_weight: "thin" | "medium" | "thick";
  saturation: "pastel" | "vivid" | "muted";
  character_ratio: "2head" | "2.5head" | "3head" | "realistic";
  background_density: "none" | "low" | "medium" | "high";
  bubble_style: "rounded" | "rect" | "cloud";
  palette: string[];
}

export async function extractStyle(imageBuffers: Buffer[]): Promise<StyleExtractionResult> {
  if (imageBuffers.length === 0) {
    throw new Error("분석할 이미지가 없습니다");
  }

  const content = [
    ...imageBuffers.map((buffer) => ({
      type: "image_url" as const,
      image_url: {
        url: `data:image/jpeg;base64,${buffer.toString("base64")}`,
      },
    })),
    {
      type: "text" as const,
      text: `이 이미지들의 그림체를 분석해서 다음 JSON을 반환하세요. 다른 텍스트는 없이 JSON만.

{
  "line_weight": "thin" | "medium" | "thick",
  "saturation": "pastel" | "vivid" | "muted",
  "character_ratio": "2head" | "2.5head" | "3head" | "realistic",
  "background_density": "none" | "low" | "medium" | "high",
  "bubble_style": "rounded" | "rect" | "cloud",
  "palette": ["#RRGGBB", "#RRGGBB", "#RRGGBB", "#RRGGBB"]
}

분석 기준:
- line_weight: 선의 굵기 (얇음/중간/굵음)
- saturation: 색감의 채도 (파스텔/선명한/차분한)
- character_ratio: 캐릭터의 머리 비율
- background_density: 배경의 복잡도
- bubble_style: 말풍선 스타일 (둥근/사각/구름)
- palette: 이미지에서 가장 자주 나타나는 4가지 주요 색상 (16진수 HEX)

영어로 된 값들만 정확히 반환하세요.`,
    },
  ];

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
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content,
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`OpenAI API 에러: ${error.error?.message ?? "알 수 없는 에러"}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const content_text = data.choices[0]?.message.content;
  if (!content_text) {
    throw new Error("OpenAI에서 응답을 받지 못했습니다");
  }

  const jsonMatch = content_text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("OpenAI 응답을 파싱할 수 없습니다");
  }

  const parsed = JSON.parse(jsonMatch[0]);

  const result: StyleExtractionResult = {
    line_weight: parsed.line_weight || "medium",
    saturation: parsed.saturation || "vivid",
    character_ratio: parsed.character_ratio || "2head",
    background_density: parsed.background_density || "low",
    bubble_style: parsed.bubble_style || "rounded",
    palette: parsed.palette || ["#4A90E2", "#50C878", "#FFD700", "#FF6B6B"],
  };

  return result;
}

/**
 * 캐릭터 시트를 생성하기 위한 프롬프트를 조립한다.
 */
export function generateCharacterSheetPrompt(): string {
  return `사용자의 컷툰에 등장할 주요 캐릭터들의 특징을 나열해주세요.
캐릭터별로 다음을 포함해야 합니다:
- 이름
- 역할 (주인공/지도자/조연)
- 외형적 특징
- 성격
- 의상 색상`;
}
