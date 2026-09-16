// SPDX-License-Identifier: AGPL-3.0-or-later

export type SoundboardPlaySource = 'local' | 'remote';
export type SoundboardPlayListener = (soundId: string, source: SoundboardPlaySource) => void;

const listeners = new Set<SoundboardPlayListener>();

/**
 * In-process feed of "sound X just played in my call", regardless of who triggered it —
 * a tile click, a hotkey, or another member (via SOUNDBOARD_SOUND_PLAY). The soundboard
 * popover uses it to flash the tile so everyone sees what's playing.
 */
export function emitSoundboardPlay(soundId: string, source: SoundboardPlaySource): void {
	for (const listener of listeners) listener(soundId, source);
}

export function subscribeToSoundboardPlays(listener: SoundboardPlayListener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
