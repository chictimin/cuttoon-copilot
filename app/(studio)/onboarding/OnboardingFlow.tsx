"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { assertValidPreset, type Preset } from "@/lib/llm/preset-guard";
import { resolvePresetStyle } from "@/lib/llm/style-resolve";
import { analyzeStyle, type StyleAnalysisResult } from "./style-analysis";
import DetailsStep, { type DetailsFormValue } from "./DetailsStep";
import MascotStep, { type MascotValue } from "./MascotStep";
import { bubbleStyleLabel, characterRatioLabel, lineWeightLabel } from "../ui-labels";

type Step = "upload" | "analyzing" | "result" | "details" | "mascot" | "confirmed";

const ALLOWED_TYPES = ["image/jpeg", "image/png"];
const MAX_FILES = 5;

// DetailsStep.tsx의 industry·forbidden 등과 같은 관례(쉼표 구분 자유 텍스트).
// K1: trim 뒤 글자 그대로 비교(대소문자 구분)해 중복을 제거한다. 첫 등장 순서 유지.
function parseTags(text: string): string[] {
  const seen = new Set();
  const out = [];
  for (const tag of text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (!seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

// #238: 영문 사전에 없어 입력하신 그대로 전달되는 그림체 키워드. enum으로 이미 적용된 단어는
// resolvePresetStyle이 enum_applied로 따로 표시하므로(#255) unmapped만 모은다. 같은 단어는 한 번만.
function unmappedKeywordWords(keywordsText: string): string[] {
  const { findings } = resolvePresetStyle({
    extracted: null,
    userKeywords: parseTags(keywordsText),
    forbidden: [],
  });
  return Array.from(
    new Set(
      findings
        .filter((f) => f.field === "style.keywords" && f.status === "unmapped")
        .map((f) => f.original)
    )
  );
}

// #238: 확인 팝업의 "다시 보지 않기". 브라우저 단위로 localStorage에 둔다. 저장소를 못 쓰는 환경
// (사생활 보호 모드 등)에서는 조용히 포기하고 매번 물어본다.
const SKIP_UNMAPPED_CONFIRM_KEY = "cuttoon:skip-unmapped-confirm";

function readSkipUnmappedConfirm(): boolean {
  try {
    return window.localStorage.getItem(SKIP_UNMAPPED_CONFIRM_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSkipUnmappedConfirm(): void {
  try {
    window.localStorage.setItem(SKIP_UNMAPPED_CONFIRM_KEY, "1");
  } catch {
    // 저장하지 못해도 이번 진행에는 영향이 없다.
  }
}

// 최대 3개까지 보여 주고 넘으면 "외 N개".
function formatUnmappedWords(words: string[]): string {
  const shown = words.slice(0, 3).join(", ");
  return words.length > 3 ? `${shown} 외 ${words.length - 3}개` : shown;
}

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
  const router = useRouter();
  const [step, setStep] = useState<Step>("upload");
  const [referenceFiles, setReferenceFiles] = useState<File[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<StyleAnalysisResult | null>(null);
  // #151: 레퍼런스 없이 진행. analysis는 null로 두고(가짜 분석값 금지) 이 상태로만
  // 구분한다 — 저장은 extracted: null, style_refs: []로 간다.
  const [skippedReference, setSkippedReference] = useState(false);
  // issue #122: style.keywords는 레퍼런스 추출로는 채워지지 않는다 — 온보딩에서
  // 직접 입력받는 게 스키마가 정의한 두 번째 입력 경로다. PRD 4절 딸깍 원칙의
  // 예외로 자유 타이핑을 허용한다(chictimin 확인, #122).
  const [keywordsText, setKeywordsText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [confirmedName, setConfirmedName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // #150: 상세 정보를 확정한 뒤 마스코트 단계를 거쳐 시트를 만든다 — 그 사이 값을 든다.
  const [pendingDetails, setPendingDetails] = useState<DetailsFormValue | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function runAnalysis(files: File[]) {
    setError(null);
    setStep("analyzing");
    try {
      const result = await analyzeStyle(files);
      setAnalysis(result);
      setSkippedReference(false);
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

    setReferenceFiles(valid);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(valid[0]);
    });
    void runAnalysis(valid);
  }

  // #151: 업로드 단계의 "레퍼런스 없이 진행" — 이미지 분석 호출 없이 결과 단계로.
  function handleSkipReference() {
    setError(null);
    setAnalysis(null);
    setSkippedReference(true);
    setStep("result");
  }

  // 스킵 결과 화면의 "레퍼런스 올리기" — 업로드 단계로 되돌아간다.
  function handleBackToUpload() {
    setError(null);
    setSkippedReference(false);
    setStep("upload");
  }

  function handleRetry() {
    if (referenceFiles.length === 0) return;
    void runAnalysis(referenceFiles);
  }

  function handleConfirmStyle() {
    setStep("details");
  }

  function handleConfirmDetails(details: DetailsFormValue) {
    setError(null);
    setPendingDetails(details);
    setStep("mascot");
  }

  // #150 C6-ui: 마스코트를 확정(또는 건너뜀)하면 시트 생성·프리셋 저장으로 간다.
  // 건너뛰면 mascot 필드를 아예 빼고 보낸다(빈 문자열 금지, #200 계약 2절).
  async function handleConfirmMascot(mascot: MascotValue | null) {
    if (!pendingDetails) return;
    await createProject(pendingDetails, mascot);
  }

  async function createProject(details: DetailsFormValue, mascot: MascotValue | null) {
    if (!analysis && !skippedReference) return;

    setError(null);
    setSaving(true);

    // 캐릭터 시트는 style(분석 단계)과 context(이 폼)가 둘 다 있어야 만들 수
    // 있어서 여기서 생성한다 — 프로젝트 생성 시 1회(#19 결정: 세션마다 다시
    // 만들지 않음).
    // #151: 병합·영문 힌트 치환은 resolvePresetStyle 한 곳에서. 원본 키워드·금지
    // 요소는 그대로 보존하고(#233 계약 (a)) 힌트는 별도 필드로 둔다. 같은 style을
    // 시트 요청과 저장 프리셋 양쪽에 쓴다. 레퍼런스를 건너뛰면 extracted는 null.
    const userKeywords = parseTags(keywordsText);
    const resolved = resolvePresetStyle({
      extracted: analysis?.style ?? null,
      userKeywords,
      forbidden: details.forbidden,
    });
    const styleWithKeywords: Preset["style"] = {
      ...resolved.style,
      keywords: userKeywords,
      keyword_hints: resolved.keywordHints,
    };
    // 시트 요청과 저장 프리셋이 같은 rules를 쓴다(#233 계약 — 원본 forbidden + forbidden_hints).
    const rules: Preset["rules"] = {
      forbidden: details.forbidden,
      forbidden_hints: resolved.forbiddenHints,
      cta_format: details.ctaId,
      cta_strength: details.ctaStrength,
    };

    let characterSheetAsset: string;
    try {
      const sheetRes = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "character_sheet",
          preset: {
            style: styleWithKeywords,
            rules,
            context: {
              industry: details.industry,
              age_band: details.ageBand,
              life_stage: details.lifeStage,
              main_subjects: details.mainSubjects,
            },
            ...(mascot ? { mascot } : {}),
          },
        }),
      });
      if (!sheetRes.ok) {
        const body = await sheetRes.json().catch(() => null);
        setError(body?.error ?? "캐릭터 시트 생성에 실패했어요. 다시 시도해주세요");
        return;
      }
      const { result } = (await sheetRes.json()) as { result: { asset: string } };
      characterSheetAsset = result.asset;
    } catch {
      setError("캐릭터 시트 생성에 실패했어요. 다시 시도해주세요");
      return;
    } finally {
      setSaving(false);
    }

    const preset: Preset = {
      preset_version: "1.1",
      project_name: details.projectName,
      assets: {
        character_sheet: characterSheetAsset,
        style_refs: analysis?.styleRefAssets ?? [],
        reference_asset_ids: [],
        // #209: 확인 API 응답을 그대로 저장한다(가공 금지). 비웠으면 키를 뺀다.
        ...(details.font ? { font: details.font } : {}),
      },
      style: styleWithKeywords,
      rules,
      context: {
        industry: details.industry,
        interests: details.interests,
        age_band: details.ageBand,
        life_stage: details.lifeStage,
        main_subjects: details.mainSubjects,
      },
      ...(mascot ? { mascot } : {}),
    };

    // 스키마와 실제로 맞는지 마지막에 한 번 더 확인 (조립 실수 방지)
    assertValidPreset(preset);

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

      const { presetId, projectId } = await res.json();
      // 세션 화면(handleSave, issue #41)이 projectId·presetId 둘 다 필요하다.
      // ProjectList.tsx의 handleStartSession과 같은 관례 — 여기서 놓치면
      // "다음" 버튼을 눌러도 세션 저장이 "먼저 온보딩에서 프로젝트를 만들어주세요"로
      // 실패한다(issue #134에서 발견된 단절).
      window.sessionStorage.setItem("cuttoon:project-id", projectId);
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
          onSkip={handleSkipReference}
        />
      )}
      {step === "analyzing" && <AnalyzingStep />}
      {step === "result" && (analysis || skippedReference) && (
        <ResultStep
          analysis={analysis}
          previewUrl={previewUrl}
          keywordsText={keywordsText}
          onKeywordsTextChange={setKeywordsText}
          onRetry={handleRetry}
          onBackToUpload={handleBackToUpload}
          onConfirm={handleConfirmStyle}
        />
      )}
      {step === "details" && (
        <DetailsStep onConfirm={handleConfirmDetails} error={error} saving={saving} />
      )}
      {step === "mascot" && pendingDetails && (
        <MascotStep
          industry={pendingDetails.industry}
          interests={pendingDetails.interests}
          keywords={parseTags(keywordsText)}
          saving={saving}
          error={error}
          onConfirm={(mascot) => void handleConfirmMascot(mascot)}
        />
      )}
      {step === "confirmed" && (
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="text-xl font-semibold">프로젝트 설정이 저장되었습니다</h1>
          <p className="text-sm text-zinc-500">
            &ldquo;{confirmedName}&rdquo; 프로젝트가 준비됐어요
          </p>
          <button
            type="button"
            onClick={() => router.push(`/session/${crypto.randomUUID()}`)}
            className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
          >
            지금 바로 컷툰 만들기
          </button>
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
  onSkip,
}: {
  error: string | null;
  isDragging: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onDragStateChange: (dragging: boolean) => void;
  onFilesSelected: (files: FileList | File[]) => void;
  onSkip: () => void;
}) {
  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-4 text-center">
      <h1 className="text-xl font-semibold">
        컷툰 그림체를 알려주세요
      </h1>
      <p className="text-sm text-zinc-500">
        인스타에 올릴 컷툰의 그림체가 될 거예요
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
        onClick={onSkip}
        className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50"
      >
        참고 그림 없이 진행
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
  previewUrl,
  keywordsText,
  onKeywordsTextChange,
  onRetry,
  onBackToUpload,
  onConfirm,
}: {
  /** null이면 레퍼런스를 건너뛴 것 — 기본 그림체를 보여준다. */
  analysis: StyleAnalysisResult | null;
  previewUrl: string | null;
  keywordsText: string;
  onKeywordsTextChange: (text: string) => void;
  onRetry: () => void;
  onBackToUpload: () => void;
  onConfirm: () => void;
}) {
  const skipped = analysis === null;
  // #238: 영문 사전에 없는 키워드 안내. 입력 중에는 다시 계산하지 않고, 화면에 들어올 때와
  // "이걸로 할게"를 누를 때만 계산한다. 입력칸 아래 한 줄 안내는 그대로 두고, 확정할 때 안내할
  // 단어가 있으면 확인 팝업(수정하기 / 이대로 진행, "다시 보지 않기")을 띄운다(chictimin 10/6 제안,
  // 같은 버튼을 두 번 누르게 하던 방식을 대체). 입력을 고치면 한 줄 안내는 사라진다.
  const [notice, setNotice] = useState<{ text: string; words: string[] } | null>(() => {
    const words = unmappedKeywordWords(keywordsText);
    return words.length > 0 ? { text: keywordsText, words } : null;
  });
  const [confirmWords, setConfirmWords] = useState<string[] | null>(null);
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const [skipConfirm, setSkipConfirm] = useState(readSkipUnmappedConfirm);
  const keywordsInputRef = useRef<HTMLInputElement>(null);
  function handleKeywordsChange(text: string) {
    setNotice(null);
    onKeywordsTextChange(text);
  }
  function handleConfirm() {
    const words = unmappedKeywordWords(keywordsText);
    if (words.length > 0 && !skipConfirm) {
      setNotice({ text: keywordsText, words });
      setConfirmWords(words);
      return;
    }
    onConfirm();
  }
  // [수정하기]·Esc: 팝업을 닫고 키워드 입력칸으로 돌아간다.
  function handleEditKeywords() {
    setConfirmWords(null);
    keywordsInputRef.current?.focus();
  }
  function handleProceedAnyway() {
    if (dontAskAgain) {
      writeSkipUnmappedConfirm();
      setSkipConfirm(true);
    }
    setConfirmWords(null);
    onConfirm();
  }
  // 스킵이면 키워드 입력 전 기본값(#151). 키워드가 enum과 일치하면 저장 값은 달라질 수 있다.
  const style =
    analysis?.style ??
    resolvePresetStyle({ extracted: null, userKeywords: [], forbidden: [] }).style;

  return (
    <div className="flex w-full max-w-3xl flex-col items-center gap-6 text-center">
      <h1 className="text-xl font-semibold">
        {skipped ? "참고 그림 없이 기본 그림체로 시작해요" : "이런 스타일로 만들었어요"}
      </h1>
      {skipped && (
        <p className="text-sm text-zinc-500">
          아래 그림체 키워드를 적으면 기본값 대신 반영돼요. 키워드에 따라 달라질 수 있어요
        </p>
      )}

      <div
        className={`grid w-full grid-cols-1 gap-4 ${skipped ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}
      >
        {!skipped && (
        <figure className="flex flex-col items-center gap-2">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- 사용자가 방금 올린 파일의 blob URL, next/image 불필요
            <img
              src={previewUrl}
              alt="업로드한 참고 그림"
              className="aspect-square w-full rounded-lg object-cover"
            />
          ) : (
            <div className="aspect-square w-full rounded-lg bg-zinc-100" />
          )}
          <figcaption className="text-sm text-zinc-500">
            업로드한 참고 그림 · 캐릭터 시트는 다음 단계 확정 후 생성돼요
          </figcaption>
        </figure>
        )}

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
          <span className="text-xs text-zinc-400">선 굵기: {lineWeightLabel(style.line_weight)}</span>
          <span className="text-xs text-zinc-400">비율: {characterRatioLabel(style.character_ratio)}</span>
          <span className="text-xs text-zinc-400">말풍선: {bubbleStyleLabel(style.bubble_style)}</span>
          <figcaption className="text-sm text-zinc-500">배경 톤</figcaption>
        </figure>
      </div>

      <div className="flex w-full max-w-xl flex-col gap-2 text-left">
        <label htmlFor="style_keywords" className="text-sm font-medium text-zinc-700">
          그림체 키워드 <span className="font-normal text-zinc-400">(쉼표로 구분, 건너뛰기 가능)</span>
        </label>
        <input
          id="style_keywords"
          ref={keywordsInputRef}
          value={keywordsText}
          onChange={(e) => handleKeywordsChange(e.target.value)}
          placeholder="예: 수채화, 따뜻한, 손그림"
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
        {notice && notice.words.length > 0 && (
          <p className="text-xs text-zinc-500">
            영문 사전에 없는 단어는 입력하신 그대로 전달돼요: {formatUnmappedWords(notice.words)}
          </p>
        )}
        <p className="text-xs text-zinc-400">
          {skipped
            ? "참고 그림이 없을수록 그림체를 알려주는 단서예요. 느낌을 직접 적어주세요"
            : "참고 그림에서 못 뽑아낸 그림체 느낌을 직접 적어주세요. 위 분석 결과에 더해져요"}
        </p>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={skipped ? onBackToUpload : onRetry}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50"
        >
          {skipped ? "참고 그림 올리기" : "다시 뽑기"}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
        >
          이걸로 할게
        </button>
      </div>

      {confirmWords && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onKeyDown={(e) => {
            if (e.key === "Escape") handleEditKeywords();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="unmapped-confirm-title"
            className="w-full max-w-md rounded-lg bg-white p-6 text-left shadow-lg"
          >
            <h2 id="unmapped-confirm-title" className="text-base font-semibold">
              그림체 키워드를 확인해 주세요
            </h2>
            <p className="mt-2 text-sm text-zinc-600">
              영문 사전에 없는 단어는 그대로 전달돼서, 그림체에 의도와 다르게 반영될 수 있어요:{" "}
              {formatUnmappedWords(confirmWords)}
            </p>
            <label className="mt-4 flex items-center gap-2 text-sm text-zinc-600">
              <input
                type="checkbox"
                checked={dontAskAgain}
                onChange={(e) => setDontAskAgain(e.target.checked)}
                className="size-4 rounded border-zinc-300"
              />
              다시 보지 않기
            </label>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                autoFocus
                onClick={handleEditKeywords}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
              >
                수정하기
              </button>
              <button
                type="button"
                onClick={handleProceedAnyway}
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50"
              >
                이대로 진행
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
