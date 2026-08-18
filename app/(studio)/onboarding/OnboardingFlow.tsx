"use client";

import { useEffect, useRef, useState } from "react";
import { analyzeStyle, type StyleAnalysisResult } from "@/lib/gemini/generate";
import type { Preset } from "./types";

type Step = "upload" | "analyzing" | "result";

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
  const [referenceUrls, setReferenceUrls] = useState<string[]>([]);
  const [result, setResult] = useState<StyleAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      referenceUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [referenceUrls]);

  async function runAnalysis(refs: string[]) {
    setError(null);
    setStep("analyzing");
    try {
      const analysis = await analyzeStyle(refs);
      setResult(analysis);
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

    referenceUrls.forEach((url) => URL.revokeObjectURL(url));
    const urls = valid.map((file) => URL.createObjectURL(file));

    setReferenceUrls(urls);
    setIsConfirmed(false);
    void runAnalysis(urls);
  }

  function handleRetry() {
    if (referenceUrls.length === 0) return;
    void runAnalysis(referenceUrls);
  }

  function handleConfirm() {
    if (!result) return;
    const preset: Preset = {
      reference_images: referenceUrls,
      character_sheet: result.characterSheet,
      color_palette: result.colorPalette,
      background_tone: result.backgroundTone,
    };
    // TODO(A③): app/api/preset 연동 전까지 임시로 세션에 저장.
    window.sessionStorage.setItem("cuttoon:onboarding-preset", JSON.stringify(preset));
    setIsConfirmed(true);
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
        />
      )}
      {step === "analyzing" && <AnalyzingStep />}
      {step === "result" && result && (
        <ResultStep
          result={result}
          isConfirmed={isConfirmed}
          onRetry={handleRetry}
          onConfirm={handleConfirm}
        />
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
}: {
  error: string | null;
  isDragging: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onDragStateChange: (dragging: boolean) => void;
  onFilesSelected: (files: FileList | File[]) => void;
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

function ResultStep({
  result,
  isConfirmed,
  onRetry,
  onConfirm,
}: {
  result: StyleAnalysisResult;
  isConfirmed: boolean;
  onRetry: () => void;
  onConfirm: () => void;
}) {
  const cards: { label: string; src: string }[] = [
    { label: "캐릭터 시트", src: result.characterSheet },
    { label: "색감 팔레트", src: result.colorPalette },
    { label: "배경 톤", src: result.backgroundTone },
  ];

  return (
    <div className="flex w-full max-w-3xl flex-col items-center gap-6 text-center">
      <h1 className="text-xl font-semibold">이런 스타일로 만들었어요</h1>

      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <figure key={card.label} className="flex flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- data URI placeholder, next/image 불필요 */}
            <img
              src={card.src}
              alt={card.label}
              className="aspect-square w-full rounded-lg object-cover"
            />
            <figcaption className="text-sm text-zinc-500">
              {card.label}
            </figcaption>
          </figure>
        ))}
      </div>

      {isConfirmed ? (
        <p className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          프리셋이 저장되었습니다
        </p>
      ) : (
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
      )}
    </div>
  );
}
