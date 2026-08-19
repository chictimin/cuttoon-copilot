"use client";

import { useRef, useState } from "react";
import { assertValidPreset, type Preset } from "@/lib/llm/preset-guard";
import { mergeStyleValues } from "@/lib/llm/style-merge";
import {
  analyzeStyle,
  CHARACTER_SHEET_PREVIEW,
  type StyleAnalysisResult,
} from "./mock-style-analysis";
import DetailsStep, { type DetailsFormValue } from "./DetailsStep";

type Step = "upload" | "analyzing" | "result" | "keywords" | "details" | "confirmed";

const ALLOWED_TYPES = ["image/jpeg", "image/png"];
const MAX_FILES = 5;

function validateFiles(files: File[]): { valid: File[]; error: string | null } {
  if (files.length === 0) {
    return { valid: [], error: null };
  }
  if (files.some((file) => !ALLOWED_TYPES.includes(file.type))) {
    return { valid: [], error: "JPG, PNG 파일만 업로드할 수 있어요" };
  }
  if (files.length > MAX_FILES) {
    return { valid: [], error: "최대 5장까지 업로드할 수 있어요" };
  }
  return { valid: files, error: null };
}

export default function OnboardingFlow() {
  const [step, setStep] = useState<Step>("upload");
  const [referenceCount, setReferenceCount] = useState(0);
  const [analysis, setAnalysis] = useState<StyleAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [confirmedName, setConfirmedName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [userKeywords, setUserKeywords] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function runAnalysis(count: number) {
    setError(null);
    setStep("analyzing");
    try {
      const result = await analyzeStyle(count);
      setAnalysis(result);
      setStep("result");
    } catch {
      setError("다시 시도해주세요");
      setStep("upload");
    }
  }

  function handleFilesSelected(selected: FileList | File[]) {
    const list = Array.from(selected);
    const { valid, error: validationError } = validateFiles(list);

    if (validationError) {
      setError(validationError);
      return;
    }
    if (valid.length === 0) {
      return;
    }

    setReferenceCount(valid.length);
    void runAnalysis(valid.length);
  }

  function handleRetry() {
    if (referenceCount === 0) return;
    void runAnalysis(referenceCount);
  }

  function handleConfirmStyle() {
    setStep("details");
  }

  function handleSkipReference() {
    setReferenceCount(0);
    setStep("keywords");
  }

  function handleConfirmKeywords(keywords: string[]) {
    setUserKeywords(keywords);
    const merged = mergeStyleValues(null, keywords);
    const analysisResult: StyleAnalysisResult = {
      style: {
        keywords,
        ...merged,
      },
      characterSheetAsset: "asset://default-character-sheet",
      styleRefAssets: [],
    };
    setAnalysis(analysisResult);
    setStep("details");
  }

  async function handleConfirmDetails(details: DetailsFormValue) {
    if (!analysis) return;

    const preset: Preset = {
      preset_version: "1.1",
      project_name: details.projectName,
      assets: {
        character_sheet: analysis.characterSheetAsset,
        style_refs: analysis.styleRefAssets,
        reference_asset_ids: [],
      },
      style: analysis.style,
      rules: {
        forbidden: details.forbidden,
        cta_format: details.ctaId,
      },
      context: {
        industry: details.industry,
        interests: details.interests,
        age_band: details.ageBand,
        life_stage: details.lifeStage,
        main_subjects: details.mainSubjects,
      },
    };

    try {
      // 스키마와 실제로 맞는지 마지막에 한 번 더 확인 (조립 실수 방지)
      assertValidPreset(preset);
    } catch {
      // mock을 실제 스타일 분석 API로 교체하면 이 경로가 실제로 발생할 수 있다
      // (PR #22 리뷰, chictimin). 검증 실패를 그냥 던지면 "프리셋 확정" 버튼이 반응
      // 없는 것처럼 보이므로, Result 단계로 되돌려 "다시 뽑기"로 복구하게 한다.
      setError("분석 결과에 문제가 있어요. 다시 뽑아주세요");
      setStep("result");
      return;
    }

    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/preset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preset),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "저장에 실패했어요. 다시 시도해주세요");
        return;
      }

      const { presetId } = await res.json();
      // 세션 화면이 어느 프리셋으로 시작할지 알아야 해서 id만 남긴다.
      window.sessionStorage.setItem("cuttoon:preset-id", presetId);
      setConfirmedName(preset.project_name);
      setStep("confirmed");
    } catch {
      setError("저장에 실패했어요. 다시 시도해주세요");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      {step === "upload" && (
        <UploadStep
          error={error}
          isDragging={isDragging}
          fileInputRef={fileInputRef}
          onDragStateChange={setIsDragging}
          onFilesSelected={handleFilesSelected}
          onSkipReference={handleSkipReference}
        />
      )}
      {step === "analyzing" && <AnalyzingStep />}
      {step === "result" && analysis && (
        <ResultStep
          analysis={analysis}
          error={error}
          onRetry={handleRetry}
          onConfirm={handleConfirmStyle}
        />
      )}
      {step === "keywords" && (
        <KeywordsStep onConfirm={handleConfirmKeywords} />
      )}
      {step === "details" && (
        <DetailsStep onConfirm={handleConfirmDetails} error={error} saving={saving} />
      )}
      {step === "confirmed" && (
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-xl font-semibold">프리셋이 저장되었습니다</h1>
          <p className="text-sm text-zinc-500">
            &ldquo;{confirmedName}&rdquo; 프로젝트가 준비됐어요
          </p>
        </div>
      )}
    </main>
  );
}

function UploadStep({
  error,
  isDragging,
  fileInputRef,
  onDragStateChange,
  onFilesSelected,
  onSkipReference,
}: {
  error: string | null;
  isDragging: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onDragStateChange: (dragging: boolean) => void;
  onFilesSelected: (files: FileList | File[]) => void;
  onSkipReference: () => void;
}) {
  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-4 text-center">
      <h1 className="text-xl font-semibold">
        프로젝트 이름을 만들어볼까요?
      </h1>
      <p className="text-sm text-zinc-500">
        인스타에 올릴 컷툰 스타일이 될 거예요
      </p>

      {error && (
        <p className="w-full rounded-md bg-red-50 px-4 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <label
        onDragOver={(e) => {
          e.preventDefault();
          onDragStateChange(true);
        }}
        onDragLeave={() => onDragStateChange(false)}
        onDrop={(e) => {
          e.preventDefault();
          onDragStateChange(false);
          onFilesSelected(e.dataTransfer.files);
        }}
        className={`flex h-64 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed transition-colors ${
          isDragging
            ? "border-zinc-800 bg-zinc-50"
            : "border-zinc-300 hover:border-zinc-400"
        }`}
      >
        <span className="text-sm text-zinc-600">
          클릭하거나 이미지를 끌어다 놓으세요
        </span>
        <span className="text-xs text-zinc-400">JPG·PNG, 최대 5장</span>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) onFilesSelected(e.target.files);
            e.target.value = "";
          }}
        />
      </label>

      <button
        type="button"
        onClick={onSkipReference}
        className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50"
      >
        레퍼런스 건너뛰기
      </button>
    </div>
  );
}

function AnalyzingStep() {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-700" />
      <p className="text-base font-medium">스타일을 살펴보고 있어요...</p>
      <p className="text-sm text-zinc-500">회사만의 그림체를 기억해둘게요</p>
    </div>
  );
}

const BACKGROUND_DENSITY_LABEL: Record<string, string> = {
  none: "배경 없음",
  low: "배경 단순",
  medium: "배경 보통",
  high: "배경 풍부",
};

const SATURATION_LABEL: Record<string, string> = {
  pastel: "파스텔",
  vivid: "선명한",
  muted: "차분한",
};

function ResultStep({
  analysis,
  error,
  onRetry,
  onConfirm,
}: {
  analysis: StyleAnalysisResult;
  error: string | null;
  onRetry: () => void;
  onConfirm: () => void;
}) {
  const { style } = analysis;

  return (
    <div className="flex w-full max-w-3xl flex-col items-center gap-6 text-center">
      <h1 className="text-xl font-semibold">이런 스타일로 만들었어요</h1>

      {error && (
        <p className="w-full max-w-md rounded-md bg-red-50 px-4 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
        <figure className="flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URI placeholder, next/image 불필요 */}
          <img
            src={CHARACTER_SHEET_PREVIEW}
            alt="캐릭터 시트"
            className="aspect-square w-full rounded-lg object-cover"
          />
          <figcaption className="text-sm text-zinc-500">캐릭터 시트</figcaption>
        </figure>

        <figure className="flex flex-col items-center gap-2">
          <div className="grid aspect-square w-full grid-cols-2 gap-1 overflow-hidden rounded-lg">
            {style.palette.map((color) => (
              <div key={color} style={{ backgroundColor: color }} />
            ))}
          </div>
          <figcaption className="text-sm text-zinc-500">
            색감 팔레트 · {SATURATION_LABEL[style.saturation] ?? style.saturation}
          </figcaption>
        </figure>

        <figure className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-lg bg-zinc-100 p-4">
          <span className="text-sm text-zinc-600">
            {BACKGROUND_DENSITY_LABEL[style.background_density] ?? style.background_density}
          </span>
          <span className="text-xs text-zinc-400">선 굵기: {style.line_weight}</span>
          <span className="text-xs text-zinc-400">비율: {style.character_ratio}</span>
          <span className="text-xs text-zinc-400">말풍선: {style.bubble_style}</span>
          <figcaption className="text-sm text-zinc-500">배경 톤</figcaption>
        </figure>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50"
        >
          다시 뽑기
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
        >
          이걸로 할게
        </button>
      </div>
    </div>
  );
}

function KeywordsStep({
  onConfirm,
}: {
  onConfirm: (keywords: string[]) => void;
}) {
  const [input, setInput] = useState("");

  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-4">
      <h1 className="text-xl font-semibold">
        스타일을 설명해주세요
      </h1>
      <p className="text-sm text-zinc-500">
        쉼표로 구분된 단어들을 입력하세요
      </p>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="예: pastel, 2head, rounded, vivid"
        className="w-full rounded-md border border-zinc-300 p-3 text-sm"
        rows={4}
      />

      <button
        type="button"
        onClick={() => {
          const keywords = input.split(",").map(k => k.trim()).filter(k => k);
          if (keywords.length > 0) {
            onConfirm(keywords);
          }
        }}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
      >
        계속
      </button>
    </div>
  );
}
