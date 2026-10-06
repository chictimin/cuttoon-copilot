import OpenAI from "openai";
import sharp from "sharp";
import { uploadAsset } from "../asset-store";
import { OUTPUT_SIZE, activeMascot, ratioClause } from "./generate";
import type { GeneratedImageResult } from "./provider";
import { imageQuality, imageSetting, logImageSetting } from "./image-setting";
import { generateWithComfyui } from "./comfyui";

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
  // #151: keyword_hints 는 keywords 를 어휘 사전으로 바꾼 영문 힌트(선택). 있으면
  // 프롬프트에 이쪽을 쓴다 — generate.ts buildCutPrompt 와 같은 규칙.
  style: StyleExtractionResult & { keywords: string[]; keyword_hints?: string[] };
  context: {
    industry: string[];
    age_band: string[];
    life_stage: string[];
    main_subjects: string[];
  };
  // #150: 프로젝트 고정 마스코트(선택). 있으면 시트가 독자 프로필 대신 이 인물을 그린다.
  mascot?: { label?: string; description?: string };
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
  const keywords = s.keyword_hints ?? s.keywords;
  const keywordsStr = keywords?.length ? keywords.join(", ") : "default comic style";
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

  // #150: 마스코트가 있으면 시트는 그 인물을 그린다 — preset.schema.json 의 시트 계약
  // ("프로젝트의 고정 마스코트 한 명")대로다. 컷 쪽(buildCutPrompt)이 같은 activeMascot()
  // 으로 "시트 인물과 같은 사람" 문장을 켜므로 판정이 두 파일에서 갈라지지 않는다.
  // 마스코트가 없으면 기존처럼 preset.context(타깃 독자 프로필)로 그린다 — 기존 프리셋은
  // 그대로 동작한다.
  const mascot = activeMascot(preset);
  const characterLine = mascot
    ? `Character: ${mascot.description}. This is the project's recurring mascot — draw this same person in all three poses.`
    : `Character context: A person typical of the ${industryStr} field, targeting ${ageStr} age group, ${lifeStr} life stage.`;

  // #243: 세 포즈를 정사각형에 나란히 그리다 인물을 너무 크게 잡아, 정면은 왼쪽·옆모습은
  // 오른쪽 가장자리에서 잘렸다(1024×1024 요청·리사이즈라 후처리 크롭은 없음 — 모델 구도).
  // 시트는 매 컷 reference 라 옆모습이 잘리면 그 정보가 빠진다. Layout 문장으로 가로 한 줄
  // 배치와 여백을 요구한다(여백 문장만으로는 정사각형에서 3/3 잘림 — TASK-003b 실측이라
  // 캔버스도 가로로 바꿨다, SHEET_REQUEST_SIZE). 캔버스 크기는 문장에 적지 않는다 —
  // ComfyUI 경로는 정사각형으로 그대로 생성한다. 마스코트·일반 시트 공통 템플릿이다.
  return `Character reference sheet for a webtoon/comic series.

Style: ${s.line_weight ?? "medium"} line weight, ${s.saturation ?? "vivid"} colors, ${ratio}.
Color palette: ${paletteStr}.
Style keywords: ${keywordsStr}.

${characterLine}

Draw the character in THREE poses on a single white-background sheet:
1. Front view, neutral expression, standing
2. 3/4 view, smiling
3. Side view, walking

Layout: place the three full-body figures side by side in one horizontal row, evenly spaced. Each figure must fit completely inside the canvas with clear white margin on all sides — above the head, below the feet, at the left and right edges of the canvas, and between figures. No part of any figure (hair, hands, feet) may touch or be cut off by the canvas edge.

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
//
// #243: 시트는 가로(SHEET_REQUEST_SIZE)로 생성해 저장은 OUTPUT_SIZE 정사각형으로
// 맞춘다. cover 로 맞추면 양쪽 인물이 다시 잘리므로 contain + 흰 배경(시트 배경색과
// 같음)으로 위아래에 띠를 둔다 — 원본 픽셀은 줄어들 뿐 잘리지 않는다. 저장 크기가
// 그대로라 시트를 reference 로 읽는 컷 쪽과 저장 코드는 영향이 없다. 컷용 리사이즈
// (generate.ts resizeToOutput, cover·reserved_zone)와는 규칙이 달라 이름도 다르게 둔다.
// export 하는 이유: prompt.demo.ts 가 로컬 합성 이미지로 contain 결과를 확인한다.
const SHEET_BACKGROUND = { r: 255, g: 255, b: 255, alpha: 1 } as const;

export async function fitSheetToOutput(
  base64: string
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const original = Buffer.from(base64, "base64");
  try {
    const buffer = await sharp(original)
      .resize(OUTPUT_SIZE.width, OUTPUT_SIZE.height, { fit: "contain", background: SHEET_BACKGROUND })
      .flatten({ background: SHEET_BACKGROUND })
      .png()
      .toBuffer();
    return { buffer, width: OUTPUT_SIZE.width, height: OUTPUT_SIZE.height };
  } catch (err) {
    console.error("[extract] fitSheetToOutput 실패 — 원본 버퍼로 폴백 (#104)", err);
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

// #243: 시트만 가로로 생성한다(gpt-image-1 지원 크기 중 가로). 정사각형에 전신 세 명을
// 나란히 그리면 여백을 요구해도 양쪽 끝이 잘렸다(TASK-003b, 3/3). 저장은
// fitSheetToOutput 이 OUTPUT_SIZE 로 맞춘다. 컷·표지 크기(OUTPUT_SIZE)와는 별개 값이다.
export const SHEET_REQUEST_SIZE = { width: 1536, height: 1024 } as const;

async function generateSheetWithOpenAI(prompt: string, quality: "low" | undefined): Promise<string> {
  const response = await client.images.generate({
    model: "gpt-image-1",
    prompt,
    n: 1,
    size: `${SHEET_REQUEST_SIZE.width}x${SHEET_REQUEST_SIZE.height}` as const,
    ...(quality && { quality }),
  });

  const data = response.data?.[0];
  if (!data?.b64_json) {
    throw new Error("gpt-image-1 응답에 이미지 데이터가 없음");
  }
  return data.b64_json;
}

export async function generateCharacterSheet(
  preset: PresetInput
): Promise<GeneratedImageResult> {
  const prompt = buildCharacterPrompt(preset);
  // 유료 호출 전에 읽어 모르는 값이면 여기서 멈춘다(#190). 컷과 같은 설정을 따른다 —
  // 시트만 기본 화질이면 저가 QA에서도 시트 비용은 그대로 나간다.
  const setting = imageSetting();
  const quality = imageQuality(setting);
  logImageSetting("character_sheet", setting);

  const b64 =
    setting === "comfyui"
      ? (await generateWithComfyui(prompt, OUTPUT_SIZE)).base64
      : await generateSheetWithOpenAI(prompt, quality);

  // #104: 여기까지 오면 유료 호출은 이미 성공한 뒤다 — 리사이즈가 실패해도
  // 결과를 버리지 않는다. fitSheetToOutput이 실패 시 원본 버퍼 + 실제 메타데이터를
  // 반환하므로 width/height도 실제 값과 어긋나지 않는다.
  const { buffer, width, height } = await fitSheetToOutput(b64);
  const { assetUri } = await uploadAsset(buffer, "image/png", "character-sheet.png");

  return {
    asset: assetUri,
    width,
    height,
    prompt,
  };
}
