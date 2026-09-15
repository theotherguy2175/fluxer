// SPDX-License-Identifier: AGPL-3.0-or-later

import type {KeyCombo} from '@app/features/input/state/InputKeybind';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {makePersistent} from '@app/features/platform/utils/MobXPersistence';
import {makeAutoObservable} from 'mobx';

const logger = new Logger('SoundboardHotkeys');
const STORE_NAME = 'SoundboardHotkeys';
const STORE_VERSION = 1;

export interface SoundboardHotkeyBinding {
	guildId: string;
	combo: KeyCombo;
}

const hasTrigger = (combo: KeyCombo | null | undefined): combo is KeyCombo =>
	!!combo && ((combo.key ?? '') !== '' || (combo.code ?? '') !== '' || combo.mouseButton != null);

/**
 * Personal, device-local hotkeys for guild soundboard sounds (like favorites, this is
 * the member's own preference and never leaves the device). Sound IDs are guild-scoped,
 * so each binding remembers its guild; a hotkey only fires while connected to a voice
 * channel in that guild and Fluxer has focus — these are never registered as OS-global.
 */
class SoundboardHotkeys {
	bindings: Record<string, SoundboardHotkeyBinding> = {};

	constructor() {
		makeAutoObservable(this, {getCombo: false, getBindingsForGuild: false, findConflict: false}, {autoBind: true});
		void this.initPersistence();
	}

	private async initPersistence(): Promise<void> {
		await makePersistent(this, STORE_NAME, ['bindings'], {version: STORE_VERSION, syncAcrossTabs: true});
	}

	getCombo(soundId: string): KeyCombo | null {
		const binding = this.bindings[soundId];
		return hasTrigger(binding?.combo) ? binding.combo : null;
	}

	getBindingsForGuild(guildId: string): Array<{soundId: string; combo: KeyCombo}> {
		const result: Array<{soundId: string; combo: KeyCombo}> = [];
		for (const [soundId, binding] of Object.entries(this.bindings)) {
			if (binding.guildId !== guildId || !hasTrigger(binding.combo)) continue;
			result.push({soundId, combo: binding.combo});
		}
		return result;
	}

	/** Another sound in the same guild already bound to this combo, if any. */
	findConflict(guildId: string, combo: KeyCombo, excludeSoundId?: string): string | null {
		for (const entry of this.getBindingsForGuild(guildId)) {
			if (entry.soundId === excludeSoundId) continue;
			if (combosMatch(entry.combo, combo)) return entry.soundId;
		}
		return null;
	}

	setCombo(soundId: string, guildId: string, combo: KeyCombo): void {
		if (!hasTrigger(combo)) {
			this.clear(soundId);
			return;
		}
		// In-app only: strip the global flag so nothing ever tries to hook this at the OS level.
		const {global: _global, ...rest} = combo;
		this.bindings = {...this.bindings, [soundId]: {guildId, combo: {...rest, enabled: true}}};
		logger.debug(`Bound soundboard sound ${soundId} in guild ${guildId}`);
	}

	clear(soundId: string): void {
		if (!(soundId in this.bindings)) return;
		const next = {...this.bindings};
		delete next[soundId];
		this.bindings = next;
	}

	/** Drop bindings for sounds that no longer exist in the guild. */
	prune(guildId: string, existingSoundIds: ReadonlySet<string>): void {
		let changed = false;
		const next = {...this.bindings};
		for (const [soundId, binding] of Object.entries(next)) {
			if (binding.guildId !== guildId || existingSoundIds.has(soundId)) continue;
			delete next[soundId];
			changed = true;
			logger.debug(`Pruned hotkey for missing sound ${soundId} in guild ${guildId}`);
		}
		if (changed) this.bindings = next;
	}
}

const normalizeKey = (key: string | undefined): string => {
	if (key === ' ' || key === 'Spacebar') return 'space';
	return (key ?? '').toLowerCase();
};

/**
 * Two combos would fire on the same keystroke. Defaults often carry only `key` while the
 * recorder stores `key` + `code`, so compare keys when both have one, else codes.
 */
export function combosMatch(a: KeyCombo, b: KeyCombo): boolean {
	const aKey = normalizeKey(a.key);
	const bKey = normalizeKey(b.key);
	const aCode = a.code ?? '';
	const bCode = b.code ?? '';
	const triggerMatches =
		a.mouseButton != null || b.mouseButton != null
			? (a.mouseButton ?? null) === (b.mouseButton ?? null)
			: aKey && bKey
				? aKey === bKey
				: aCode && bCode
					? aCode === bCode
					: false;
	return (
		triggerMatches &&
		!!a.ctrlOrMeta === !!b.ctrlOrMeta &&
		!!a.ctrl === !!b.ctrl &&
		!!a.alt === !!b.alt &&
		!!a.shift === !!b.shift &&
		!!a.meta === !!b.meta &&
		!!a.modifierOnly === !!b.modifierOnly &&
		(a.mouseButton ?? null) === (b.mouseButton ?? null)
	);
}

export default new SoundboardHotkeys();
