"use client";

import { useEffect, useState } from "react";
import { assertStoryboardRuntimeInvariants } from "@/lib/llm/storyboard-guard";
import {
  assembleStoryboard,
  BRAINSTORM_TURNS,
  type BrainstormAnswers,
  type BrainstormTurn,
} from "./mock-brainstorm";
import { generateChainedCuts, generateCoverVariants, type GeneratedCut } from "./mock-generate";
import type { Cut, Storyboard } from "./storyboard-types";

type Step = "subject" | "brainstorm" | "assembling" | "cover" | "generating" | "cuts" | "saved";

const NO_SUPPORTING_OPTION = "혼자 진행 (조연 없음)";

function promptForCut(subject: string, cut: Cut): string {
  return `${subject} · ${cut.narrative_beat} · ${cut.shot_type}/${cut.camera_angle}`;
}

export default function SessionFlow({ sessionId }: { sessionId: string }) {
  const [step, setStep] = useState<Step>("subject");
  const [subject, setSubject] = useState("");
  const [turnIndex, setTurnIndex] = useState(0);
  const [answers, setAnswers] = useState<Partial<Record<BrainstormTurn["key"], string>>>({});
  const [customText, setCustomText] = useState("");
  const [isCustomOpen, setIsCustomOpen] = useState(false);
  const [storyboard, setStoryboard] = useState<Storyboard | null>(null);
  const [coverVariants, setCoverVariants] = useState<GeneratedCut[] | null>(null);
  const [editingCutIndex, setEditingCutIndex] = useState<number | null>(null);
  const [draftCaption, setDraftCaption] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function recordAnswer(value: string) {
    const key = BRAINSTORM_TURNS[turnIndex].key;
    const next = { ...answers, [key]: value };
    setAnswers(next);
    setIsCustomOpen(false);
    setCustomText("");

    if (turnIndex < BRAINSTORM_TURNS.length - 1) {
      setTurnIndex(turnIndex + 1);
    } else {
      setStep("assembling");
    }
  }

  useEffect(() => {
    if (step !== "assembling") return;
    const full: BrainstormAnswers = {
      protagonist: answers.protagonist ?? BRAINSTORM_TURNS[0].options[0],
      supporting:
        answers.supporting && answers.supporting !== NO_SUPPORTING_OPTION
          ? answers.supporting
          : null,
      flow: answers.flow ?? BRAINSTORM_TURNS[2].options[0],
    };

    const timer = setTimeout(() => {
      setStoryboard(assembleStoryboard(subject, full));
      setStep("cover");
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    if (step !== "cover" || !storyboard || coverVariants) return;
    void loadCoverVariants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, storyboard]);

  async function loadCoverVariants() {
    if (!storyboard) return;
    const prompt = promptForCut(storyboard.subject, storyboard.cuts[0]);
    const variants = await generateCoverVariants(prompt);
    setCoverVariants(variants);
  }

  async function handleSelectCover(variant: GeneratedCut) {
    if (!storyboard) return;
    const updated: Storyboard = {
      ...storyboard,
      cuts: storyboard.cuts.map((cut, i) =>
        i === 0 ? { ...cut, generated_image: variant.image, prompt_used: variant.prompt } : cut
      ),
    };
    setStoryboard(updated);
    setStep("generating");

    const remaining = updated.cuts.slice(1);
    const generated = await generateChainedCuts(
      remaining.map((cut) => promptForCut(updated.subject, cut))
    );

    setStoryboard((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        cuts: prev.cuts.map((cut, i) =>
          i === 0
            ? cut
            : {
                ...cut,
                generated_image: generated[i - 1].image,
                prompt_used: generated[i - 1].prompt,
              }
        ),
      };
    });
    setStep("cuts");
  }

  function updateCaption(index: number, text: string) {
    setStoryboard((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        cuts: prev.cuts.map((cut, i) =>
          i === index ? { ...cut, caption: { ...cut.caption, text } } : cut
        ),
      };
    });
  }

  async function handleSave() {
    if (!storyboard) return;

    try {
      assertStoryboardRuntimeInvariants(storyboard.cuts);
    } catch {
      setSaveError("스토리보드에 문제가 있어요. 처음부터 다시 시도해주세요");
      return;
    }

    // 온보딩(POST /api/preset)이 남겨둔 값 — 세션 생성에 둘 다 필요하다 (issue #41).
    const projectId = window.sessionStorage.getItem("cuttoon:project-id");
    const presetId = window.sessionStorage.getItem("cuttoon:preset-id");
    if (!projectId || !presetId) {
      setSaveError("먼저 온보딩에서 프로젝트를 만들어주세요");
      return;
    }

    setSaveError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, presetId, storyboard }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setSaveError(body?.error ?? "저장에 실패했어요. 다시 시도해주세요");
        return;
      }

      const { sessionId: savedId } = await res.json();
      // URL의 id는 세션이 생기기 전 임시값이었을 수 있으니 실제 id로 맞춘다 —
      // 에디터 화면이 이 id로 세션을 조회한다. history API로 바꾸는 이유는
      // useRouter().replace()가 이 라우트를 다시 서버에서 그려서 컴포넌트를
      // 리마운트시키고 "저장됨" 화면을 보여주기 전에 상태를 초기화해버리기 때문.
      if (savedId !== sessionId) {
        window.history.replaceState(null, "", `/session/${savedId}`);
      }
      setStep("saved");
    } catch {
      setSaveError("저장에 실패했어요. 다시 시도해주세요");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      {step === "subject" && (
        <div className="flex w-full max-w-xl flex-col items-center gap-4 text-center">
          <h1 className="text-xl font-semibold">이번엔 어떤 이야기를 만들어볼까요?</h1>
          <p className="text-sm text-zinc-500">
            이 컷툰 한 편의 실제 소재를 한 줄로 적어주세요
          </p>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="예: 무릎 연골 나감"
            className="w-full rounded-md border border-zinc-300 px-4 py-3 text-sm"
          />
          <button
            type="button"
            disabled={subject.trim().length === 0}
            onClick={() => setStep("brainstorm")}
            className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
          >
            다음
          </button>
        </div>
      )}

      {step === "brainstorm" && (
        <div className="flex w-full max-w-xl flex-col items-center gap-4 text-center">
          <p className="text-xs text-zinc-400">
            {turnIndex + 1} / {BRAINSTORM_TURNS.length}
          </p>
          <h1 className="text-xl font-semibold">{BRAINSTORM_TURNS[turnIndex].question}</h1>

          <div className="flex w-full flex-col gap-2">
            {BRAINSTORM_TURNS[turnIndex].options.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => recordAnswer(option)}
                className="rounded-md border border-zinc-300 px-4 py-2.5 text-sm hover:bg-zinc-50"
              >
                {option}
              </button>
            ))}
          </div>

          {isCustomOpen ? (
            <div className="flex w-full gap-2">
              <input
                autoFocus
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={customText.trim().length === 0}
                onClick={() => recordAnswer(customText.trim())}
                className="shrink-0 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                확인
              </button>
            </div>
          ) : (
            <div className="flex gap-2 text-sm">
              <button
                type="button"
                onClick={() => setIsCustomOpen(true)}
                className="rounded-md border border-dashed border-zinc-300 px-3 py-1.5 text-zinc-600 hover:bg-zinc-50"
              >
                직접 쓸게
              </button>
              <button
                type="button"
                onClick={() => recordAnswer(BRAINSTORM_TURNS[turnIndex].options[0])}
                className="rounded-md border border-dashed border-zinc-300 px-3 py-1.5 text-zinc-500 hover:bg-zinc-50"
              >
                알아서 해줘
              </button>
            </div>
          )}
        </div>
      )}

      {step === "assembling" && <Spinner text="이야기를 엮고 있어요..." />}
      {step === "cover" && !coverVariants && <Spinner text="표지 3안을 그리고 있어요..." />}
      {step === "generating" && <Spinner text="나머지 컷을 완성하고 있어요..." />}

      {step === "cover" && coverVariants && storyboard && (
        <div className="flex w-full max-w-3xl flex-col items-center gap-6 text-center">
          <h1 className="text-xl font-semibold">마음에 드는 표지를 골라주세요</h1>
          <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
            {coverVariants.map((variant, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleSelectCover(variant)}
                className="overflow-hidden rounded-lg border border-zinc-200 hover:border-zinc-900"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- mock placeholder, next/image 불필요 */}
                <img src={variant.image} alt={`표지 안 ${i + 1}`} className="aspect-square w-full object-cover" />
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setCoverVariants(null);
              void loadCoverVariants();
            }}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50"
          >
            다시 뽑기
          </button>
        </div>
      )}

      {step === "cuts" && storyboard && (
        <div className="flex w-full max-w-4xl flex-col items-center gap-6">
          <h1 className="text-xl font-semibold">4컷이 완성됐어요</h1>
          {saveError && (
            <p className="w-full max-w-md rounded-md bg-red-50 px-4 py-2 text-sm text-red-600">
              {saveError}
            </p>
          )}
          <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
            {storyboard.cuts.map((cut, i) => (
              <div key={cut.cut_index} className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3">
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element -- mock placeholder, next/image 불필요 */}
                  <img
                    src={cut.generated_image ?? ""}
                    alt={`컷 ${cut.cut_index}`}
                    className="aspect-square w-full rounded-md object-cover"
                  />
                  <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
                    {cut.cut_index}컷 · {cut.narrative_beat}
                  </span>
                </div>
                {editingCutIndex === i ? (
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      value={draftCaption}
                      onChange={(e) => setDraftCaption(e.target.value)}
                      className="flex-1 rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        updateCaption(i, draftCaption);
                        setEditingCutIndex(null);
                      }}
                      className="shrink-0 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white"
                    >
                      완료
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingCutIndex(i);
                      setDraftCaption(cut.caption.text);
                    }}
                    className="rounded-md border border-transparent px-2 py-1.5 text-left text-sm hover:border-zinc-200 hover:bg-zinc-50"
                  >
                    {cut.caption.text}
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      )}

      {step === "saved" && storyboard && (
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-xl font-semibold">저장됐습니다</h1>
          <p className="text-sm text-zinc-500">&ldquo;{storyboard.subject}&rdquo; 4컷이 준비됐어요</p>
        </div>
      )}
    </main>
  );
}

function Spinner({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-700" />
      <p className="text-base font-medium">{text}</p>
    </div>
  );
}
