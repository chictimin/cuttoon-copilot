"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { assertStoryboardRuntimeInvariants } from "@/lib/llm/storyboard-guard";
import type { Preset } from "@/lib/llm/preset-guard";
// 타입만 가져온다 — lib/llm/brainstorm.ts 는 OPENAI_API_KEY 를 쓰는 서버 모듈이라
// 런타임 import 는 클라이언트로 넘어오면 안 된다.
import type { BrainstormTurn } from "@/lib/llm/brainstorm";
import {
  assembleStoryboard,
  FLOW_OPTIONS,
  FLOW_QUESTION,
  type BrainstormAnswers,
} from "./storyboard-assembly";
import { generateChainedCuts, generateCoverVariants, type GeneratedCut } from "./generate-client";
import type { Cut, Storyboard } from "./storyboard-types";

type Step = "subject" | "brainstorm" | "assembling" | "cover" | "generating" | "cuts" | "saved";

const NO_SUPPORTING_OPTION = "혼자 진행 (조연 없음)";

const TURN_ORDER: BrainstormTurn["key"][] = ["protagonist", "supporting", "flow"];

// LLM 응답을 화면이 쓸 수 있는 형태로 맞춘다. 모델 응답은 순서·개수·문자열을
// 보장하지 않으므로 세 가지를 여기서 고정한다.
//
// 1. flow 턴은 LLM 선택지를 버리고 로컬 FLOW_OPTIONS 로 교체한다. 흐름 선택은
//    자유 텍스트가 아니라 NarrativeBeat 템플릿을 고르는 것이라(스키마의
//    narrative_beat enum), 임의 문자열이 오면 assembleStoryboard 가 조용히 첫
//    템플릿으로 폴백해 어떤 흐름을 골라도 같은 4컷이 나온다.
// 2. 조연 없이 진행하는 선택지는 PRD 6절의 필수 경로다(조연 유무가 cast 구성을
//    바꾼다). 프롬프트가 그 문자열을 리터럴로 지시하지만 모델이 무시할 수 있어
//    빠져 있으면 되살린다 — 사용자 입력을 덮어쓰는 게 아니라 사라진 선택지를
//    복구하는 것이다.
// 3. 순서를 protagonist → supporting → flow 로 맞추고 빠진 턴은 채운다.
function normalizeTurns(turns: BrainstormTurn[]): BrainstormTurn[] {
  const byKey = new Map(turns.map((turn) => [turn.key, turn]));

  return TURN_ORDER.map((key) => {
    if (key === "flow") {
      return { key, question: FLOW_QUESTION, options: FLOW_OPTIONS };
    }

    const turn = byKey.get(key);
    if (!turn || turn.options.length === 0) {
      // 모델이 이 턴을 빼먹은 경우. 선택지를 만들 근거가 없으니 "직접 쓸게" 로만
      // 진행하도록 빈 목록을 남긴다 — 임의 값을 지어내면 mock 으로 되돌아간다.
      return { key, question: FALLBACK_QUESTION[key], options: [] };
    }

    return key === "supporting" && !turn.options.includes(NO_SUPPORTING_OPTION)
      ? { ...turn, options: [...turn.options, NO_SUPPORTING_OPTION] }
      : turn;
  });
}

const FALLBACK_QUESTION: Record<"protagonist" | "supporting", string> = {
  protagonist: "주인공은 누구인가요?",
  supporting: "함께 등장할 인물이 있나요?",
};

function promptForCut(subject: string, cut: Cut): string {
  return `${subject} · ${cut.narrative_beat} · ${cut.shot_type}/${cut.camera_angle}`;
}

// issue #143: 저장된 세션 URL로 재진입해도 완성된 4컷이 복원되지 않던 문제.
// EditorFlow.resolveImageUrl과 같은 이유로 asset://를 공개 URL로 바꿔야
// <img>에 그릴 수 있다 — 중복 구현은 #144에서 공용 유틸로 정리하기로 함.
async function resolveSessionAssetUrl(uri: string): Promise<string> {
  const res = await fetch(`/api/session/asset-url?uri=${encodeURIComponent(uri)}`);
  if (!res.ok) throw new Error("이미지 URL을 가져오지 못했습니다");
  const { url } = (await res.json()) as { url: string };
  return url;
}

async function resolveCutImages(cuts: Cut[]): Promise<Record<number, string>> {
  const entries = await Promise.all(
    cuts.map(async (cut) => {
      if (!cut.generated_image) return null;
      try {
        return [cut.cut_index, await resolveSessionAssetUrl(cut.generated_image)] as const;
      } catch {
        return null;
      }
    })
  );
  return Object.fromEntries(entries.filter((e): e is NonNullable<typeof e> => e !== null));
}

export default function SessionFlow({ sessionId }: { sessionId: string }) {
  const [step, setStep] = useState<Step>("subject");
  // issue #134: 에디터로 가는 링크가 실제 저장된 세션 id를 알아야 한다.
  // sessionId prop은 저장 전 임시값일 수 있고 저장 후에도 window.history로만
  // URL을 바꿔서 prop 자체는 갱신되지 않는다 — 그래서 저장 결과를 별도로 든다.
  const [savedSessionId, setSavedSessionId] = useState<string | null>(null);
  // issue #143: URL의 sessionId로 이미 저장된 세션이 있으면 처음부터 다시
  // 만들지 않고 그 결과를 그대로 보여준다. checkingExisting이 풀리기 전까지는
  // "subject" 단계를 잠깐이라도 보여주지 않는다(있던 데이터가 순간 안 보이는
  // 깜빡임 방지).
  const [checkingExisting, setCheckingExisting] = useState(true);
  const [isRestoredView, setIsRestoredView] = useState(false);
  const [subject, setSubject] = useState("");
  const [turnIndex, setTurnIndex] = useState(0);
  const [turns, setTurns] = useState<BrainstormTurn[] | null>(null);
  const [turnsError, setTurnsError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Partial<Record<BrainstormTurn["key"], string>>>({});
  const [customText, setCustomText] = useState("");
  const [isCustomOpen, setIsCustomOpen] = useState(false);
  const [storyboard, setStoryboard] = useState<Storyboard | null>(null);
  const [preset, setPreset] = useState<Preset | null>(null);
  const [coverVariants, setCoverVariants] = useState<GeneratedCut[] | null>(null);
  const [coverRequested, setCoverRequested] = useState<number | undefined>(undefined);
  const [cutImageUrls, setCutImageUrls] = useState<Record<number, string>>({});
  const [genError, setGenError] = useState<string | null>(null);
  const [editingCutIndex, setEditingCutIndex] = useState<number | null>(null);
  const [draftCaption, setDraftCaption] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [presetError, setPresetError] = useState<string | null>(null);

  // issue #123: preset(상의 색 후보 palette 포함)을 브레인스토밍 진행과 병렬로
  // 미리 받아둔다. 원래는 "cover" 단계(loadCoverVariants)에서만 fetch했는데, 그러면
  // storyboard 조립 시점(assembleStoryboard 호출)에 palette 값이 없어서 주인공
  // 상의 색을 세션당 1회로 고정할 수 없었다(#113 케이스 5 — 4컷 내내 색이 흔들림).
  // presetId는 온보딩이 남겨둔 sessionStorage 값이라 마운트 시 바로 조회 가능하다.
  useEffect(() => {
    void loadPreset();
  }, [sessionId]);

  async function loadPreset() {
    const presetId = window.sessionStorage.getItem("cuttoon:preset-id");
    try {
      const res = await fetch(`/api/preset?id=${presetId}`);
      if (!res.ok) throw new Error("프리셋을 찾을 수 없습니다");
      const { preset: loaded } = (await res.json()) as { preset: Preset };
      setPreset(loaded);
      setPresetError(null);
    } catch {
      setPresetError(
        presetId
          ? "프로젝트 정보를 불러오지 못했어요. 다시 시도해주세요"
          : "먼저 온보딩에서 프로젝트를 만들어주세요"
      );
    }
  }

  // issue #143: 마운트 시 이 id로 이미 저장된 세션이 있는지 확인한다. 있으면
  // (POST /api/session은 handleSave에서 골든패스 완주 후에만 호출되므로,
  // 저장된 세션은 항상 4컷이 다 채워진 상태다) 그 storyboard로 상태를 채우고
  // "cuts" 단계로 바로 보여준다 — 처음부터 다시 만들지 않는다.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/session?id=${encodeURIComponent(sessionId)}`);
        if (cancelled) return;
        if (!res.ok) return; // 없으면(404 등) 새로 만드는 골든패스를 그대로 둔다.

        const data = await res.json();
        if (cancelled) return;

        const restored: Storyboard = data.storyboard;
        const urls = await resolveCutImages(restored.cuts);
        if (cancelled) return;

        setStoryboard(restored);
        setSubject(restored.subject);
        setCutImageUrls(urls);
        setSavedSessionId(sessionId);
        setIsRestoredView(true);
        setStep("cuts");
      } catch {
        // 조회 자체가 실패해도 골든패스를 막지 않는다 — 새로 시작하는 것과 같다.
      } finally {
        if (!cancelled) setCheckingExisting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  function recordAnswer(value: string) {
    if (!turns) return;
    const key = turns[turnIndex].key;
    const next = { ...answers, [key]: value };
    setAnswers(next);
    setIsCustomOpen(false);
    setCustomText("");

    if (turnIndex < turns.length - 1) {
      setTurnIndex(turnIndex + 1);
    } else {
      setStep("assembling");
    }
  }

  // 소재에 맞는 선택지를 실제 LLM 으로 받아온다 (issue #84). 이전에는 화면 안의
  // 하드코딩 상수(BRAINSTORM_TURNS)를 썼다.
  //
  // draft 는 보내지 않는다 — 이 시점에는 답변이 하나도 없어 항상 빈 draft 이고,
  // 소재 텍스트에서 슬롯을 채운 draft 를 만드는 단계가 아직 없다. 그래서 PRD 6절의
  // "소재에 이미 정보가 있으면 해당 턴은 건너뛴다" 는 여기서 실현되지 않는다.
  // 여기서 setTurnsError(null) 로 시작하지 않는다 — effect 가 이 함수를 부르는
  // 경로에서 동기 setState 가 되어 cascading render 를 만든다
  // (react-hooks/set-state-in-effect). 초기화는 재시도 버튼 쪽에서 한다.
  async function loadTurns() {
    const trimmed = subject.trim();
    // 소재가 없으면 라우트가 400 을 준다 — 부르기 전에 끊는다. "다음" 버튼이
    // 빈 소재를 막고 있어 실제로는 도달하지 않는다.
    if (!trimmed) return;

    try {
      const res = await fetch("/api/brainstorm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "선택지를 만들지 못했습니다");
      }
      const { turns: loaded } = (await res.json()) as { turns: BrainstormTurn[] };
      if (!Array.isArray(loaded) || loaded.length === 0) {
        throw new Error("선택지가 비어 있습니다");
      }
      setTurns(normalizeTurns(loaded));
    } catch {
      setTurnsError("선택지를 만드는 데 실패했어요. 다시 시도해주세요");
    }
  }

  // 소재를 확정하는 사용자 액션에서 바로 요청을 띄운다. effect 로 옮기면
  // cascading render 가 되고(react-hooks/set-state-in-effect), 이 요청은 화면
  // 진입이 아니라 "다음" 클릭이라는 이벤트에 속한 일이다.
  function startBrainstorm() {
    setStep("brainstorm");
    void loadTurns();
  }

  useEffect(() => {
    if (step !== "assembling") return;
    // preset(palette)이 아직 안 왔으면 기다린다 — 도착하면 이 effect가 preset을
    // 의존성으로 다시 실행된다. presetError가 나면 아래 렌더링이 재시도를 보여준다.
    if (!preset) return;

    const full: BrainstormAnswers = {
      protagonist: answers.protagonist ?? "",
      supporting:
        answers.supporting && answers.supporting !== NO_SUPPORTING_OPTION
          ? answers.supporting
          : null,
      flow: answers.flow ?? "",
    };

    const timer = setTimeout(() => {
      setStoryboard(assembleStoryboard(subject, full, preset.style.palette));
      setStep("cover");
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, preset]);

  useEffect(() => {
    if (step !== "cover" || !storyboard || coverVariants) return;
    void loadCoverVariants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, storyboard]);

  async function loadCoverVariants() {
    // preset은 assembling effect가 "cover"로 넘어가기 전에 이미 기다렸으므로
    // 이 시점엔 항상 준비돼 있다 — 여기서 다시 fetch하지 않는다(issue #123).
    if (!storyboard || !preset) return;
    setGenError(null);

    try {
      const { variants, requested } = await generateCoverVariants(storyboard, preset);
      setCoverVariants(variants);
      setCoverRequested(requested);
    } catch {
      setGenError("표지를 만드는 데 실패했어요. 다시 시도해주세요");
    }
  }

  async function handleSelectCover(variant: GeneratedCut) {
    if (!storyboard || !preset) return;
    const firstCutIndex = storyboard.cuts[0].cut_index;
    const updated: Storyboard = {
      ...storyboard,
      cuts: storyboard.cuts.map((cut, i) =>
        i === 0
          ? { ...cut, generated_image: variant.asset, prompt_used: promptForCut(storyboard.subject, cut) }
          : cut
      ),
    };
    setStoryboard(updated);
    setCutImageUrls((prev) => ({ ...prev, [firstCutIndex]: variant.image }));
    setStep("generating");
    setGenError(null);

    try {
      const generated = await generateChainedCuts(updated, preset, variant.continuationToken ?? "");

      setStoryboard((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          cuts: prev.cuts.map((cut, i) =>
            i === 0
              ? cut
              : {
                  ...cut,
                  generated_image: generated[i - 1].asset,
                  prompt_used: promptForCut(prev.subject, cut),
                }
          ),
        };
      });
      setCutImageUrls((prev) => {
        const next = { ...prev };
        updated.cuts.slice(1).forEach((cut, i) => {
          next[cut.cut_index] = generated[i].image;
        });
        return next;
      });
      setStep("cuts");
    } catch {
      setGenError("나머지 컷 생성에 실패했어요. 다시 시도해주세요");
      setStep("cover");
    }
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
      setSavedSessionId(savedId);
      setStep("saved");
    } catch {
      setSaveError("저장에 실패했어요. 다시 시도해주세요");
    } finally {
      setSaving(false);
    }
  }

  if (checkingExisting) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-700" />
        <p className="text-sm text-zinc-500">불러오는 중...</p>
      </main>
    );
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
            onClick={startBrainstorm}
            className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
          >
            다음
          </button>
        </div>
      )}

      {step === "brainstorm" && !turns && !turnsError && (
        <Spinner text="소재에 맞는 선택지를 고르고 있어요..." />
      )}

      {step === "brainstorm" && turnsError && (
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-red-600">{turnsError}</p>
          <button
            type="button"
            onClick={() => {
              setTurnsError(null);
              void loadTurns();
            }}
            className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
          >
            다시 시도
          </button>
        </div>
      )}

      {step === "brainstorm" && turns && (
        <div className="flex w-full max-w-xl flex-col items-center gap-4 text-center">
          <p className="text-xs text-zinc-400">
            {turnIndex + 1} / {turns.length}
          </p>
          <h1 className="text-xl font-semibold">{turns[turnIndex].question}</h1>

          <div className="flex w-full flex-col gap-2">
            {turns[turnIndex].options.map((option) => (
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
              {/* 선택지가 비면(모델이 그 턴을 빼먹은 경우) 고를 것이 없으니 감춘다 */}
              {turns[turnIndex].options.length > 0 && (
                <button
                  type="button"
                  onClick={() => recordAnswer(turns[turnIndex].options[0])}
                  className="rounded-md border border-dashed border-zinc-300 px-3 py-1.5 text-zinc-500 hover:bg-zinc-50"
                >
                  알아서 해줘
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {step === "assembling" && !presetError && <Spinner text="이야기를 엮고 있어요..." />}
      {step === "assembling" && presetError && (
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-600">{presetError}</p>
          <button
            type="button"
            onClick={() => void loadPreset()}
            className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
          >
            다시 시도
          </button>
        </div>
      )}
      {step === "cover" && !coverVariants && !genError && <Spinner text="표지 3안을 그리고 있어요..." />}
      {step === "generating" && <Spinner text="나머지 컷을 완성하고 있어요..." />}

      {(step === "cover" || step === "generating") && genError && (
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-600">{genError}</p>
          <button
            type="button"
            onClick={() => {
              setGenError(null);
              setCoverVariants(null);
              setCoverRequested(undefined);
              setStep("cover");
              void loadCoverVariants();
            }}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50"
          >
            다시 시도
          </button>
        </div>
      )}

      {step === "cover" && coverVariants && storyboard && !genError && (
        <div className="flex w-full max-w-3xl flex-col items-center gap-6 text-center">
          <h1 className="text-xl font-semibold">마음에 드는 표지를 골라주세요</h1>
          {coverRequested != null && coverVariants.length < coverRequested && (
            <p className="w-full max-w-md rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-700">
              {coverRequested}안 중 {coverVariants.length}안만 만들어졌어요. 다시 뽑기를 눌러보세요
            </p>
          )}
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
              setCoverRequested(undefined);
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
          <h1 className="text-xl font-semibold">
            {isRestoredView ? "이미 저장된 컷툰이에요" : "4컷이 완성됐어요"}
          </h1>
          {saveError && (
            <p className="w-full max-w-md rounded-md bg-red-50 px-4 py-2 text-sm text-red-600">
              {saveError}
            </p>
          )}
          <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
            {storyboard.cuts.map((cut, i) => (
              <div key={cut.cut_index} className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3">
                <div className="relative">
                  {cutImageUrls[cut.cut_index] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- 생성된 이미지의 리졸브 URL, next/image 불필요
                    <img
                      src={cutImageUrls[cut.cut_index]}
                      alt={`컷 ${cut.cut_index}`}
                      className="aspect-square w-full rounded-md object-cover"
                    />
                  ) : (
                    // #104: 생성 자체(유료 호출)는 성공했는데 URL 리졸브만 실패했을
                    // 수 있다 — asset은 보존되고 저장에도 문제없으니 깨진 이미지
                    // 대신 안내만 보여준다. 새로고침 후 에디터에서 다시 리졸브된다.
                    <div className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-md bg-zinc-100 text-center">
                      <span className="text-xs text-zinc-400">이미지를 불러오지 못했어요</span>
                      <span className="text-xs text-zinc-400">저장 후 에디터에서 다시 확인해주세요</span>
                    </div>
                  )}
                  <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
                    {cut.cut_index}컷 · {cut.narrative_beat}
                  </span>
                </div>
                {/* 복원 뷰에는 저장 수단(handleSave)이 없어 여기서 고치면 그냥
                    사라진다 — 캡션 수정은 실제로 저장되는 에디터로 유도한다. */}
                {isRestoredView ? (
                  <p className="rounded-md px-2 py-1.5 text-left text-sm text-zinc-700">
                    {cut.caption.text}
                  </p>
                ) : editingCutIndex === i ? (
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
          {isRestoredView ? (
            // 이미 저장된 세션이다 — 다시 "저장"을 누르면 POST /api/session이
            // 매번 새 세션을 만들기 때문에(같은 id로 덮어쓰는 경로가 없음),
            // 여기서는 저장을 다시 시도하지 않고 실제로 고칠 수 있는 에디터로 보낸다.
            <Link
              href={`/editor/${sessionId}`}
              className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
            >
              에디터에서 수정하기
            </Link>
          ) : (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
            >
              {saving ? "저장 중…" : "저장"}
            </button>
          )}
        </div>
      )}

      {step === "saved" && storyboard && (
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="text-xl font-semibold">저장됐습니다</h1>
          <p className="text-sm text-zinc-500">&ldquo;{storyboard.subject}&rdquo; 4컷이 준비됐어요</p>
          <Link
            href={`/editor/${savedSessionId ?? sessionId}`}
            className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
          >
            대사·말풍선 수정하러 가기
          </Link>
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
