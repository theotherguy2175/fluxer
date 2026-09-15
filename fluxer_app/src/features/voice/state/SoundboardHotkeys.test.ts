// SPDX-License-Identifier: AGPL-3.0-or-later

import {combosMatch} from '@app/features/voice/state/SoundboardHotkeys';
import {describe, expect, it} from 'vitest';

describe('combosMatch', () => {
	it('matches a recorded key+code against a default that only has key', () => {
		expect(combosMatch({key: 'k', code: 'KeyK', ctrlOrMeta: true}, {key: 'k', ctrlOrMeta: true})).toBe(true);
	});

	it('is case-insensitive on key', () => {
		expect(combosMatch({key: 'K', code: 'KeyK', shift: true}, {key: 'k', shift: true})).toBe(true);
	});

	it('requires identical modifiers', () => {
		expect(combosMatch({key: 'k', ctrlOrMeta: true}, {key: 'k'})).toBe(false);
		expect(combosMatch({key: 'k', alt: true}, {key: 'k', shift: true})).toBe(false);
	});

	it('falls back to code when either side has no key', () => {
		expect(combosMatch({key: '', code: 'F8'}, {key: 'F8', code: 'F8'})).toBe(true);
		expect(combosMatch({key: '', code: 'F8'}, {key: '', code: 'F9'})).toBe(false);
	});

	it('compares mouse buttons when present', () => {
		expect(combosMatch({key: '', mouseButton: 3}, {key: '', mouseButton: 3})).toBe(true);
		expect(combosMatch({key: '', mouseButton: 3}, {key: '', mouseButton: 4})).toBe(false);
		expect(combosMatch({key: '', mouseButton: 3}, {key: 'k'})).toBe(false);
	});

	it('never matches two empty combos', () => {
		expect(combosMatch({key: ''}, {key: ''})).toBe(false);
	});
});
