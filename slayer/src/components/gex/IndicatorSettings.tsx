/* One chart indicator's settings, in three tabs the way the standard charting desks lay them out: Inputs (only when
   the formula takes any), Style (ink, opacity, thickness, the label on the price scale, the values in the legend) and
   Visibility (which timeframe bands it draws on). Changes apply as they are made; "Back to defaults" clears the record.
   The look is the desk's, per indicator, kept in this browser (data/indicatorLooks.ts). */

import { useState } from 'react';
import Modal from '../ui/Modal';
import { INDICATOR_ITEMS, physicsOf } from './indicatorItems';
import { INDICATOR_INKS, type ChartIndicators } from './StrikeChart';
import { inputOf, lookOf, setLook, TF_BANDS, useLooksRev, type TfBand } from '../../data/indicatorLooks';

type Tab = 'inputs' | 'style' | 'visibility';

const field = 'h-7 px-2 rounded-md border border-borderSubtle bg-chip font-mono text-t11 text-textPrimary outline-none focus:border-borderMuted';

export const PhysicsTag = ({ tag }: { tag: 'CALCULATED' | 'MODEL' }) => (
  <span
    className={`inline-flex items-center h-[15px] px-1 rounded-[3px] border font-mono text-[9px] font-semibold uppercase tracking-wider leading-none ${tag === 'MODEL' ? 'border-silver/50 text-silver' : 'border-borderMuted text-textSecondary'}`}
    title={tag === 'MODEL' ? 'A model forecast, not a measurement' : 'Measured from the data, no model'}
    data-physics-tag={tag}
  >
    {tag}
  </span>
);

const Check = ({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) => (
  <label className="flex items-center gap-3 h-8 cursor-pointer">
    <input type="checkbox" checked={on} onChange={e => onChange(e.target.checked)} className="accent-[rgb(var(--select))]" />
    <span className="text-t12 text-textPrimary">{label}</span>
    {hint && <span className="font-mono text-t10 text-textMuted">{hint}</span>}
  </label>
);

const IndicatorSettings = ({ indicator, onClose }: { indicator: keyof ChartIndicators | null; onClose: () => void }) => {
  useLooksRev();
  const item = indicator ? INDICATOR_ITEMS.find(i => i.key === indicator) : undefined;
  const inputs = item?.inputs ?? [];
  const [tab, setTab] = useState<Tab>(inputs.length > 0 ? 'inputs' : 'style');
  if (!indicator || !item) return null;
  const phys = physicsOf(indicator);
  const look = lookOf(indicator);
  const tabs: { key: Tab; label: string }[] = [...(inputs.length > 0 ? [{ key: 'inputs' as Tab, label: 'Inputs' }] : []), { key: 'style', label: 'Style' }, { key: 'visibility', label: 'Visibility' }];
  const current = tabs.some(t => t.key === tab) ? tab : tabs[0].key;
  const ink = (look.ink ?? INDICATOR_INKS[indicator]).slice(0, 7);
  const shade = indicator === 'gammaRegime';
  const opacity = look.opacity ?? (shade ? 0.3 : 1);
  const offOn = look.offOn ?? [];
  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel={`${item.label} settings`}
      widthClass="max-w-[460px]"
      zClass="z-[140]"
      header={
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-block w-2.5 h-[3px] rounded-full shrink-0" style={{ background: ink }} aria-hidden />
          <span className="text-t15 font-semibold leading-tight text-textPrimary whitespace-nowrap">{item.label}</span>
        </div>
      }
    >
      <div className="flex flex-col min-h-0" data-indicator-settings={indicator}>
        {phys && (
          <div className="flex items-center gap-2 pb-2 text-t12 text-textSecondary" data-settings-plain>
            <span>{phys.plain}</span>
            <PhysicsTag tag={phys.tag} />
          </div>
        )}
        <div className="flex gap-1 border-b border-borderSubtle" role="tablist">
          {tabs.map(t => (
            <button
              key={t.key}
              role="tab"
              aria-selected={current === t.key}
              onClick={() => setTab(t.key)}
              className={`h-8 px-3 -mb-px border-b-2 text-t12 transition-colors ${current === t.key ? 'border-silver text-textPrimary font-semibold' : 'border-transparent text-textSecondary hover:text-textPrimary'}`}
              data-settings-tab={t.key}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="py-3 min-h-[180px]">
          {current === 'inputs' &&
            inputs.map(i =>
              i.kind === 'toggle' ? (
                <div key={i.id} title={i.tooltip} data-settings-input={i.id}>
                  <Check on={inputOf(indicator, i) >= 1} onChange={v => setLook(indicator, { inputs: { ...(look.inputs ?? {}), [i.id]: v ? 1 : 0 } })} label={i.title} hint={i.tooltip} />
                </div>
              ) : i.kind === 'choice' && i.options ? (
                <label key={i.id} className="flex items-center gap-3 h-9" title={i.tooltip}>
                  <span className="w-[150px] shrink-0 text-t12 text-textSecondary">{i.title}</span>
                  <select
                    value={inputOf(indicator, i)}
                    onChange={e => setLook(indicator, { inputs: { ...(look.inputs ?? {}), [i.id]: Number(e.target.value) } })}
                    className={`${field} min-w-0 max-w-[180px]`}
                    data-settings-input={i.id}
                  >
                    {i.options.map((o, k) => (
                      <option key={o} value={k}>
                        {o}
                      </option>
                    ))}
                  </select>
                  <span className="font-mono text-t10 text-textMuted truncate">default {i.options[i.default]}</span>
                </label>
              ) : (
              <label key={i.id} className="flex items-center gap-3 h-9" title={i.tooltip}>
                <span className="w-[150px] shrink-0 text-t12 text-textSecondary">{i.title}</span>
                <input
                  type="number"
                  value={inputOf(indicator, i)}
                  min={i.min}
                  max={i.max}
                  step={i.step}
                  onChange={e => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) setLook(indicator, { inputs: { ...(look.inputs ?? {}), [i.id]: Math.min(i.max, Math.max(i.min, v)) } });
                  }}
                  className={`${field} w-24 tnum`}
                  data-settings-input={i.id}
                />
                <span className="font-mono text-t10 text-textMuted tnum">default {i.default}</span>
              </label>
              ),
            )}
          {current === 'style' && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-3 h-9">
                <span className="w-[150px] shrink-0 text-t12 text-textSecondary">{shade ? 'Wash strength' : 'Colour'}</span>
                {!shade && <input type="color" value={ink} onChange={e => setLook(indicator, { ink: e.target.value })} className="h-7 w-10 bg-transparent border border-borderSubtle rounded-md" data-settings-ink />}
                <input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={e => setLook(indicator, { opacity: Number(e.target.value) })} className="w-28 accent-[rgb(var(--select))]" aria-label="Opacity" data-settings-opacity />
                <span className="font-mono text-t10 text-textMuted tnum w-9">{Math.round(opacity * 100)}%</span>
              </div>
              {!shade && (
                <div className="flex items-center gap-3 h-9">
                  <span className="w-[150px] shrink-0 text-t12 text-textSecondary">Thickness</span>
                  {[1, 2, 3, 4].map(w => (
                    <button key={w} type="button" onClick={() => setLook(indicator, { width: w })} aria-pressed={(look.width ?? 1) === w} className={`w-8 h-7 rounded-md border flex items-center justify-center ${(look.width ?? 1) === w ? 'border-silver bg-silver/[0.08]' : 'border-borderSubtle hover:border-borderMuted'}`} title={`${w} px`}>
                      <span className="block w-4 rounded-full bg-textPrimary" style={{ height: w }} />
                    </button>
                  ))}
                </div>
              )}
              {!shade && <Check on={look.scaleLabel !== false} onChange={v => setLook(indicator, { scaleLabel: v })} label="Labels on the price scale" />}
              <Check on={look.legendValues !== false} onChange={v => setLook(indicator, { legendValues: v })} label="Values in the legend" />
            </div>
          )}
          {current === 'visibility' && (
            <div className="flex flex-col gap-1">
              <p className="pb-1 text-t11 text-textSecondary">Draw it on these timeframes. Off elsewhere, it stays in the legend, dimmed.</p>
              {TF_BANDS.map(b => (
                <Check
                  key={b.key}
                  on={!offOn.includes(b.key)}
                  onChange={v => setLook(indicator, { offOn: v ? offOn.filter(x => x !== b.key) : ([...offOn, b.key] as TfBand[]) })}
                  label={b.label}
                  hint={b.blurb}
                />
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between pt-3 border-t border-borderSubtle">
          <button type="button" onClick={() => setLook(indicator, null)} className="font-mono text-t10 uppercase tracking-wider text-textMuted hover:text-textPrimary transition-colors" data-settings-reset>
            Back to defaults
          </button>
          <button type="button" onClick={onClose} className="h-7 px-3 rounded-md border border-silver/40 bg-silver/[0.08] font-mono text-t10 uppercase tracking-wider text-textPrimary hover:bg-silver/[0.12]" data-settings-done>
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default IndicatorSettings;
