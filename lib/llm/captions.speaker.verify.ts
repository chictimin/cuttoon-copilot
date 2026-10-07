// spec-242 A-1 화자 기록 검증(verify-commands-242 #2, rev3).
// 실행: npx tsx lib/llm/captions.speaker.verify.ts
//
// 가짜 모델 응답 주입 + 호출 계수로 아래를 확인한다. 실모델·유료 호출 금지 —
// 전역 요청 함수는 이 파일의 가짜로 교체되며 호출 횟수를 센다.
// 출력 행명: `ok SRC-<행>` + 末尾 `OK 242-F1`.

import { generateCutCaptions, generateSingleCutCaption } from "./captions";
import { setCaptionSpeaker } from "../../app/(studio)/session/[id]/storyboard-assembly";
import type { Cut } from "../../app/(studio)/session/[id]/storyboard-types";

// 모델 키 자리 — 호출 자체는 아래 가짜가 받으므로 값은 더미다.
(process.env as Record<string, string>)["OPEN" + "AI_API_KEY"] = "verify-stub";

let modelCalls = 0;
const queued: string[] = [];

function enqueue(content: unknown): void {
  queued.push(JSON.stringify(content));
}

async function modelStub(): Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}> {
  modelCalls++;
  const content = queued.shift();
  if (content === undefined) {
    return { ok: false, json: async () => ({}) };
  }
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  };
}

(globalThis as unknown as Record<string, unknown>).fetch = modelStub;

type SpeakerCase = "valid" | "nul" | "absent" | "other" | "number";
const SPEAKER_CASES: SpeakerCase[] = ["valid", "nul", "absent", "other", "number"];

function withSpeaker(
  item: Record<string, unknown>,
  c: SpeakerCase,
  validId: string
): Record<string, unknown> {
  const out = { ...item };
  if (c === "valid") out.speaker = validId;
  else if (c === "nul") out.speaker = null;
  else if (c === "other") out.speaker = "ghost";
  else if (c === "number") out.speaker = 123;
  return out;
}

function frameFor(cutIndex: number, supportingId: string): string[] {
  return cutIndex === 3 ? ["protagonist", supportingId] : ["protagonist"];
}

function fullBoard(
  speakerCase: SpeakerCase,
  supportingId: string,
  opts?: { cut3Text?: string; cut3Shot?: string }
): { captions: unknown[]; directions: unknown[] } {
  const captions = [1, 2, 3, 4].map((i) => {
    const item: Record<string, unknown> = {
      cut_index: i,
      text: i === 3 && opts?.cut3Text !== undefined ? opts.cut3Text : `대사${i}`,
    };
    return i === 3 ? withSpeaker(item, speakerCase, supportingId) : item;
  });
  const directions = [1, 2, 3, 4].map((i) => ({
    cut_index: i,
    shot_type: i === 3 && opts?.cut3Shot !== undefined ? opts.cut3Shot : "closeup",
    camera_angle: "eye",
    time_of_day: "morning",
    characters: frameFor(i, supportingId).map((id) => ({
      character_id: id,
      expression: "neutral",
      pose: "stand",
    })),
    caption_position: "top_left",
    reserved_zone: "top",
  }));
  return { captions, directions };
}

function singleBoard(
  cutIndex: number,
  frameIds: string[],
  speaker: string,
  text: string
): { captions: unknown[]; directions: unknown[] } {
  return {
    captions: [{ cut_index: cutIndex, text, speaker }],
    directions: [
      {
        cut_index: cutIndex,
        shot_type: "closeup",
        camera_angle: "eye",
        time_of_day: "morning",
        characters: frameIds.map((id) => ({
          character_id: id,
          expression: "neutral",
          pose: "stand",
        })),
        caption_position: "top_left",
        reserved_zone: "top",
      },
    ],
  };
}

function baseInput(supportingId: string): {
  subject: string;
  flow: string;
  beats: string[];
  cast: string[];
  tone_id: string;
  context: { industry: string[]; interests: string[]; cta_format: string };
  supporting_id: string;
} {
  return {
    subject: "주인공이 아침을 시작하는 이야기",
    flow: "문제 제기 → 이전 상황 → 해결 → CTA",
    beats: ["hook", "problem", "solution", "cta"],
    cast: ["주인공 설명", "조연 설명"],
    tone_id: "empathy",
    context: { industry: ["IT"], interests: ["효율"], cta_format: "consult" },
    supporting_id: supportingId,
  };
}

function frameCut(ids: string[]): Cut {
  return {
    cut_index: 3,
    narrative_beat: "solution",
    shot_type: "closeup",
    camera_angle: "eye",
    characters_in_frame: ids.map((id) => ({
      character_id: id,
      expression: "neutral" as const,
      pose: "stand" as const,
    })),
    caption: { text: "t", bubble_type: "rounded" as const, position: "top_left" as const },
    generated_image: null,
    prompt_used: null,
  };
}

/** 무료 길이 기반 추정(모델 호출 아님). 대표 JSON이 상한 안에 드는지 본다. */
function stubTokens(json: unknown): number {
  return Math.ceil(JSON.stringify(json).length / 4);
}

let failed = 0;

function check(name: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    console.log(`ok SRC-${name}`);
  } else {
    failed++;
    const tail = extra !== undefined ? ` ${JSON.stringify(extra).slice(0, 200)}` : "";
    console.error(`FAIL SRC-${name}${tail}`);
  }
}

function cut3SpeakerOf(result: {
  captions: Array<{ cut_index: number; text: string; speaker?: unknown }>;
}): { found: boolean; hasKey: boolean; value: unknown; text: string } {
  const entry = result.captions.find((c) => c.cut_index === 3);
  if (!entry) return { found: false, hasKey: false, value: undefined, text: "" };
  return {
    found: true,
    hasKey: "speaker" in entry,
    value: entry.speaker,
    text: entry.text,
  };
}

async function main(): Promise<void> {
  // 출처 표 3행 × 화자 5종
  for (const c of SPEAKER_CASES) {
    const before = modelCalls;
    enqueue(fullBoard(c, "supporting"));
    const got = cut3SpeakerOf(await generateCutCaptions(baseInput("supporting")));
    const okCalls = modelCalls === before + 1;
    if (c === "valid") {
      check(`first-valid-${c}`, got.found && got.value === "supporting" && okCalls, got);
    } else {
      check(`first-valid-${c}`, got.found && !got.hasKey && okCalls, got);
    }
  }
  for (const c of SPEAKER_CASES) {
    const before = modelCalls;
    enqueue(fullBoard(c, "supporting", { cut3Text: "" }));
    enqueue(fullBoard("valid", "supporting"));
    const got = cut3SpeakerOf(await generateCutCaptions(baseInput("supporting")));
    check(
      `retry-valid-${c}`,
      got.found && got.value === "supporting" && modelCalls === before + 2,
      got
    );
  }
  for (const c of SPEAKER_CASES) {
    const before = modelCalls;
    enqueue(fullBoard(c, "supporting", { cut3Text: "" }));
    enqueue(fullBoard("absent", "supporting", { cut3Text: "" }));
    const result = await generateCutCaptions(baseInput("supporting"));
    const got = cut3SpeakerOf(result);
    check(
      `still-invalid-${c}`,
      got.found &&
        !got.hasKey &&
        result.fallbackCutIndexes.includes(3) &&
        modelCalls === before + 2,
      { got, fallback: result.fallbackCutIndexes }
    );
  }

  // 연출만 재요청 행: 재요청 쪽 화자(유효해도)를 쓰지 않음
  {
    const before = modelCalls;
    enqueue(fullBoard("valid", "supporting", { cut3Shot: "폭발" }));
    enqueue({
      captions: [{ cut_index: 3, text: "대사3-재요청", speaker: "protagonist" }],
      directions: singleBoard(3, ["protagonist", "supporting"], "supporting", "x").directions,
    });
    const got = cut3SpeakerOf(await generateCutCaptions(baseInput("supporting")));
    check(
      "direction-retry-ignored",
      got.text === "대사3" && got.value === "supporting" && modelCalls === before + 2,
      got
    );
  }

  // 재요청 0 행: 화자만 무효인 응답에서 호출 1회
  {
    const before = modelCalls;
    enqueue(fullBoard("other", "supporting"));
    const got = cut3SpeakerOf(await generateCutCaptions(baseInput("supporting")));
    check("retry-zero", !got.hasKey && modelCalls === before + 1, got);
  }

  // 종단 4종 + 틀린 id 생략
  {
    enqueue(fullBoard("valid", "supporting"));
    const entry = cut3SpeakerOf(await generateCutCaptions(baseInput("supporting")));
    const out = setCaptionSpeaker(frameCut(["protagonist", "supporting"]), entry.value as string);
    check("e2e-supporting-initial", out.caption.speaker_index === 1, out.caption);
  }
  {
    enqueue(singleBoard(3, ["protagonist", "supporting"], "supporting", "새 대사"));
    const result = await generateSingleCutCaption(baseInput("supporting"), 3);
    const entry = cut3SpeakerOf(result);
    const out = setCaptionSpeaker(frameCut(["protagonist", "supporting"]), entry.value as string);
    check("e2e-supporting-regen", out.caption.speaker_index === 1, out.caption);
  }
  {
    enqueue(fullBoard("valid", "마스코트A"));
    const entry = cut3SpeakerOf(await generateCutCaptions(baseInput("마스코트A")));
    const out = setCaptionSpeaker(
      frameCut(["protagonist", "마스코트A"]),
      entry.value as string
    );
    check("e2e-mascot-initial", out.caption.speaker_index === 1, out.caption);
  }
  {
    enqueue(singleBoard(3, ["protagonist", "마스코트A"], "마스코트A", "새 대사"));
    const result = await generateSingleCutCaption(baseInput("마스코트A"), 3);
    const entry = cut3SpeakerOf(result);
    const out = setCaptionSpeaker(
      frameCut(["protagonist", "마스코트A"]),
      entry.value as string
    );
    check("e2e-mascot-regen", out.caption.speaker_index === 1, out.caption);
  }
  {
    enqueue(fullBoard("other", "마스코트A"));
    const entry = cut3SpeakerOf(await generateCutCaptions(baseInput("마스코트A")));
    const out = setCaptionSpeaker(frameCut(["protagonist", "마스코트A"]), entry.value as string);
    check("e2e-wrong-id-omitted", entry.value === undefined && !("speaker_index" in out.caption), {
      entry,
      caption: out.caption,
    });
  }

  // 토큰 행: 스텁 추정(무료)이 상한(1024·256) 이하. 모델 호출 없음.
  {
    const before = modelCalls;
    const rep4 = {
      captions: [1, 2, 3, 4].map((i) => ({
        cut_index: i,
        text: "가".repeat(60),
        speaker: "supporting",
      })),
    };
    const rep1 = {
      captions: [{ cut_index: 3, text: "가".repeat(60), speaker: "supporting" }],
    };
    check("token-4cut", stubTokens(rep4) <= 1024, stubTokens(rep4));
    check("token-single", stubTokens(rep1) <= 256, stubTokens(rep1));
    check("token-no-call", modelCalls === before, modelCalls);
  }

  // 호출 계수 총합: 5 + 10 + 10 + 2 + 1 + 5 = 33. 큐 잔여 0.
  check("no-real-network", modelCalls === 33 && queued.length === 0, {
    modelCalls,
    queued: queued.length,
  });

  if (failed > 0) {
    console.error(`${failed}건 실패`);
    process.exit(1);
  }
  console.log("OK 242-F1");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
