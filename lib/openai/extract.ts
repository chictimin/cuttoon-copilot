import OpenAI from "openai";
import sharp from "sharp";
import { OUTPUT_SIZE } from "./generate";
import { uploadAsset } from "../asset-store";
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

function buildCharacterPrompt(preset: PresetInput): string {
  const s = preset.style ?? ({} as PresetInput["style"]);
  const c = preset.context ?? ({} as PresetInput["context"]);

  const paletteStr = (s.palette ?? []).join(", ") || "designer's choice";
  const keywordsStr = s.keywords?.length ? s.keywords.join(", ") : "default comic style";
  const industryStr = c.industry?.length ? c.industry.join(", ") : "general";
  const ageStr = c.age_band?.length ? c.age_band.join(", ") : "all ages";
  const lifeStr = c.life_stage?.length ? c.life_stage.join(", ") : "general";

  return `Character reference sheet for a webtoon/comic series.

Style: ${s.line_weight ?? "medium"} line weight, ${s.saturation ?? "vivid"} colors, ${s.character_ratio ?? "2.5head"} body proportions.
Color palette: ${paletteStr}.
Style keywords: ${keywordsStr}.

Character context: A person typical of the ${industryStr} field, targeting ${ageStr} age group, ${lifeStr} life stage.

Draw the character in THREE poses on a single white-background sheet:
1. Front view, neutral expression, standing
2. 3/4 view, smiling
3. Side view, walking

No speech bubbles. No text. Clean reference sheet layout with clear separation between poses.`;
}

async function resizeToOutput(base64: string): Promise<Buffer> {
  const buf = Buffer.from(base64, "base64");
  return sharp(buf)
    .resize(OUTPUT_SIZE.width, OUTPUT_SIZE.height, { fit: "cover" })
    .png()
    .toBuffer();
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

  const buffer = await resizeToOutput(data.b64_json);
  const { assetUri } = await uploadAsset(buffer, "character-sheet.png");

  return {
    asset: assetUri,
    width: OUTPUT_SIZE.width,
    height: OUTPUT_SIZE.height,
  };
}
