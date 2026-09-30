/**
 * P0 스파이크 — 캐릭터 동일성 + 말풍선 억제 검증
 *
 * 흐름: 캐릭터 시트 1장(Images API) → 컷 2장 체이닝(Responses API)
 * 총 3회 API 호출. 결과는 scripts/output/ 에 저장.
 *
 * 실행: npx tsx scripts/p0-spike.ts
 * 환경: OPENAI_API_KEY in .env
 */

import OpenAI from "openai";
import sharp from "sharp";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

process.loadEnvFile();
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const OUTPUT_DIR = join(import.meta.dirname, "output");
const OUTPUT_SIZE = 1024;
mkdirSync(OUTPUT_DIR, { recursive: true });

async function resizeToOutput(base64: string): Promise<string> {
  const buf = Buffer.from(base64, "base64");
  const resized = await sharp(buf)
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: "cover" })
    .png()
    .toBuffer();
  return resized.toString("base64");
}

function save(name: string, base64: string) {
  const buf = Buffer.from(base64, "base64");
  const path = join(OUTPUT_DIR, name);
  writeFileSync(path, buf);
  console.log(`  → ${path} (${(buf.length / 1024).toFixed(0)}KB)`);
}

// --- Step 1: 캐릭터 시트 생성 (Images API, gpt-image-1) ---

async function generateCharacterSheet(): Promise<string> {
  console.log("\n[1/3] 캐릭터 시트 생성 (gpt-image-1)...");

  const prompt = `Character reference sheet for a webtoon/comic series.

Style: medium line weight, pastel colors, 2.5head body proportions.
Color palette: #4A8EC2, #FFD5D5, #2D3436, #FFFFFF.
Style keywords: cute, friendly, healthcare mascot.

Character: A friendly female fitness trainer in her 30s wearing a polo shirt and sneakers.
She works with elderly clients for physical therapy exercises.

Draw the character in THREE poses on a single white-background sheet:
1. Front view, neutral expression, standing
2. 3/4 view, smiling and waving
3. Side view, demonstrating a stretch

No speech bubbles. No text. No letters. No words.
Clean reference sheet layout with clear separation between poses.`;

  const response = await client.images.generate({
    model: "gpt-image-1",
    prompt,
    n: 1,
    size: "1024x1024",
  });

  const data = response.data?.[0];
  if (!data?.b64_json) throw new Error("캐릭터 시트 응답 없음");

  console.log("  리사이즈 → 1024×1024...");
  const resized = await resizeToOutput(data.b64_json);
  save("01-character-sheet.png", resized);
  return resized;
}

// --- Step 2: 표지 컷 생성 (Responses API, reference 주입) ---

async function generateCoverCut(
  characterSheetB64: string
): Promise<{ imageB64: string; responseId: string }> {
  console.log("\n[2/3] 표지 컷 생성 (Responses API + reference 주입)...");

  const response = await client.responses.create({
    model: "gpt-4o",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `You are generating a 4-panel webtoon cut. This is CUT 1 (the cover).

Use the attached character sheet as the ONLY character reference.
Draw the SAME character from the sheet — same face, same outfit, same proportions.

Scene: The trainer character is greeting an elderly person at their front door, smiling warmly.
Shot type: waist up. Camera angle: eye level.
Time: morning, warm golden light.
Background: simple residential entrance, low detail.

STRICT RULES:
- NO speech bubbles
- NO text or letters of any kind
- NO watermarks
- Reserve the BOTTOM area empty for text overlay later
- Style: pastel colors, 2.5head proportions, medium line weight`,
          },
          {
            type: "input_image",
            image_url: `data:image/png;base64,${characterSheetB64}`,
            detail: "high",
          },
        ],
      },
    ],
    tools: [{ type: "image_generation", size: "1024x1024", quality: "high" }],
  });

  let imageB64 = "";
  for (const item of response.output) {
    if (item.type === "image_generation_call" && item.result) {
      imageB64 = item.result;
      break;
    }
  }
  if (!imageB64) throw new Error("표지 컷 이미지 없음");

  console.log("  리사이즈 → 1024×1024...");
  const resized = await resizeToOutput(imageB64);
  save("02-cover-cut.png", resized);
  return { imageB64: resized, responseId: response.id };
}

// --- Step 3: 2번 컷 생성 (체이닝) ---

async function generateCut2(
  characterSheetB64: string,
  previousResponseId: string
): Promise<string> {
  console.log("\n[3/3] 2번 컷 생성 (previous_response_id 체이닝)...");

  const response = await client.responses.create({
    model: "gpt-4o",
    previous_response_id: previousResponseId,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `CUT 2 of the same webtoon. Continue with the SAME character from the previous cut.

Scene: The trainer is demonstrating a simple arm stretch exercise to the elderly person.
The elderly person is sitting in a chair, following along.
Shot type: full body. Camera angle: eye level.
Time: morning, indoor.
Background: simple living room, low detail.

STRICT RULES:
- SAME character as cut 1 — same face, outfit, proportions
- NO speech bubbles
- NO text or letters of any kind
- Reserve the BOTTOM area empty for text overlay
- Style: pastel colors, 2.5head proportions, medium line weight`,
          },
          {
            type: "input_image",
            image_url: `data:image/png;base64,${characterSheetB64}`,
            detail: "high",
          },
        ],
      },
    ],
    tools: [{ type: "image_generation", size: "1024x1024", quality: "high" }],
  });

  let imageB64 = "";
  for (const item of response.output) {
    if (item.type === "image_generation_call" && item.result) {
      imageB64 = item.result;
      break;
    }
  }
  if (!imageB64) throw new Error("2번 컷 이미지 없음");

  console.log("  리사이즈 → 1024×1024...");
  const resized = await resizeToOutput(imageB64);
  save("03-cut2.png", resized);
  return resized;
}

// --- Main ---

async function main() {
  console.log("=== P0 스파이크: 캐릭터 동일성 + 말풍선 억제 검증 ===");
  console.log(`API key: ...${process.env.OPENAI_API_KEY?.slice(-6) ?? "MISSING"}`);
  console.log(`출력: ${OUTPUT_DIR}/\n`);

  const sheet = await generateCharacterSheet();
  const { responseId } = await generateCoverCut(sheet);
  await generateCut2(sheet, responseId);

  console.log("\n=== 완료 ===");
  console.log("확인 포인트:");
  console.log("  1. 01-character-sheet.png의 캐릭터와 02, 03의 캐릭터가 같은 인물인가?");
  console.log("  2. 02, 03에 말풍선이나 글자가 없는가?");
  console.log("  3. 하단 영역이 텍스트 오버레이용으로 비어있는가?");
}

main().catch((err) => {
  console.error("\n스파이크 실패:", err.message ?? err);
  process.exit(1);
});
