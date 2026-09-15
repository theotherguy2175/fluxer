// SPDX-License-Identifier: AGPL-3.0-or-later

import Keybind, {type KeyCombo} from '@app/features/input/state/InputKeybind';
import {combosMatch} from '@app/features/voice/state/SoundboardHotkeys';

const hasTrigger = (combo: KeyCombo): boolean =>
	(combo.key ?? '') !== '' || (combo.code ?? '') !== '' || combo.mouseButton != null;

/**
 * Label of the Fluxer shortcut (built-in or custom) that already uses this combo, or null.
 * Fluxer's own shortcuts always take precedence over soundboard hotkeys, so the UI warns
 * about it and the runtime skips such a hotkey rather than fighting over the key.
 */
export function findFluxerKeybindConflict(combo: KeyCombo): string | null {
	if (!hasTrigger(combo)) return null;
	const customs = Keybind.getCustomKeybinds();
	for (const custom of customs) {
		if (!custom.enabled || !hasTrigger(custom.combo)) continue;
		if (!combosMatch(custom.combo, combo)) continue;
		return custom.action ? (Keybind.getDefaultByAction(custom.action)?.label ?? custom.action) : '';
	}
	if (Keybind.getDisableBuiltinKeybinds()) return null;
	const overridden = new Set(customs.map((entry) => entry.action).filter((action) => action != null));
	for (const entry of Keybind.getDefaults()) {
		if (entry.informationalOnly || overridden.has(entry.action) || !hasTrigger(entry.combo)) continue;
		if (combosMatch(entry.combo, combo)) return entry.label;
	}
	return null;
}
