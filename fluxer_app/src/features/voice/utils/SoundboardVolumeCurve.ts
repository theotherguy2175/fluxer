// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Map a soundboard volume multiplier (slider %/100, 0–2) to a Web Audio gain.
 *
 * A gain of 0.5 is only −6 dB, which the ear hears as "a bit quieter", not half as
 * loud — so a linear slider feels like nothing happens until the last third. Below 1
 * we square the value (0.5 → 0.25 ≈ −12 dB, which is about half the perceived
 * loudness); above 1 the boost stays linear so 200% means what the label says and
 * stacked boosts don't run away before the hard cap in the playback engine.
 */
export function soundboardMultiplierToGain(multiplier: number): number {
	if (!Number.isFinite(multiplier) || multiplier <= 0) return 0;
	return multiplier < 1 ? multiplier * multiplier : multiplier;
}
