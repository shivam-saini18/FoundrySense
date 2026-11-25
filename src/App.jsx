import React, { useState, useEffect } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import {
  Flame, AlertTriangle, CheckCircle2, FileText, Play, Pause,
  RefreshCw, ShieldCheck, Globe, Activity
} from 'lucide-react';

const SCENARIO_FILES = {
  normal: '/data/scenario_normal.json',
  idle_waste: '/data/scenario_idle_waste.json',
  tap_overshoot: '/data/scenario_tap_overshoot.json',
};

export default function App() {
  const [scenarioKey, setScenarioKey] = useState('normal');
  const [data, setData] = useState(null);
  const [activeTab, setActiveTab] = useState('operator');
  const [lang, setLang] = useState('hi');
  const [replayIdx, setReplayIdx] = useState(140);
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState(3);
  const [actedIds, setActedIds] = useState({});

  useEffect(() => {
    fetch(SCENARIO_FILES[scenarioKey])
      .then((res) => res.json())
      .then((json) => {
        setData(json);
        // Start replay right around Heat #6 (first waste-injected heat in waste scenarios)
        const targetIdx = json.telemetry_stream.findIndex((t) => t.ts >= (json.heats[5]?.start_ts || ''));
        setReplayIdx(targetIdx > 10 ? targetIdx + 8 : 140);
        setActedIds({});
      })
      .catch((err) => console.error('Failed to load scenario JSON:', err));
  }, [scenarioKey]);

  useEffect(() => {
    if (!isPlaying || !data) return;
    const timer = setInterval(() => {
      setReplayIdx((prev) =>
        prev + speed >= data.telemetry_stream.length ? 30 : prev + speed
      );
    }, 650);
    return () => clearInterval(timer);
  }, [isPlaying, speed, data]);

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-300">
        Loading FoundrySense M&amp;V Telemetry...
      </div>
    );
  }

  const streamSlice = data.telemetry_stream.slice(
    Math.max(0, replayIdx - 55),
    replayIdx + 1
  );
  const latestPoint = streamSlice[streamSlice.length - 1] || {};
  const currentTs = latestPoint.ts || '';

  // Match active heat and active alert dynamically to the live replay timestamp
  const activeHeat =
    data.heats.find((h) => currentTs >= h.start_ts && currentTs <= h.end_ts) ||
    data.heats.filter((h) => h.start_ts <= currentTs).slice(-1)[0] ||
    data.heats[0];

  const HEAT_STATES = ['RAMP_UP', 'MELT', 'HOLD', 'TAP', 'IDLE'];
  const currentStateIdx = HEAT_STATES.indexOf(latestPoint.detected_state);
  const rawAlert =
    data.alerts.find((a) => a.heat_id === activeHeat?.heat_id) ||
    data.alerts.find((a) => currentTs >= a.start_ts && currentTs <= a.end_ts) ||
    null;
  const syncedAlert = currentStateIdx >= HEAT_STATES.indexOf('HOLD') ? rawAlert : null;

  const totalHeatsCount = data.summary_totals.total_heats || data.heats.length;

  const toggleAck = (id) => {
    setActedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handlePrintScope2 = () => {
    setActiveTab('owner');
    setTimeout(() => window.print(), 150);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-12">
      {/* Top Simulation Disclaimer Banner */}
      <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 text-xs text-amber-200 flex flex-wrap items-center justify-between gap-2 no-print">
        <span className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            <strong>M&amp;V Mechanism Demo:</strong> {data.disclaimer}
          </span>
        </span>
        <span className="text-amber-300/90 font-mono">
          Baseline Fit: R² = {data.baseline_summary.r_squared} | CV(RMSE) = {data.baseline_summary.cv_rmse_pct}%
        </span>
      </div>

      {/* Main Header & Controls */}
      <header className="max-w-7xl mx-auto px-4 pt-5 pb-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 no-print">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30">
            <Flame className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">
              FoundrySense <span className="text-xs font-normal px-2 py-0.5 rounded bg-slate-800 text-emerald-400 ml-1">1t Induction Furnace</span>
            </h1>
            <p className="text-xs text-slate-400">
              Heat-by-Heat Power Segmentation &amp; IPMVP Verified Savings Ledger
            </p>
          </div>
        </div>

        {/* Scenario Switcher */}
        <div className="flex flex-wrap items-center gap-2 bg-slate-900 p-1.5 rounded-xl border border-slate-800">
          <span className="text-xs text-slate-400 px-2">Scenario:</span>
          {[
            { key: 'normal', label: 'Normal operation' },
            { key: 'idle_waste', label: 'Inject Idle Waste' },
            { key: 'tap_overshoot', label: 'Inject Tap Overshoot' },
          ].map((s) => (
            <button
              key={s.key}
              onClick={() => setScenarioKey(s.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                scenarioKey === s.key
                  ? 'bg-emerald-500 text-slate-950 font-semibold'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Language & Print */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setLang(lang === 'hi' ? 'en' : 'hi')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs hover:bg-slate-800"
          >
            <Globe className="w-3.5 h-3.5 text-sky-400" />
            {lang === 'hi' ? 'हिंदी / EN' : 'EN / हिंदी'}
          </button>
          <button
            onClick={handlePrintScope2}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/20 border border-sky-500/40 text-sky-300 text-xs hover:bg-sky-500/30"
          >
            <FileText className="w-3.5 h-3.5" />
            Scope 2 PDF
          </button>
        </div>
      </header>

      {/* Role Tabs */}
      <nav className="max-w-7xl mx-auto px-4 pt-4 flex gap-2 no-print">
        {[
          { id: 'operator', label: '1. Operator Tablet (Floor)' },
          { id: 'supervisor', label: '2. Supervisor & Segmenter Audit' },
          { id: 'owner', label: '3. Owner M&V Ledger & Scope 2' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-t-xl text-sm font-medium border-b-2 transition ${
              activeTab === tab.id
                ? 'border-emerald-400 text-emerald-300 bg-slate-900/80'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="max-w-7xl mx-auto px-4 pt-5 space-y-6">
        {/* LIVE POWER SIGNATURE STREAM */}
        {activeTab !== 'owner' && (
          <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex flex-wrap items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                <h2 className="text-sm font-semibold text-white">
                  Live Power Signature &amp; State-Machine Segmentation
                </h2>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-sky-300 border border-slate-700 font-mono">
                  Active Heat: {activeHeat?.heat_id} ({activeHeat?.grade})
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono">
                  State: {latestPoint.detected_state || 'MELT'} ({latestPoint.smoothed_kw ?? 0} kW)
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <button
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 flex items-center gap-1"
                >
                  {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  {isPlaying ? 'Pause' : 'Play'}
                </button>
                <button
                  onClick={() => setSpeed(speed === 3 ? 10 : 3)}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 flex items-center gap-1"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {speed === 3 ? '1x Replay' : '3x Fast'}
                </button>
              </div>
            </div>

            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={streamSlice}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    dataKey="ts"
                    tickFormatter={(v) => v.slice(11, 16)}
                    stroke="#64748b"
                    fontSize={11}
                  />
                  <YAxis stroke="#64748b" fontSize={11} unit=" kW" />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line
                    type="monotone"
                    dataKey="smoothed_kw"
                    name="Furnace kW (Median Filtered)"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="aux_kw"
                    name="Auxiliaries kW"
                    stroke="#38bdf8"
                    strokeWidth={1.5}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {/* TAB 1: OPERATOR TABLET VIEW */}
        {activeTab === 'operator' && (
          <div className="grid md:grid-cols-3 gap-5">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-400">
                  {lang === 'hi'
                    ? `भट्ठी 1 — हीट ${activeHeat?.heat_id} SEC`
                    : `Furnace 1 — ${activeHeat?.heat_id} Segmented SEC`}
                </p>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-5xl font-extrabold text-white">
                    {activeHeat?.detected_sec ?? data.summary_totals.avg_sec_kwh_per_t}
                  </span>
                  <span className="text-sm text-slate-400">kWh/t</span>
                </div>
                <p className="mt-1 text-xs text-emerald-400">
                  {lang === 'hi'
                    ? `बेसलाइन औसत: ${data.baseline_summary.baseline_sec_kwh_per_t} kWh/t`
                    : `Baseline Average: ${data.baseline_summary.baseline_sec_kwh_per_t} kWh/t`}
                </p>
              </div>
              <div className="mt-6 pt-4 border-t border-slate-800 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-slate-400 block">Grade / ग्रेड</span>
                  <span className="font-semibold text-white">{activeHeat?.grade}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Tap Target / लक्ष्य</span>
                  <span className="font-semibold text-amber-300">
                    {activeHeat ? `${activeHeat.t_spec + 10} °C` : '1450 °C'}
                  </span>
                </div>
              </div>
            </div>

            <div className="md:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-400 mb-3">
                  {lang === 'hi'
                    ? `लाइव हीट (${activeHeat?.heat_id}) के लिए अगला कदम`
                    : `Replay-Synced Operator Action (${activeHeat?.heat_id})`}
                </p>

                {syncedAlert ? (
                  <div className="p-5 rounded-xl bg-rose-500/15 border border-rose-500/40 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <span className="text-xs font-bold uppercase px-2 py-0.5 rounded bg-rose-500 text-white">
                        {syncedAlert.heat_id} • ₹{syncedAlert.rs_impact_heat} / heat
                      </span>
                      <h3 className="text-2xl font-bold text-white mt-2">
                        {lang === 'hi' ? syncedAlert.title_hi : syncedAlert.title_en}
                      </h3>
                      <p className="text-sm text-rose-200 mt-1">{syncedAlert.action}</p>
                    </div>
                    <button
                      onClick={() => toggleAck(syncedAlert.heat_id)}
                      className={`px-5 py-3 rounded-xl font-bold text-sm transition ${
                        actedIds[syncedAlert.heat_id]
                          ? 'bg-emerald-500 text-slate-950'
                          : 'bg-white text-slate-950 hover:bg-slate-200'
                      }`}
                    >
                      {actedIds[syncedAlert.heat_id]
                        ? lang === 'hi' ? 'पूरा हुआ ✓' : 'Action Logged ✓'
                        : lang === 'hi' ? 'अभी करें (TAP / CLOSE)' : 'Acknowledge Action'}
                    </button>
                  </div>
                ) : (
                  <div className="p-6 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-4">
                    <CheckCircle2 className="w-10 h-10 text-emerald-400 shrink-0" />
                    <div>
                      <h3 className="text-xl font-bold text-emerald-300">
                        {lang === 'hi'
                          ? `${activeHeat?.heat_id}: सभी पैरामीटर सही हैं — कोई बर्बादी नहीं`
                          : `${activeHeat?.heat_id}: Optimal Discipline — No Active Waste Alert`}
                      </h3>
                      <p className="text-xs text-slate-300 mt-1">
                        Idle holding {activeHeat?.detected_idle_min} min; tap temp {activeHeat?.t_tap} °C (spec {activeHeat?.t_spec} °C).
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3 text-center">
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="text-xs text-slate-400 block">Heats Segmented</span>
                  <span className="text-lg font-bold text-white">
                    {data.heats.length} / {totalHeatsCount}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="text-xs text-slate-400 block">8-Day Replay Saved</span>
                  <span className="text-lg font-bold text-emerald-400">₹{data.summary_totals.run_rs_saved}</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="text-xs text-slate-400 block">CO₂ Avoided (Run)</span>
                  <span className="text-lg font-bold text-sky-400">{data.summary_totals.run_co2_kg} kg</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: SUPERVISOR & SYNTHETIC ROBUSTNESS AUDIT */}
        {activeTab === 'supervisor' && (
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
              <h3 className="text-base font-semibold text-white mb-1">
                ₹-Ranked Waste Alerts (Current Scenario)
              </h3>
              <p className="text-xs text-slate-400 mb-4">
                Sorted by rupee loss per heat; right column shows monthly impact only if recurring on every heat.
              </p>
              {data.alerts.length === 0 ? (
                <p className="text-sm text-emerald-400 py-6">
                  No threshold breaches in this scenario. Switch to &ldquo;Inject Idle Waste&rdquo; or &ldquo;Inject Tap Overshoot&rdquo; above to test alert ranking.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="py-2">Heat</th>
                        <th className="py-2">Issue</th>
                        <th className="py-2">Loss / Heat</th>
                        <th className="py-2">If Recurring / Mo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {data.alerts.slice(0, 8).map((a, i) => (
                        <tr key={i}>
                          <td className="py-2.5 font-mono text-slate-200">{a.heat_id}</td>
                          <td className="py-2.5 text-amber-300">{a.title_en}</td>
                          <td className="py-2.5 font-bold text-rose-400">₹{a.rs_impact_heat}</td>
                          <td className="py-2.5 text-slate-400">₹{a.rs_impact_if_recurring_monthly.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck className="w-4 h-4 text-sky-400" />
                <h3 className="text-base font-semibold text-white">
                  Synthetic Noise &amp; Dropout Robustness Test
                </h3>
              </div>
              <p className="text-xs text-slate-400 mb-4">
                State-machine heat detector stress-tested against Gaussian EMI noise, charging dips, and packet loss (24 ground-truth heats).
              </p>
              <table className="w-full text-left text-xs">
                <thead className="text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-2">Stress Condition</th>
                    <th className="py-2">Heats Matched</th>
                    <th className="py-2">Idle MAE</th>
                    <th className="py-2">kWh MAPE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {data.robustness_sweep.map((r, i) => (
                    <tr key={i}>
                      <td className="py-2.5 text-slate-200">{r.condition}</td>
                      <td className="py-2.5 font-mono text-emerald-400">
                        {r.matched_heats} / {r.true_heats}
                      </td>
                      <td className="py-2.5 font-mono">{r.idle_mae_min} min</td>
                      <td className="py-2.5 font-mono">{r.kwh_mape_pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: OWNER M&V LEDGER & SCOPE 2 REPORT */}
        {activeTab === 'owner' && (
          <div className="space-y-6">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 print-card">
                <span className="text-xs text-slate-400">Verified SEC Saving (This 8-Day Replay)</span>
                <div className="text-2xl font-bold text-emerald-400 mt-1">
                  {data.summary_totals.verified_sec_saved_kwh_per_t} kWh/t
                </div>
                <span className="text-[11px] text-slate-400">
                  30-seed simulation median: {data.monte_carlo_30_seed.central_median.sec_saved_kwh_per_t} kWh/t
                </span>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 print-card">
                <span className="text-xs text-slate-400">Annualized Bill Saving (2,400 t/yr)</span>
                <div className="text-2xl font-bold text-white mt-1">
                  ₹{data.summary_totals.annualized_rs_lakh} L / yr
                </div>
                <span className="text-[11px] text-slate-400">
                  30-seed median: ₹{data.monte_carlo_30_seed.central_median.annual_rs_lakh} L/yr @ ₹7.32/kWh
                </span>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 print-card">
                <span className="text-xs text-slate-400">Annualized Scope 2 CO₂ Avoided</span>
                <div className="text-2xl font-bold text-sky-400 mt-1">
                  {data.summary_totals.annualized_co2_tonnes} tCO₂ / yr
                </div>
                <span className="text-[11px] text-slate-400">
                  CEA Grid Factor: 0.710 kgCO₂/kWh
                </span>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 print-card">
                <span className="text-xs text-slate-400">IPMVP 90% Confidence Check</span>
                <div className="text-lg font-bold text-emerald-400 mt-1">
                  {data.summary_totals.cum_verified_kwh} kWh &gt; ±{data.summary_totals.cum_ci_90_kwh}
                </div>
                <span className="text-[11px] text-emerald-300">
                  {data.summary_totals.cum_above_model_uncertainty
                    ? 'Statistically Verified Above Uncertainty ✓'
                    : 'Below Uncertainty Band'}
                </span>
              </div>
            </div>

            {/* Expected vs Actual kWh per Heat Chart */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 print-card">
              <h3 className="text-base font-semibold text-white mb-1">
                IPMVP Baseline Expected kWh vs. Actual Metered kWh (Per Heat)
              </h3>
              <p className="text-xs text-slate-400 mb-4">
                Adjusts for charge weight, grade spec temperature, and refractory lining age; savings credited only when tap temperature meets spec floor.
              </p>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.savings_ledger.slice(0, 24)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="heat_id" stroke="#64748b" fontSize={11} />
                    <YAxis domain={[580, 760]} stroke="#64748b" fontSize={11} unit=" kWh" />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="kwh_expected" name="Baseline Expected kWh" fill="#64748b" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="kwh_actual" name="Actual Metered kWh" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Heat-by-Heat M&V Ledger Table */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 print-card">
              <h3 className="text-base font-semibold text-white mb-3">
                Heat-by-Heat M&amp;V Savings &amp; Carbon Ledger (First 12 Heats)
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2">Heat ID</th>
                      <th className="py-2">Grade</th>
                      <th className="py-2">Charge (t)</th>
                      <th className="py-2">Expected kWh</th>
                      <th className="py-2">Actual kWh</th>
                      <th className="py-2">Verified Saved</th>
                      <th className="py-2">₹ Saved</th>
                      <th className="py-2">kgCO₂</th>
                      <th className="py-2">Quality Guard</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {data.savings_ledger.slice(0, 12).map((row) => (
                      <tr key={row.heat_id}>
                        <td className="py-2 font-mono">{row.heat_id}</td>
                        <td className="py-2">{row.grade}</td>
                        <td className="py-2">{row.charge_t}</td>
                        <td className="py-2">{row.kwh_expected}</td>
                        <td className="py-2 font-semibold">{row.kwh_actual}</td>
                        <td className={`py-2 font-semibold ${row.verified_saved_kwh >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {row.verified_saved_kwh >= 0 ? `+${row.verified_saved_kwh}` : row.verified_saved_kwh} kWh
                        </td>
                        <td className="py-2 text-emerald-400">₹{row.rs_saved}</td>
                        <td className="py-2 text-sky-400">{row.co2_avoided_kg}</td>
                        <td className="py-2 text-emerald-300">
                          {row.quality_guard_pass ? 'PASS ✓' : 'BLOCKED'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}