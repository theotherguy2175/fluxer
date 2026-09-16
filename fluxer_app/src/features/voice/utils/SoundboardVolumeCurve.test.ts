// SPDX-License-Identifier: AGPL-3.0-or-later

import {soundboardMultiplierToGain} from '@app/features/voice/utils/SoundboardVolumeCurve';
import {describe, expect, it} from 'vitest';

describe('soundboardMultiplierToGain', () => {
	it('is silent at 0 and unity at 1', () => {
		expect(soundboardMultiplierToGain(0)).toBe(0);
		expect(soundboardMultiplierToGain(1)).toBe(1);
	});

	it('halves perceived loudness around 50% (≈ −12 dB) instead of −6 dB', () => {
		const gain = soundboardMultiplierToGain(0.5);
		expect(gain).toBeCloseTo(0.25, 5);
		expect(20 * Math.log10(gain)).toBeCloseTo(-12.04, 1);
	});

	it('keeps boosts above 100% linear', () => {
		expect(soundboardMultiplierToGain(1.5)).toBe(1.5);
		expect(soundboardMultiplierToGain(2)).toBe(2);
	});

	it('is monotonic and continuous through 1', () => {
		let prev = 0;
		for (let m = 0; m <= 2.0001; m += 0.01) {
			const gain = soundboardMultiplierToGain(m);
			expect(gain).toBeGreaterThanOrEqual(prev);
			prev = gain;
		}
		expect(soundboardMultiplierToGain(0.999)).toBeCloseTo(soundboardMultiplierToGain(1.001), 2);
	});

	it('treats garbage as silence', () => {
		expect(soundboardMultiplierToGain(Number.NaN)).toBe(0);
		expect(soundboardMultiplierToGain(-1)).toBe(0);
	});
});
