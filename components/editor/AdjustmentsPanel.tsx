"use client";

import { useState } from "react";
import {
  type Adjustments,
  BASIC_PRESENCE,
  BASIC_TONE,
  BASIC_WB,
  DEFAULT_ADJUSTMENTS,
  DETAIL,
  EFFECTS,
  HSL_CHANNELS,
  HSL_HUES,
  type HslChannel,
  type NumericKey,
  PARAMETRIC_CURVE,
  type SliderSpec,
} from "@/lib/adjustments";
import { hasPointCurve } from "@/lib/curve";
import { Section } from "./Section";
import { Slider } from "./Slider";

interface Props {
  adjustments: Adjustments;
  onChange: (patch: Partial<Adjustments>) => void;
  disabled?: boolean;
}

const WB_TRACKS: Partial<Record<NumericKey, string>> = {
  temperature: "linear-gradient(90deg,#3b82f6,#a1a1aa,#f59e0b)",
  tint: "linear-gradient(90deg,#22c55e,#a1a1aa,#d946ef)",
};

const HUE_TRACK =
  "linear-gradient(90deg,#f00 0%,#ff0 17%,#0f0 33%,#0ff 50%,#00f 67%,#f0f 83%,#f00 100%)";

export function AdjustmentsPanel({ adjustments: a, onChange, disabled }: Props) {
  const isModified = (keys: readonly NumericKey[]) =>
    keys.some((k) => a[k] !== DEFAULT_ADJUSTMENTS[k]);
  const resetKeys = (keys: readonly NumericKey[]) => {
    const patch: Partial<Adjustments> = {};
    for (const k of keys) (patch as Record<NumericKey, number>)[k] = DEFAULT_ADJUSTMENTS[k];
    onChange(patch);
  };
  const sliders = (specs: SliderSpec[]) =>
    specs.map((s) => (
      <Slider
        key={s.key}
        label={s.label}
        value={a[s.key]}
        min={s.min}
        max={s.max}
        step={s.step}
        defaultValue={DEFAULT_ADJUSTMENTS[s.key]}
        track={WB_TRACKS[s.key]}
        disabled={disabled}
        onChange={(v) => onChange({ [s.key]: v } as Partial<Adjustments>)}
      />
    ));

  const basicKeys = [...BASIC_WB, ...BASIC_TONE, ...BASIC_PRESENCE].map((s) => s.key);
  const curveKeys = PARAMETRIC_CURVE.map((s) => s.key);
  const gradingKeys: NumericKey[] = [
    "shadowHue",
    "shadowSaturation",
    "midtoneHue",
    "midtoneSaturation",
    "highlightHue",
    "highlightSaturation",
    "globalHue",
    "globalSaturation",
    "gradingBalance",
  ];
  const detailKeys = DETAIL.map((s) => s.key);
  const effectKeys = EFFECTS.map((s) => s.key);

  const hslModified = HSL_CHANNELS.some(
    (c) => a.hslHue[c] !== 0 || a.hslSaturation[c] !== 0 || a.hslLuminance[c] !== 0,
  );
  const pointCurve = hasPointCurve(a);

  return (
    <div className="flex flex-col">
      <Section
        title="Basic"
        modified={isModified(basicKeys) || a.grayscale}
        onReset={() => {
          resetKeys(basicKeys);
          onChange({ grayscale: false });
        }}
      >
        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500">Treatment</span>
          <div className="ml-auto flex rounded-md border border-zinc-800 p-0.5">
            <ToggleButton active={!a.grayscale} onClick={() => onChange({ grayscale: false })}>
              Color
            </ToggleButton>
            <ToggleButton active={a.grayscale} onClick={() => onChange({ grayscale: true })}>
              B&W
            </ToggleButton>
          </div>
        </div>
        <SubHeading>White Balance</SubHeading>
        {sliders(BASIC_WB)}
        <SubHeading>Tone</SubHeading>
        {sliders(BASIC_TONE)}
        <SubHeading>Presence</SubHeading>
        {sliders(BASIC_PRESENCE)}
      </Section>

      <Section
        title="Tone Curve"
        defaultOpen={false}
        modified={isModified(curveKeys) || pointCurve}
        onReset={() => {
          resetKeys(curveKeys);
          onChange({ toneCurve: [], toneCurveRed: [], toneCurveGreen: [], toneCurveBlue: [] });
        }}
      >
        {sliders(PARAMETRIC_CURVE)}
        {pointCurve && (
          <div className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-400">
            <span>Point curve from preset applied</span>
            <button
              type="button"
              className="text-zinc-300 hover:text-white"
              onClick={() =>
                onChange({
                  toneCurve: [],
                  toneCurveRed: [],
                  toneCurveGreen: [],
                  toneCurveBlue: [],
                })
              }
            >
              Clear
            </button>
          </div>
        )}
      </Section>

      <Section
        title="Color Mixer"
        defaultOpen={false}
        modified={hslModified}
        onReset={() =>
          onChange({
            hslHue: { ...DEFAULT_ADJUSTMENTS.hslHue },
            hslSaturation: { ...DEFAULT_ADJUSTMENTS.hslSaturation },
            hslLuminance: { ...DEFAULT_ADJUSTMENTS.hslLuminance },
          })
        }
      >
        <HslMixer adjustments={a} onChange={onChange} disabled={disabled} />
      </Section>

      <Section
        title="Color Grading"
        defaultOpen={false}
        modified={isModified(gradingKeys)}
        onReset={() => resetKeys(gradingKeys)}
      >
        <GradingGroup
          label="Shadows"
          hue={a.shadowHue}
          sat={a.shadowSaturation}
          onChange={(hue, sat) => onChange({ shadowHue: hue, shadowSaturation: sat })}
          disabled={disabled}
        />
        <GradingGroup
          label="Midtones"
          hue={a.midtoneHue}
          sat={a.midtoneSaturation}
          onChange={(hue, sat) => onChange({ midtoneHue: hue, midtoneSaturation: sat })}
          disabled={disabled}
        />
        <GradingGroup
          label="Highlights"
          hue={a.highlightHue}
          sat={a.highlightSaturation}
          onChange={(hue, sat) => onChange({ highlightHue: hue, highlightSaturation: sat })}
          disabled={disabled}
        />
        <GradingGroup
          label="Global"
          hue={a.globalHue}
          sat={a.globalSaturation}
          onChange={(hue, sat) => onChange({ globalHue: hue, globalSaturation: sat })}
          disabled={disabled}
        />
        <Slider
          label="Balance"
          value={a.gradingBalance}
          min={-100}
          max={100}
          disabled={disabled}
          onChange={(v) => onChange({ gradingBalance: v })}
        />
      </Section>

      <Section
        title="Detail"
        defaultOpen={false}
        modified={isModified(detailKeys)}
        onReset={() => resetKeys(detailKeys)}
      >
        {sliders(DETAIL)}
      </Section>

      <Section
        title="Effects"
        defaultOpen={false}
        modified={isModified(effectKeys)}
        onReset={() => resetKeys(effectKeys)}
      >
        {sliders(EFFECTS)}
      </Section>
    </div>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
      {children}
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-2.5 py-0.5 text-[11px] ${
        active ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}

const CHANNEL_COLORS: Record<HslChannel, string> = {
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#eab308",
  green: "#22c55e",
  aqua: "#06b6d4",
  blue: "#3b82f6",
  purple: "#8b5cf6",
  magenta: "#ec4899",
};

function HslMixer({
  adjustments: a,
  onChange,
  disabled,
}: {
  adjustments: Adjustments;
  onChange: (patch: Partial<Adjustments>) => void;
  disabled?: boolean;
}) {
  const [tab, setTab] = useState<"hslHue" | "hslSaturation" | "hslLuminance">("hslHue");
  const tabs = [
    ["hslHue", "Hue"],
    ["hslSaturation", "Saturation"],
    ["hslLuminance", "Luminance"],
  ] as const;

  return (
    <>
      <div className="flex rounded-md border border-zinc-800 p-0.5">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex-1 rounded px-2 py-1 text-[11px] ${
              tab === key ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {HSL_CHANNELS.map((ch) => (
        <div key={ch} className="flex items-center gap-2">
          <span
            className="mt-4 h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: CHANNEL_COLORS[ch] }}
            aria-hidden
          />
          <div className="flex-1">
            <Slider
              label={ch.charAt(0).toUpperCase() + ch.slice(1)}
              value={a[tab][ch]}
              min={-100}
              max={100}
              disabled={disabled}
              track={tab === "hslHue" ? hueTrackFor(HSL_HUES[ch]) : undefined}
              onChange={(v) => onChange({ [tab]: { ...a[tab], [ch]: v } })}
            />
          </div>
        </div>
      ))}
    </>
  );
}

function hueTrackFor(center: number) {
  const lo = `hsl(${center - 30} 80% 55%)`;
  const mid = `hsl(${center} 80% 55%)`;
  const hi = `hsl(${center + 30} 80% 55%)`;
  return `linear-gradient(90deg,${lo},${mid},${hi})`;
}

function GradingGroup({
  label,
  hue,
  sat,
  onChange,
  disabled,
}: {
  label: string;
  hue: number;
  sat: number;
  onChange: (hue: number, sat: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-zinc-800/80 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-zinc-400">{label}</span>
        <span
          className="h-3.5 w-3.5 rounded-full border border-zinc-700"
          style={{ background: `hsl(${hue} 80% 50% / ${Math.max(sat / 100, 0.08)})` }}
          aria-hidden
        />
      </div>
      <Slider
        label="Hue"
        value={hue}
        min={0}
        max={360}
        track={HUE_TRACK}
        disabled={disabled}
        onChange={(v) => onChange(v, sat)}
      />
      <Slider
        label="Saturation"
        value={sat}
        min={0}
        max={100}
        disabled={disabled}
        onChange={(v) => onChange(hue, v)}
      />
    </div>
  );
}
