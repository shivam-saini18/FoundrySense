import json
import math
import os
import random
from datetime import datetime, timedelta
import numpy as np
from scipy import stats

TARIFF_RS_PER_KWH = 7.32
CEA_CO2_KG_PER_KWH = 0.710
IDLE_KW = 40.0  # Slide 4 holding power assumption

GRADES = [
    {"name": "SG400/15", "t_spec": 1440},
    {"name": "FG260", "t_spec": 1410},
    {"name": "SG500/7", "t_spec": 1460},
]


def generate_plant_run(seed=42, num_days=8, heats_per_day=8, scenario="normal",
                       noise_std_pct=0.035, dropout_prob=0.02):
    rng = np.random.default_rng(seed)
    random.seed(seed)

    start_time = datetime(2026, 11, 20, 6, 0, 0)
    current_time = start_time
    telemetry = []
    ground_truth_heats = []

    heat_counter = 1
    for day in range(num_days):
        lining_age = 15 + (day % 28)
        for h in range(heats_per_day):
            grade = random.choice(GRADES)
            charge_t = round(float(rng.uniform(0.95, 1.04)), 3)
            t_spec = grade["t_spec"]

            if scenario == "baseline":
                idle_min = int(rng.integers(18, 32))
                overshoot_c = float(rng.uniform(26.0, 46.0))
                lid_open_min = int(rng.integers(10, 20))
            elif scenario == "normal":
                idle_min = int(rng.integers(3, 7))
                overshoot_c = float(rng.uniform(4.0, 10.0))
                lid_open_min = int(rng.integers(1, 4))
            elif scenario == "idle_waste":
                idle_min = int(rng.integers(26, 40)) if h >= 5 else int(rng.integers(4, 8))
                overshoot_c = float(rng.uniform(5.0, 10.0))
                lid_open_min = int(rng.integers(2, 5))
            elif scenario == "tap_overshoot":
                idle_min = int(rng.integers(3, 7))
                overshoot_c = float(rng.uniform(34.0, 50.0)) if h >= 5 else float(rng.uniform(5.0, 10.0))
                lid_open_min = int(rng.integers(1, 4))

            t_tap = round(t_spec + overshoot_c, 1)

            spec_delta_kwh = (t_spec - 1400) * 0.31 * charge_t
            overshoot_kwh = overshoot_c * 0.31 * charge_t
            lid_kwh = (lid_open_min / 20.0) * 15.0 * charge_t
            lining_kwh = (lining_age - 15) * 0.35 * charge_t

            target_active_kwh = (642.0 * charge_t) + spec_delta_kwh + overshoot_kwh + lid_kwh + lining_kwh
            ramp_min = 12
            ramp_kw = 410.0
            melt_kw = 565.0
            remaining_melt_kwh = target_active_kwh - (ramp_min * ramp_kw / 60.0)
            melt_min = max(45, int(round((remaining_melt_kwh / melt_kw) * 60.0)))

            hold_min = idle_min
            tap_min = 5
            between_idle_min = int(rng.integers(7, 14))

            heat_start = current_time
            true_kwh = 0.0

            phases = [
                ("RAMP_UP", ramp_min, ramp_kw),
                ("MELT", melt_min, melt_kw),
                ("HOLD", hold_min, IDLE_KW),
                ("TAP", tap_min, 28.0),
                ("IDLE", between_idle_min, 16.0),
            ]

            for phase_name, dur, base_kw in phases:
                for _ in range(dur):
                    noise = float(rng.normal(0, base_kw * noise_std_pct))
                    spike = float(rng.choice([0.0, -55.0, 35.0], p=[0.90, 0.06, 0.04])) if phase_name == "MELT" else 0.0
                    dropped = bool(rng.random() < dropout_prob)
                    measured_kw = None if dropped else max(0.0, round(base_kw + noise + spike, 2))

                    clean_kw = max(0.0, base_kw + float(rng.normal(0, base_kw * 0.015)))
                    if phase_name in ("RAMP_UP", "MELT", "HOLD", "TAP"):
                        true_kwh += clean_kw / 60.0

                    aux_kw = round(34.0 + float(rng.normal(0, 1.5)), 2)
                    telemetry.append({
                        "ts": current_time.isoformat(),
                        "furnace_kw": measured_kw,
                        "aux_kw": aux_kw,
                        "pf": round(float(rng.uniform(0.94, 0.98)), 3),
                        "true_state": phase_name,
                        "dropped": dropped
                    })
                    current_time += timedelta(minutes=1)

            heat_end = current_time - timedelta(minutes=between_idle_min)
            ground_truth_heats.append({
                "heat_id": f"H-{heat_counter:03d}",
                "start_ts": heat_start.isoformat(),
                "end_ts": heat_end.isoformat(),
                "charge_t": charge_t,
                "grade": grade["name"],
                "t_spec": t_spec,
                "t_tap": t_tap,
                "lining_age": lining_age,
                "true_idle_min": hold_min,
                "true_kwh": round(true_kwh, 2),
                "true_sec": round(true_kwh / charge_t, 2),
                "reject_flag": False
            })
            heat_counter += 1

    return telemetry, ground_truth_heats


def segment_heats_from_power(telemetry, ground_truth_heats):
    raw_kw = []
    last_valid = 16.0
    for row in telemetry:
        if row["furnace_kw"] is not None:
            last_valid = row["furnace_kw"]
        raw_kw.append(last_valid)

    smoothed_kw = []
    for i in range(len(raw_kw)):
        window = raw_kw[max(0, i - 1):min(len(raw_kw), i + 2)]
        smoothed_kw.append(float(np.median(window)))

    state = "IDLE"
    segmented = []
    cur_start = None
    cur_kwh = 0.0
    cur_hold_min = 0

    for i, kw in enumerate(smoothed_kw):
        telemetry[i]["smoothed_kw"] = round(kw, 2)
        if state == "IDLE":
            if kw > 240.0:
                state = "RAMP_UP"
                cur_start = i
                cur_kwh = kw / 60.0
                cur_hold_min = 0
        elif state == "RAMP_UP":
            cur_kwh += kw / 60.0
            if kw > 470.0:
                state = "MELT"
        elif state == "MELT":
            cur_kwh += kw / 60.0
            if 32.0 <= kw <= 95.0:
                state = "HOLD"
                cur_hold_min += 1
            elif kw < 32.0:
                state = "TAP"
        elif state == "HOLD":
            cur_kwh += kw / 60.0
            if 32.0 <= kw <= 95.0:
                cur_hold_min += 1
            elif kw < 32.0:
                state = "TAP"
        elif state == "TAP":
            cur_kwh += kw / 60.0
            if kw < 22.0:
                segmented.append({
                    "start_ts": telemetry[cur_start]["ts"],
                    "end_ts": telemetry[i]["ts"],
                    "detected_kwh": round(cur_kwh, 2),
                    "detected_idle_min": cur_hold_min
                })
                state = "IDLE"
        telemetry[i]["detected_state"] = state

    paired_heats = []
    idle_errors_min = []
    kwh_pct_errors = []

    for gt in ground_truth_heats:
        gt_s = datetime.fromisoformat(gt["start_ts"]).timestamp()
        gt_e = datetime.fromisoformat(gt["end_ts"]).timestamp()
        gt_dur = max(1.0, gt_e - gt_s)

        best_det = None
        best_overlap = 0.0
        for det in segmented:
            d_s = datetime.fromisoformat(det["start_ts"]).timestamp()
            d_e = datetime.fromisoformat(det["end_ts"]).timestamp()
            overlap = max(0.0, min(gt_e, d_e) - max(gt_s, d_s)) / gt_dur
            if overlap > best_overlap:
                best_overlap = overlap
                best_det = det

        if best_det and best_overlap >= 0.5:
            idle_errors_min.append(abs(best_det["detected_idle_min"] - gt["true_idle_min"]))
            kwh_pct_errors.append(abs(best_det["detected_kwh"] - gt["true_kwh"]) / gt["true_kwh"] * 100.0)
            paired_heats.append({
                **gt,
                "detected_kwh": best_det["detected_kwh"],
                "detected_sec": round(best_det["detected_kwh"] / gt["charge_t"], 2),
                "detected_idle_min": best_det["detected_idle_min"],
            })

    metrics = {
        "true_heats": len(ground_truth_heats),
        "detected_heats": len(segmented),
        "matched_heats": len(paired_heats),
        "idle_mae_min": round(float(np.mean(idle_errors_min)), 2) if idle_errors_min else None,
        "kwh_mape_pct": round(float(np.mean(kwh_pct_errors)), 2) if kwh_pct_errors else None,
    }
    return paired_heats, metrics


def run_noise_robustness_sweep():
    levels = [
        ("3.5% noise / 2% drop (Nominal)", 0.035, 0.02),
        ("10% noise / 5% drop (Moderate EMI)", 0.10, 0.05),
        ("20% noise / 10% drop (High EMI)", 0.20, 0.10),
        ("30% noise / 15% drop (Severe)", 0.30, 0.15),
    ]
    results = []
    for label, n_std, d_prob in levels:
        tel, gt = generate_plant_run(seed=505, num_days=3, heats_per_day=8,
                                     scenario="normal", noise_std_pct=n_std, dropout_prob=d_prob)
        _, m = segment_heats_from_power(tel, gt)
        results.append({"condition": label, **m})
    return results


def fit_ipmvp_baseline(baseline_heats):
    y = np.array([h["detected_kwh"] for h in baseline_heats])
    X = np.column_stack([
        np.ones(len(baseline_heats)),
        [h["charge_t"] for h in baseline_heats],
        [h["t_spec"] for h in baseline_heats],
        [h["lining_age"] for h in baseline_heats],
    ])

    beta, _, _, _ = np.linalg.lstsq(X, y, rcond=None)
    y_hat = X @ beta
    residuals = y - y_hat
    n, p = X.shape
    dof = n - p

    ss_res = float(np.sum(residuals ** 2))
    ss_tot = float(np.sum((y - np.mean(y)) ** 2))
    r2 = 1.0 - (ss_res / ss_tot)
    rmse = math.sqrt(ss_res / dof)
    cv_rmse_pct = (rmse / float(np.mean(y))) * 100.0
    t_90 = float(stats.t.ppf(0.95, df=dof))
    xtx_inv = np.linalg.inv(X.T @ X)

    return {
        "coefficients": {
            "intercept": round(float(beta[0]), 3),
            "charge_t": round(float(beta[1]), 3),
            "t_spec": round(float(beta[2]), 4),
            "lining_age": round(float(beta[3]), 3),
        },
        "r_squared": round(r2, 3),
        "cv_rmse_pct": round(cv_rmse_pct, 2),
        "rmse_kwh": round(rmse, 2),
        "t_crit_90": round(t_90, 3),
        "xtx_inv": xtx_inv.tolist(),
        "fit_heats": n
    }


def build_savings_ledger(heats, baseline_model):
    c = baseline_model["coefficients"]
    rmse = baseline_model["rmse_kwh"]
    t_90 = baseline_model["t_crit_90"]
    xtx_inv = np.array(baseline_model["xtx_inv"])

    ledger = []
    alerts = []
    cum_saved_kwh = 0.0
    x_rows = []

    for h in heats:
        x_vec = np.array([1.0, h["charge_t"], h["t_spec"], h["lining_age"]])
        x_rows.append(x_vec)
        expected_kwh = (c["intercept"] + c["charge_t"] * h["charge_t"] +
                        c["t_spec"] * h["t_spec"] + c["lining_age"] * h["lining_age"])

        pred_se = rmse * math.sqrt(1.0 + float(x_vec.T @ xtx_inv @ x_vec))
        ci_90_kwh = round(t_90 * pred_se, 2)

        X_sub = np.array(x_rows)
        ones = np.ones(len(x_rows))
        cum_var_factor = len(x_rows) + float(ones.T @ X_sub @ xtx_inv @ X_sub.T @ ones)
        cum_ci_90 = round(t_90 * rmse * math.sqrt(cum_var_factor), 2)

        raw_saved_kwh = expected_kwh - h["detected_kwh"]
        quality_pass = (h["t_tap"] >= h["t_spec"]) and (not h["reject_flag"])
        verified_kwh = round(raw_saved_kwh, 2) if quality_pass else 0.0
        cum_saved_kwh += verified_kwh

        ledger.append({
            "heat_id": h["heat_id"],
            "start_ts": h["start_ts"],
            "end_ts": h["end_ts"],
            "grade": h["grade"],
            "charge_t": h["charge_t"],
            "kwh_expected": round(expected_kwh, 2),
            "kwh_actual": h["detected_kwh"],
            "sec_actual": h["detected_sec"],
            "ci_90_kwh": ci_90_kwh,
            "quality_guard_pass": quality_pass,
            "verified_saved_kwh": verified_kwh,
            "cum_saved_kwh": round(cum_saved_kwh, 2),
            "cum_ci_90_kwh": cum_ci_90,
            "cum_above_uncertainty": bool(cum_saved_kwh > cum_ci_90),
            "rs_saved": round(verified_kwh * TARIFF_RS_PER_KWH, 2),
            "co2_avoided_kg": round(verified_kwh * CEA_CO2_KG_PER_KWH, 2)
        })

        if h["detected_idle_min"] > 8:
            excess_min = h["detected_idle_min"] - 4
            waste_kwh = round(excess_min * (IDLE_KW / 60.0), 2)
            rs_heat = round(waste_kwh * TARIFF_RS_PER_KWH, 0)
            alerts.append({
                "heat_id": h["heat_id"],
                "start_ts": h["start_ts"],
                "end_ts": h["end_ts"],
                "type": "IDLE_HOLDING",
                "title_en": f"Idle holding {h['detected_idle_min']} min",
                "title_hi": f"निष्क्रिय {h['detected_idle_min']} मिनट — चार्ज डालें",
                "rs_impact_heat": rs_heat,
                "rs_impact_if_recurring_monthly": round(rs_heat * 8 * 25, 0),
                "action": "Load next charge / check mould readiness"
            })
        if h["t_tap"] > h["t_spec"] + 12:
            over_c = round(h["t_tap"] - (h["t_spec"] + 10), 1)
            waste_kwh = round(over_c * 0.31 * h["charge_t"], 2)
            rs_heat = round(waste_kwh * TARIFF_RS_PER_KWH, 0)
            alerts.append({
                "heat_id": h["heat_id"],
                "start_ts": h["start_ts"],
                "end_ts": h["end_ts"],
                "type": "TAP_OVERSHOOT",
                "title_en": f"Over-temp +{over_c}°C above target",
                "title_hi": f"तापमान अधिक (+{over_c}°C) — अभी टैप करें",
                "rs_impact_heat": rs_heat,
                "rs_impact_if_recurring_monthly": round(rs_heat * 8 * 25, 0),
                "action": f"Tap immediately at {h['t_spec'] + 10}°C"
            })

    alerts.sort(key=lambda a: a["rs_impact_heat"], reverse=True)
    return ledger, alerts


if __name__ == "__main__":
    out_dir = os.path.join("public", "data")
    os.makedirs(out_dir, exist_ok=True)

    base_tel, base_gt = generate_plant_run(seed=101, num_days=28, heats_per_day=8, scenario="baseline")
    base_heats, _ = segment_heats_from_power(base_tel, base_gt)
    baseline_model = fit_ipmvp_baseline(base_heats)
    baseline_avg_sec = round(float(np.mean([h["detected_sec"] for h in base_heats])), 1)
    baseline_model["baseline_avg_sec_kwh_per_t"] = baseline_avg_sec

    with open(os.path.join(out_dir, "baseline_model.json"), "w", encoding="utf-8") as f:
        json.dump(baseline_model, f, indent=2)

    sweep = run_noise_robustness_sweep()
    with open(os.path.join(out_dir, "robustness_sweep.json"), "w", encoding="utf-8") as f:
        json.dump(sweep, f, indent=2)

    mc_sec_saved, mc_rs_lakh, mc_co2_t = [], [], []
    for s in range(1000, 1030):
        t_mc, g_mc = generate_plant_run(seed=s, num_days=8, heats_per_day=8, scenario="normal")
        h_mc, _ = segment_heats_from_power(t_mc, g_mc)
        l_mc, _ = build_savings_ledger(h_mc, baseline_model)
        tot_t = sum(x["charge_t"] for x in h_mc)
        scale = 2400.0 / tot_t
        mc_sec_saved.append(l_mc[-1]["cum_saved_kwh"] / tot_t)
        mc_rs_lakh.append((sum(x["rs_saved"] for x in l_mc) * scale) / 100000.0)
        mc_co2_t.append((sum(x["co2_avoided_kg"] for x in l_mc) * scale) / 1000.0)

    monte_carlo_summary = {
        "seeds": 30,
        "conservative_p10": {
            "sec_saved_kwh_per_t": round(float(np.percentile(mc_sec_saved, 10)), 1),
            "annual_rs_lakh": round(float(np.percentile(mc_rs_lakh, 10)), 2),
            "annual_co2_t": round(float(np.percentile(mc_co2_t, 10)), 1),
        },
        "central_median": {
            "sec_saved_kwh_per_t": round(float(np.median(mc_sec_saved)), 1),
            "annual_rs_lakh": round(float(np.median(mc_rs_lakh)), 2),
            "annual_co2_t": round(float(np.median(mc_co2_t)), 1),
        },
        "optimistic_p90": {
            "sec_saved_kwh_per_t": round(float(np.percentile(mc_sec_saved, 90)), 1),
            "annual_rs_lakh": round(float(np.percentile(mc_rs_lakh, 90)), 2),
            "annual_co2_t": round(float(np.percentile(mc_co2_t, 90)), 1),
        },
    }

    for scen_name, seed_val in [("normal", 202), ("idle_waste", 303), ("tap_overshoot", 404)]:
        tel, gt = generate_plant_run(seed=seed_val, num_days=8, heats_per_day=8, scenario=scen_name)
        heats, _ = segment_heats_from_power(tel, gt)
        ledger, alerts = build_savings_ledger(heats, baseline_model)

        avg_sec = round(float(np.mean([h["detected_sec"] for h in heats])), 1)
        tot_t = sum(h["charge_t"] for h in heats)
        verified_sec_saved = round(ledger[-1]["cum_saved_kwh"] / tot_t, 1)
        sec_cut_pct = round((verified_sec_saved / baseline_avg_sec) * 100.0, 1)
        scale_to_2400t = 2400.0 / tot_t

        payload = {
            "scenario": scen_name,
            "disclaimer": "Simulated plant telemetry calibrated to BEE-anchored baseline (1t furnace, Rs 7.32/kWh) — 4-week silent baseline replaces assumptions in pilot.",
            "baseline_summary": {
                "baseline_sec_kwh_per_t": baseline_avg_sec,
                "r_squared": baseline_model["r_squared"],
                "cv_rmse_pct": baseline_model["cv_rmse_pct"],
                "coefficients": baseline_model["coefficients"]
            },
            "monte_carlo_30_seed": monte_carlo_summary,
            "robustness_sweep": sweep,
            "summary_totals": {
                "total_heats": len(ledger),
                "avg_sec_kwh_per_t": avg_sec,
                "verified_sec_saved_kwh_per_t": verified_sec_saved,
                "sec_reduction_pct": sec_cut_pct,
                "cum_verified_kwh": ledger[-1]["cum_saved_kwh"],
                "cum_ci_90_kwh": ledger[-1]["cum_ci_90_kwh"],
                "cum_above_model_uncertainty": ledger[-1]["cum_above_uncertainty"],
                "run_rs_saved": round(sum(x["rs_saved"] for x in ledger), 0),
                "run_co2_kg": round(sum(x["co2_avoided_kg"] for x in ledger), 1),
                "annualized_rs_lakh": round((sum(x["rs_saved"] for x in ledger) * scale_to_2400t) / 100000.0, 2),
                "annualized_co2_tonnes": round((sum(x["co2_avoided_kg"] for x in ledger) * scale_to_2400t) / 1000.0, 1),
            },
            "alerts": alerts,
            "heats": heats,
            "savings_ledger": ledger,
            "telemetry_stream": tel[::4]
        }
        with open(os.path.join(out_dir, f"scenario_{scen_name}.json"), "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)

    print(f"Generated all 5 JSON files inside {out_dir}/ successfully!")
