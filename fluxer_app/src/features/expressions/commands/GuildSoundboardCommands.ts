// SPDX-License-Identifier: AGPL-3.0-or-later

import {Endpoints} from '@app/features/app/constants/Endpoints';
import RuntimeConfig from '@app/features/app/state/RuntimeConfig';
import Guilds from '@app/features/guild/state/Guilds';
import {http} from '@app/features/platform/transport/RestTransport';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {resolveLimit} from '@fluxer/limits/src/LimitResolver';
import type {
	GuildSoundboardSettingsResponse,
	GuildSoundboardSoundResponse,
} from '@fluxer/schema/src/domains/guild/GuildSoundboardSchemas';

const logger = new Logger('SoundboardSounds');

export interface SoundboardLibrary {
	sounds: ReadonlyArray<GuildSoundboardSoundResponse>;
	maxDurationMs: number;
	maxSounds: number;
	maxDurationMsCeiling: number;
	maxSoundsCeiling: number;
	restartOnRepeat: boolean;
}

export async function list(guildId: string): Promise<SoundboardLibrary> {
	try {
		const response = await http.get<{
			sounds: ReadonlyArray<GuildSoundboardSoundResponse>;
			max_duration_ms: number;
			max_sounds: number;
			max_duration_ms_ceiling: number;
			max_sounds_ceiling: number;
			restart_on_repeat: boolean;
		}>(Endpoints.GUILD_SOUNDBOARD_SOUNDS(guildId));
		return {
			sounds: response.body.sounds,
			maxDurationMs: response.body.max_duration_ms,
			maxSounds: response.body.max_sounds,
			maxDurationMsCeiling: response.body.max_duration_ms_ceiling,
			maxSoundsCeiling: response.body.max_sounds_ceiling,
			restartOnRepeat: response.body.restart_on_repeat,
		};
	} catch (error) {
		logger.error(`Failed to list soundboard sounds for guild ${guildId}:`, error);
		throw error;
	}
}

export function isSoundboardEnabled(guildId: string): boolean {
	const guild = Guilds.getGuild(guildId);
	const resolved = resolveLimit(
		RuntimeConfig.limits,
		{traits: new Set(), guildFeatures: new Set(guild?.features ?? [])},
		'feature_guild_soundboard',
		{evaluationContext: 'guild'},
	);
	return !Number.isFinite(resolved) || resolved !== 0;
}

export interface SoundboardEmojiSelection {
	emojiId?: string | null;
	emojiName?: string | null;
}

export async function upload(
	guildId: string,
	name: string,
	emoji: SoundboardEmojiSelection,
	audio: string,
	volume?: number,
): Promise<GuildSoundboardSoundResponse> {
	try {
		const response = await http.post<GuildSoundboardSoundResponse>(Endpoints.GUILD_SOUNDBOARD_SOUNDS(guildId), {
			body: {
				name,
				emoji_id: emoji.emojiId ?? null,
				emoji_name: emoji.emojiName ?? null,
				...(volume !== undefined ? {volume} : {}),
				audio,
			},
		});
		return response.body;
	} catch (error) {
		logger.error(`Failed to upload soundboard sound in guild ${guildId}:`, error);
		throw error;
	}
}

export async function update(
	guildId: string,
	soundId: string,
	data: {name?: string; emoji?: SoundboardEmojiSelection; volume?: number},
): Promise<GuildSoundboardSoundResponse> {
	try {
		const body: Record<string, unknown> = {};
		if (data.name !== undefined) body.name = data.name;
		if (data.emoji !== undefined) {
			body.emoji_id = data.emoji.emojiId ?? null;
			body.emoji_name = data.emoji.emojiName ?? null;
		}
		if (data.volume !== undefined) body.volume = data.volume;
		const response = await http.patch<GuildSoundboardSoundResponse>(
			Endpoints.GUILD_SOUNDBOARD_SOUND(guildId, soundId),
			{
				body,
			},
		);
		return response.body;
	} catch (error) {
		logger.error(`Failed to update soundboard sound ${soundId} in guild ${guildId}:`, error);
		throw error;
	}
}

export async function remove(guildId: string, soundId: string): Promise<void> {
	try {
		await http.delete(Endpoints.GUILD_SOUNDBOARD_SOUND(guildId, soundId));
	} catch (error) {
		logger.error(`Failed to remove soundboard sound ${soundId} from guild ${guildId}:`, error);
		throw error;
	}
}

export async function updateSettings(
	guildId: string,
	data: {maxDurationMs: number; maxSounds: number; restartOnRepeat: boolean},
): Promise<GuildSoundboardSettingsResponse> {
	try {
		const response = await http.patch<GuildSoundboardSettingsResponse>(Endpoints.GUILD_SOUNDBOARD_SETTINGS(guildId), {
			body: {
				max_duration_ms: data.maxDurationMs,
				max_sounds: data.maxSounds,
				restart_on_repeat: data.restartOnRepeat,
			},
		});
		return response.body;
	} catch (error) {
		logger.error(`Failed to update soundboard settings for guild ${guildId}:`, error);
		throw error;
	}
}

export async function play(channelId: string, soundId: string): Promise<void> {
	try {
		await http.post(Endpoints.VOICE_CHANNEL_SOUNDBOARD_SOUND(channelId), {
			body: {sound_id: soundId},
		});
	} catch (error) {
		logger.error(`Failed to play soundboard sound ${soundId} in channel ${channelId}:`, error);
		throw error;
	}
}
