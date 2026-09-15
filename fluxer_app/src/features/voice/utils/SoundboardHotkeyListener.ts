// SPDX-License-Identifier: AGPL-3.0-or-later

import {keyboardEventStartsComboPress} from '@app/features/app/keybindings/KeybindEventUtils';
import KeybindManager from '@app/features/app/keybindings/KeybindManager';
import {isEditableElement} from '@app/features/app/keybindings/utils/EditableElement';
import * as GuildSoundboardCommands from '@app/features/expressions/commands/GuildSoundboardCommands';
import type {KeyCombo} from '@app/features/input/state/InputKeybind';
import Permission from '@app/features/permissions/state/Permission';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {isNativeMacOS} from '@app/features/ui/utils/NativeUtils';
import MediaEngine from '@app/features/voice/engine/MediaEngineFacade';
import SoundboardHotkeys from '@app/features/voice/state/SoundboardHotkeys';
import {findFluxerKeybindConflict} from '@app/features/voice/utils/SoundboardHotkeyConflicts';
import {Permissions} from '@fluxer/constants/src/ChannelConstants';

const logger = new Logger('SoundboardHotkeyListener');

export type SoundboardHotkeyPlayListener = (soundId: string) => void;
const playListeners = new Set<SoundboardHotkeyPlayListener>();

/** Lets the soundboard popover flash the tile when its sound was triggered by hotkey. */
export function subscribeToSoundboardHotkeyPlays(listener: SoundboardHotkeyPlayListener): () => void {
	playListeners.add(listener);
	return () => {
		playListeners.delete(listener);
	};
}

const hasNonShiftModifier = (combo: KeyCombo): boolean =>
	Boolean(combo.ctrlOrMeta || combo.ctrl || combo.alt || combo.meta);

const mouseModifiersMatch = (combo: KeyCombo, event: MouseEvent): boolean => {
	const isMacOS = isNativeMacOS();
	const expectsCtrl = Boolean(combo.ctrl || (combo.ctrlOrMeta && !isMacOS));
	const expectsMeta = Boolean(combo.meta || (combo.ctrlOrMeta && isMacOS));
	return (
		event.ctrlKey === expectsCtrl &&
		event.metaKey === expectsMeta &&
		event.altKey === Boolean(combo.alt) &&
		event.shiftKey === Boolean(combo.shift)
	);
};

interface ActiveSoundboardTarget {
	guildId: string;
	channelId: string;
}

/**
 * Hotkeys only do something while this member is connected to a guild voice channel where
 * the soundboard is enabled and they may use it — the same gate as the voice-bar button.
 */
function resolveActiveTarget(): ActiveSoundboardTarget | null {
	const guildId = MediaEngine.guildId;
	const channelId = MediaEngine.channelId;
	if (!guildId || !channelId) return null;
	if (!GuildSoundboardCommands.isSoundboardEnabled(guildId)) return null;
	if (!Permission.can(Permissions.USE_SOUNDBOARD, {channelId})) return null;
	return {guildId, channelId};
}

function trigger(target: ActiveSoundboardTarget, soundId: string): void {
	void GuildSoundboardCommands.play(target.channelId, soundId).catch((error) =>
		logger.error(`Hotkey play failed for sound ${soundId}`, error),
	);
	for (const listener of playListeners) listener(soundId);
}

function handleKeyDown(event: KeyboardEvent): void {
	if (event.defaultPrevented || event.repeat) return;
	// Suspended while the keybind recorder is capturing, so recording a hotkey never fires one.
	if (KeybindManager.isSuspended()) return;
	const target = resolveActiveTarget();
	if (!target) return;
	const bindings = SoundboardHotkeys.getBindingsForGuild(target.guildId);
	if (bindings.length === 0) return;
	const typing = isEditableElement(event.target ?? null);
	const isMacOS = isNativeMacOS();
	for (const {soundId, combo} of bindings) {
		if (combo.mouseButton != null) continue;
		// Plain keys keep typing in the chat box; only modifier chords fire from an input.
		if (typing && !hasNonShiftModifier(combo)) continue;
		if (!keyboardEventStartsComboPress(combo, event, {isMacOS})) continue;
		// A Fluxer shortcut on the same keys always wins; leave the event to it.
		if (findFluxerKeybindConflict(combo) != null) continue;
		event.preventDefault();
		event.stopPropagation();
		trigger(target, soundId);
		return;
	}
}

function handleMouseDown(event: MouseEvent): void {
	if (event.defaultPrevented) return;
	if (KeybindManager.isSuspended()) return;
	const target = resolveActiveTarget();
	if (!target) return;
	for (const {soundId, combo} of SoundboardHotkeys.getBindingsForGuild(target.guildId)) {
		if (combo.mouseButton == null || combo.mouseButton !== event.button) continue;
		if (!mouseModifiersMatch(combo, event)) continue;
		if (findFluxerKeybindConflict(combo) != null) continue;
		event.preventDefault();
		event.stopPropagation();
		trigger(target, soundId);
		return;
	}
}

/**
 * Installed once at app start. Listens on document (capture) so KeybindManager's window
 * capture listeners always run first and stop propagation when a Fluxer shortcut matches;
 * the Combokeys-routed defaults bind later in the bubble phase, which is why
 * findFluxerKeybindConflict is also checked per binding above.
 */
export function installSoundboardHotkeyListener(): () => void {
	document.addEventListener('keydown', handleKeyDown, true);
	document.addEventListener('mousedown', handleMouseDown, true);
	return () => {
		document.removeEventListener('keydown', handleKeyDown, true);
		document.removeEventListener('mousedown', handleMouseDown, true);
	};
}
