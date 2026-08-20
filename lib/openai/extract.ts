import OpenAI from "openai";
import sharp from "sharp";
import { uploadAsset } from "../asset-store";
import { OUTPUT_SIZE, promptHint } from "./generate";
import type { GeneratedImageResult } from "./provider";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface StyleExtractionResult {
  line_weight: "thin" | "medium" | "thick";
  saturation: "pastel" | "vivid" | "muted";
  character_ratio: "2head" | "2.5head" | "3head" | "realistic";
  background_density: "none" | "low" | "medium" | "high";
  bubble_style: "rounded" | "rect" | "cloud";
  palette: string[];
}

const SYSTEM_PROMPT = `당신은 컷툰 스타일 분석가입니다. 첨부된 레퍼런스 이미지를 분석해서 아래 항목을 정확히 하나씩만 골라 JSON으로 답하세요.

- line_weight: thin | medium | thick (선 굵기)
- saturation: pastel | vivid | muted (전체 채도감)
- character_ratio: 2head | 2.5head | 3head | realistic (2head/2.5head/3head는 두신 비율이 과장된 카툰체, realistic은 실제 인체 비율에 가까운 경우)
- background_density: none | low | medium | high (배경 디테일 정도)
- bubble_style: rounded | rect | cloud (말풍선 모양)
- palette: 이 이미지에서 대표적인 색상 4~6개를 HEX 코드로

반드시 이 필드만 포함한 JSON 하나로만 답하세요. 설명 문장은 쓰지 마세요.`;

export async function extractStyle(refs: Buffer[]): Promise<StyleExtractionResult> {
  const imageMessages = refs.map((buf) => ({
    type: "image_url" as const,
    image_url: {
      url: `data:image/png;base64,${buf.toString("base64")}`,
    },
  }));

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "이 이미지의 스타일을 분석해주세요." },
          ...imageMessages,
        ],
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 300,
  });

  const raw = response.choices[0].message.content ?? "{}";
  return JSON.parse(raw) as StyleExtractionResult;
}

// --- generateCharacterSheet ---

export interface PresetInput {
  style: StyleExtractionResult & { keywords: string[] };
  context: {
    industry: string[];
    age_band: string[];
    life_stage: string[];
    main_subjects: string[];
  };
}

// export 하는 이유: 시트와 컷의 프롬프트가 **문구 수준으로** 같은 스타일 지시를
// 내는지 대조하려면 두 파일에서 실제로 조립한 문자열을 비교해야 한다. #120 의
// checkStyleParity() 는 "컷이 그 필드를 읽는가" 까지만 보고, 그 한계 때문에
// character_ratio 폴백 차이가 두 번 통과했다(#126 → #129). B① 요청에 따라 열어
// 스모크 테스트가 이 함수를 직접 부를 수 있게 한다.
export function buildCharacterPrompt(preset: PresetInput): string {
  // preset 구조를 저장 시점에 검증하는 곳이 아직 없다(route.ts 주석 참고) — 배열
  // 필드가 비어 있거나 아예 빠진 채로 들어와도 여기서 죽지 않게 방어한다.
  const s = preset.style ?? ({} as PresetInput["style"]);
  const c = preset.context ?? ({} as PresetInput["context"]);

  const paletteStr = (s.palette ?? []).join(", ") || "designer's choice";
  const keywordsStr = s.keywords?.length ? s.keywords.join(", ") : "default comic style";
  const industryStr = c.industry?.length ? c.industry.join(", ") : "general";
  const ageStr = c.age_band?.length ? c.age_band.join(", ") : "all ages";
  const lifeStr = c.life_stage?.length ? c.life_stage.join(", ") : "general";

  // 컷 프롬프트(generate.ts buildCutPrompt)와 **표현식까지 같게** 둔다. 시트는 매 컷
  // reference 로 주입되는 기준물이라, 비율 지시가 갈라지면 기준물과 컷이 서로 다른
  // 비율로 그려져 P0 게이트 1(캐릭터 동일성)의 "비율" 항목을 오독하게 된다 (#113).
  //
  // promptHint() 는 B① 이 이 용도로 export 한 것이다 — 두 파일이 vocabulary.json 을
  // 각자 읽으면 폴백 규칙이 갈라진다.
  //
  // 순서가 중요하다: 기본값을 **먼저** 적용한 뒤 힌트를 찾는다. promptHint() 는
  // 값이 없으면 undefined 를 주므로, 힌트 조회를 먼저 하면 미지정 케이스가 토큰
  // 폴백으로 떨어져 서술문을 못 받는다. 힌트를 넣은 이유(모델이 `2head` 같은
  // 토큰을 못 알아듣는다 — #121 실측 4/4 무시)는 기본값에도 그대로 적용된다.
  // B① 도 같은 결론으로 컷 쪽 순서를 맞췄다 (#129).
  const ratioValue = s.character_ratio ?? "2.5head";
  const ratio =
    promptHint("character_ratio", ratioValue) ?? `${ratioValue} body proportions`;

  return `Character reference sheet for a webtoon/comic series.

Style: ${s.line_weight ?? "medium"} line weight, ${s.saturation ?? "vivid"} colors, ${ratio}.
Color palette: ${paletteStr}.
Style keywords: ${keywordsStr}.

Character context: A person typical of the ${industryStr} field, targeting ${ageStr} age group, ${lifeStr} life stage.

Draw the character in THREE poses on a single white-background sheet:
1. Front view, neutral expression, standing
2. 3/4 view, smiling
3. Side view, walking

No speech bubbles. No text. Clean reference sheet layout with clear separation between poses.`;
}

// #19 결정: generateCharacterSheet는 extractStyle과 결합도가 높아(StyleResult를
// 그대로 받음) B②(extract.ts)가 소유한다. ImageProvider 계약(GeneratedImageResult)에
// 맞춰 asset:// 업로드까지 여기서 처리한다 — 호출부(app/api/generate/route.ts)는
// base64를 다루지 않는다.
//
// gpt-image-1이 같은 프롬프트에도 요청한 크기와 다른 실제 크기를 낼 때가 있어
// (generate.ts #20 주석 참고) sharp로 강제 리사이즈해 계약 ④의 width/height를
// 실제 값과 어긋나지 않게 보장한다.
//
// #104: 리사이즈가 실패해도(원본 버퍼로 대체하는 경우) width/height를 OUTPUT_SIZE로
// 그대로 고정하면 메타가 실제 픽셀과 어긋난다 — generate.ts와 동일하게 실패 시
// 실제 메타데이터를 다시 읽어 반환한다.
async function resizeToOutput(
  base64: string
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const original = Buffer.from(base64, "base64");
  try {
    const buffer = await sharp(original)
      .resize(OUTPUT_SIZE.width, OUTPUT_SIZE.height, { fit: "cover" })
      .png()
      .toBuffer();
    return { buffer, width: OUTPUT_SIZE.width, height: OUTPUT_SIZE.height };
  } catch (err) {
    console.error("[extract] resizeToOutput 실패 — 원본 버퍼로 폴백 (#104)", err);
    const meta = await sharp(original)
      .metadata()
      .catch(() => undefined);
    return {
      buffer: original,
      width: meta?.width ?? OUTPUT_SIZE.width,
      height: meta?.height ?? OUTPUT_SIZE.height,
    };
  }
}

export async function generateCharacterSheet(
  preset: PresetInput
): Promise<GeneratedImageResult> {
  const prompt = buildCharacterPrompt(preset);

  const response = await client.images.generate({
    model: "gpt-image-1",
    prompt,
    n: 1,
    size: `${OUTPUT_SIZE.width}x${OUTPUT_SIZE.height}` as const,
  });

  const data = response.data?.[0];
  if (!data?.b64_json) {
    throw new Error("gpt-image-1 응답에 이미지 데이터가 없음");
  }

  // #104: 여기까지 오면 유료 호출은 이미 성공한 뒤다 — 리사이즈가 실패해도
  // 결과를 버리지 않는다. resizeToOutput이 실패 시 원본 버퍼 + 실제 메타데이터를
  // 반환하므로 width/height도 실제 값과 어긋나지 않는다.
  const { buffer, width, height } = await resizeToOutput(data.b64_json);
  const { assetUri } = await uploadAsset(buffer, "image/png", "character-sheet.png");

  return {
    asset: assetUri,
    width,
    height,
    prompt,
  };
}
