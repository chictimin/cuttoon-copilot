import { NextRequest, NextResponse } from "next/server";
import { generateCut, generateCharacterSheet } from "@/lib/openai/generate";
import type { Preset } from "@/lib/llm/preset-guard";

interface GenerateRequest {
  kind: "cut" | "character-sheet";
  prompt?: string;
  preset?: Preset;
  previousResponseId?: string;
  referenceAssets?: string[];
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as GenerateRequest;

    if (!body.kind) {
      return NextResponse.json(
        { error: "kind은 필수입니다 (cut | character-sheet)" },
        { status: 400 }
      );
    }

    let result: { asset: string; responseId?: string };

    if (body.kind === "character-sheet") {
      result = await generateCharacterSheet(body.preset);
    } else if (body.kind === "cut") {
      result = await generateCut({
        storyboard: undefined,
        preset: body.preset,
        referenceAssets: body.referenceAssets || [],
        previousResponseId: body.previousResponseId,
      });
    } else {
      return NextResponse.json(
        { error: `알 수 없는 kind: ${body.kind}` },
        { status: 400 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("이미지 생성 에러:", error);
    return NextResponse.json(
      { error: "이미지 생성 실패" },
      { status: 500 }
    );
  }
}
