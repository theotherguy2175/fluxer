// SPDX-License-Identifier: AGPL-3.0-or-later

export const SOUNDBOARD_SOUND_PATH_PREFIX = 'soundboard-sounds';
// 5 MB: room for a 30 s (the duration ceiling) MP3 at 320 kbps, or ~28 s of 16-bit mono WAV.
// Uploads travel base64 in JSON like avatars/banners (10 MB), so no proxy limits are in play.
export const SOUNDBOARD_MAX_BYTES = 5 * 1024 * 1024;
export const SOUNDBOARD_MIN_DURATION_MS = 100;
export const SOUNDBOARD_NAME_MAX_LENGTH = 32;
export const SOUNDBOARD_EMOJI_MAX_LENGTH = 32;
// Per-sound playback volume, as a multiplier. 1 = as uploaded; up to 2 = +100%.
export const SOUNDBOARD_MAX_VOLUME = 2;

export const SOUNDBOARD_DEFAULT_MAX_DURATION_MS = 5000;
export const SOUNDBOARD_MAX_DURATION_CEILING_MS = 30_000;
export const SOUNDBOARD_DEFAULT_MAX_SOUNDS = 9;
// Instance-wide ceiling on how fast one member may trigger sounds in a channel.
// 25/s is comfortably above the fastest human clicking; it exists to stop scripts.
export const SOUNDBOARD_DEFAULT_MAX_PLAYS_PER_SECOND = 25;
export const SOUNDBOARD_MAX_PLAYS_PER_SECOND_CEILING = 100;
export const SOUNDBOARD_MAX_SOUNDS_CEILING = 200;

export type SoundboardSoundExtension = 'mp3' | 'ogg' | 'm4a' | 'wav';

export const SOUNDBOARD_SOUND_EXTENSIONS: ReadonlyArray<SoundboardSoundExtension> = Object.freeze([
	'mp3',
	'ogg',
	'm4a',
	'wav',
]);

const SOUNDBOARD_SOUND_MIME_TO_EXT: Readonly<Record<string, SoundboardSoundExtension>> = Object.freeze({
	'audio/mpeg': 'mp3',
	'audio/mp3': 'mp3',
	'audio/ogg': 'ogg',
	'audio/mp4': 'm4a',
	'audio/x-m4a': 'm4a',
	'audio/wav': 'wav',
	'audio/wave': 'wav',
	'audio/x-wav': 'wav',
});

export const SOUNDBOARD_SOUND_EXT_TO_MIME: Readonly<Record<SoundboardSoundExtension, string>> = Object.freeze({
	mp3: 'audio/mpeg',
	ogg: 'audio/ogg',
	m4a: 'audio/mp4',
	wav: 'audio/wav',
});

function isSoundboardSoundExtension(value: string): value is SoundboardSoundExtension {
	return SOUNDBOARD_SOUND_EXTENSIONS.includes(value as SoundboardSoundExtension);
}

export function soundboardSoundExtensionFromMime(
	contentType: string | null | undefined,
): SoundboardSoundExtension | null {
	if (!contentType) return null;
	const normalized = contentType.toLowerCase().split(';', 1)[0]?.trim() ?? '';
	return SOUNDBOARD_SOUND_MIME_TO_EXT[normalized] ?? null;
}

export function soundboardSoundExtensionFromFormat(format: string | null | undefined): SoundboardSoundExtension | null {
	if (!format) return null;
	const parts = format
		.toLowerCase()
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
	for (const normalized of parts.length > 0 ? parts : [format.toLowerCase().trim()]) {
		if (isSoundboardSoundExtension(normalized)) return normalized;
		if (normalized === 'mpeg' || normalized === 'mp3' || normalized === 'mp2' || normalized === 'mp1') return 'mp3';
		if (normalized === 'ogg' || normalized === 'oga' || normalized === 'opus') return 'ogg';
		if (
			normalized === 'mp4' ||
			normalized === 'm4a' ||
			normalized === 'aac' ||
			normalized === 'mov' ||
			normalized === '3gp' ||
			normalized === '3g2'
		) {
			return 'm4a';
		}
		if (normalized === 'wav' || normalized === 'wave' || normalized === 'pcm_s16le' || normalized === 'pcm')
			return 'wav';
	}
	return null;
}
