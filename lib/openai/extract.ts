import OpenAI from "openai";
import sharp from "sharp";
import { uploadAsset } from "../asset-store";
import { OUTPUT_SIZE, ratioClause } from "./generate";
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

레퍼런스 이미지에 웹툰/카툰 요소(캐릭터·선화)가 없어도(예: 사진) 위 6개 필드에
가장 가까운 값을 추정해서 채우세요. 항목을 비우거나 다른 키를 쓰지 마세요.

반드시 이 필드만 포함한 JSON 하나로만 답하세요. 설명 문장은 쓰지 마세요.`;

const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

// 레퍼런스 이미지에 카툰 요소가 없으면(사진 등) 모델이 6개 필드를 다 못 채운
// JSON을 낼 수 있다 — 실측: 크래시로 확인(#113 판정 케이스 1, ResultStep의
// style.palette.map이 undefined에서 죽음). response_format: json_object는 유효한
// JSON만 보장하고 필드 존재·타입은 보장하지 않는다.
//
// 여기서 걸러내는 이유는 호출부(ResultStep 등)가 이 결과가 항상 완전하다고
// 가정하고 바로 쓰기 때문이다 — 그 가정을 지키는 쪽이 호출부를 전부 방어 코드로
// 채우는 것보다 싸다.
const DEFAULT_STYLE: StyleExtractionResult = {
  line_weight: "medium",
  saturation: "vivid",
  character_ratio: "2.5head",
  background_density: "low",
  bubble_style: "rounded",
  palette: ["#2b2b2b", "#f5f0e8", "#e8734a", "#4a90a4"],
};

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function normalizeStyle(raw: unknown): StyleExtractionResult {
  const obj = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};

  const palette =
    Array.isArray(obj.palette) &&
    obj.palette.length > 0 &&
    obj.palette.every((c) => typeof c === "string" && HEX_COLOR_PATTERN.test(c))
      ? (obj.palette as string[])
      : DEFAULT_STYLE.palette;

  return {
    line_weight: pickEnum(obj.line_weight, ["thin", "medium", "thick"], DEFAULT_STYLE.line_weight),
    saturation: pickEnum(obj.saturation, ["pastel", "vivid", "muted"], DEFAULT_STYLE.saturation),
    character_ratio: pickEnum(
      obj.character_ratio,
      ["2head", "2.5head", "3head", "realistic"],
      DEFAULT_STYLE.character_ratio
    ),
    background_density: pickEnum(
      obj.background_density,
      ["none", "low", "medium", "high"],
      DEFAULT_STYLE.background_density
    ),
    bubble_style: pickEnum(obj.bubble_style, ["rounded", "rect", "cloud"], DEFAULT_STYLE.bubble_style),
    palette,
  };
}

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
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }
  return normalizeStyle(parsed);
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

  // 컷 프롬프트(generate.ts buildCutPrompt)와 같은 지시를 받아야 한다. 시트는 매 컷
  // reference 로 주입되는 기준물이라, 비율 지시가 갈라지면 기준물과 컷이 서로 다른
  // 비율로 그려져 P0 게이트 1(캐릭터 동일성)의 "비율" 항목을 오독하게 된다 (#113).
  //
  // ratioClause() 는 B① 이 export 한 것이다(PR #130, 8fc0dbc) — 폴백 규칙(기본값
  // 적용 순서 포함) 자체를 공유해 규칙이 두 파일에 복사되는 것을 막는다. 이 자리에
  // 규칙을 인라인으로 다시 쓰면 세 번째로 갈라진다 — #126 에서 생기고 #129 에서
  // 발견된 것과 같은 실수다.
  const ratio = ratioClause(s.character_ratio);

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
