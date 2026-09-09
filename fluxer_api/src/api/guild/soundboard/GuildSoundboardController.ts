// SPDX-License-Identifier: AGPL-3.0-or-later

import {GuildIdParam, GuildIdSoundIdParam} from '@fluxer/schema/src/domains/common/CommonParamSchemas';
import {
	GuildSoundboardSettingsResponse,
	GuildSoundboardSettingsUpdateRequest,
	GuildSoundboardSoundListResponse,
	GuildSoundboardSoundResponse,
	GuildSoundboardSoundUpdateRequest,
	GuildSoundboardSoundUploadRequest,
} from '@fluxer/schema/src/domains/guild/GuildSoundboardSchemas';
import {createGuildID, createSoundboardSoundID} from '../../BrandedTypes';
import {LoginRequired} from '../../middleware/AuthMiddleware';
import {RateLimitMiddleware} from '../../middleware/RateLimitMiddleware';
import {OpenAPI} from '../../middleware/ResponseTypeMiddleware';
import {RateLimitConfigs} from '../../RateLimitConfig';
import type {HonoApp} from '../../types/HonoEnv';
import {Validator} from '../../Validator';
import {type SoundboardSoundEntry, serializeSoundboardSound} from './GuildSoundboardService';

function serializeEntry(entry: SoundboardSoundEntry) {
	return serializeSoundboardSound(entry.sound, entry.url, entry.user);
}

export function GuildSoundboardController(app: HonoApp) {
	app.get(
		'/guilds/:guild_id/soundboard-sounds',
		RateLimitMiddleware(RateLimitConfigs.GUILD_SOUNDBOARD_SOUNDS_LIST),
		LoginRequired,
		Validator('param', GuildIdParam),
		OpenAPI({
			operationId: 'list_guild_soundboard_sounds',
			summary: 'List guild soundboard sounds',
			description: 'Returns the soundboard sound library for the guild, plus the effective upload limits.',
			responseSchema: GuildSoundboardSoundListResponse,
			statusCode: 200,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: ['Guilds'],
		}),
		async (ctx) => {
			const userId = ctx.get('user').id;
			const guildId = createGuildID(ctx.req.valid('param').guild_id);
			const {sounds, limits} = await ctx
				.get('guildSoundboardService')
				.listLibrary(userId, guildId, ctx.get('requestCache'));
			return ctx.json(
				{
					sounds: sounds.map(serializeEntry),
					max_duration_ms: limits.maxDurationMs,
					max_sounds: limits.maxSounds,
					max_duration_ms_ceiling: limits.maxDurationMsCeiling,
					max_sounds_ceiling: limits.maxSoundsCeiling,
					restart_on_repeat: limits.restartOnRepeat,
				},
				200,
			);
		},
	);
	app.patch(
		'/guilds/:guild_id/soundboard-settings',
		RateLimitMiddleware(RateLimitConfigs.GUILD_SOUNDBOARD_SOUND_MUTATE),
		LoginRequired,
		Validator('param', GuildIdParam),
		Validator('json', GuildSoundboardSettingsUpdateRequest),
		OpenAPI({
			operationId: 'update_guild_soundboard_settings',
			summary: 'Update guild soundboard settings',
			description:
				'Sets the maximum soundboard sound duration, sound count, and repeat-playback behavior for the guild. Requires the Manage Guild permission.',
			requestSchema: GuildSoundboardSettingsUpdateRequest,
			responseSchema: GuildSoundboardSettingsResponse,
			statusCode: 200,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: ['Guilds'],
		}),
		async (ctx) => {
			const userId = ctx.get('user').id;
			const guildId = createGuildID(ctx.req.valid('param').guild_id);
			const {max_duration_ms, max_sounds, restart_on_repeat} = ctx.req.valid('json');
			const limits = await ctx.get('guildSoundboardService').updateSettings(userId, guildId, {
				maxDurationMs: max_duration_ms,
				maxSounds: max_sounds,
				restartOnRepeat: restart_on_repeat,
			});
			return ctx.json(
				{
					max_duration_ms: limits.maxDurationMs,
					max_sounds: limits.maxSounds,
					restart_on_repeat: limits.restartOnRepeat,
				},
				200,
			);
		},
	);
	app.post(
		'/guilds/:guild_id/soundboard-sounds',
		RateLimitMiddleware(RateLimitConfigs.GUILD_SOUNDBOARD_SOUND_CREATE),
		LoginRequired,
		Validator('param', GuildIdParam),
		Validator('json', GuildSoundboardSoundUploadRequest),
		OpenAPI({
			operationId: 'upload_guild_soundboard_sound',
			summary: 'Upload a guild soundboard sound',
			description:
				'Uploads a short audio clip to the guild soundboard library. Validates format, duration, and size server-side. Requires the Create Expressions permission.',
			requestSchema: GuildSoundboardSoundUploadRequest,
			responseSchema: GuildSoundboardSoundResponse,
			statusCode: 201,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: ['Guilds'],
		}),
		async (ctx) => {
			const userId = ctx.get('user').id;
			const guildId = createGuildID(ctx.req.valid('param').guild_id);
			const {name, emoji_id, emoji_name, volume, audio} = ctx.req.valid('json');
			const created = await ctx.get('guildSoundboardService').upload(
				{
					userId,
					guildId,
					name,
					emojiId: emoji_id != null ? emoji_id.toString() : null,
					emojiName: emoji_name ?? null,
					volume,
					base64Audio: audio,
				},
				ctx.get('requestCache'),
			);
			return ctx.json(serializeEntry(created), 201);
		},
	);
	app.patch(
		'/guilds/:guild_id/soundboard-sounds/:sound_id',
		RateLimitMiddleware(RateLimitConfigs.GUILD_SOUNDBOARD_SOUND_MUTATE),
		LoginRequired,
		Validator('param', GuildIdSoundIdParam),
		Validator('json', GuildSoundboardSoundUpdateRequest),
		OpenAPI({
			operationId: 'update_guild_soundboard_sound',
			summary: 'Update a guild soundboard sound',
			description: 'Updates the display label and/or emoji for a sound in the guild soundboard library.',
			requestSchema: GuildSoundboardSoundUpdateRequest,
			responseSchema: GuildSoundboardSoundResponse,
			statusCode: 200,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: ['Guilds'],
		}),
		async (ctx) => {
			const userId = ctx.get('user').id;
			const {guild_id, sound_id} = ctx.req.valid('param');
			const guildId = createGuildID(guild_id);
			const soundId = createSoundboardSoundID(sound_id);
			const body = ctx.req.valid('json');
			const emojiProvided = body.emoji_id !== undefined || body.emoji_name !== undefined;
			const updated = await ctx.get('guildSoundboardService').update(
				{
					userId,
					guildId,
					soundId,
					name: body.name,
					emoji: emojiProvided
						? {emojiId: body.emoji_id != null ? body.emoji_id.toString() : null, emojiName: body.emoji_name ?? null}
						: undefined,
					volume: body.volume,
				},
				ctx.get('requestCache'),
			);
			return ctx.json(serializeEntry(updated), 200);
		},
	);
	app.delete(
		'/guilds/:guild_id/soundboard-sounds/:sound_id',
		RateLimitMiddleware(RateLimitConfigs.GUILD_SOUNDBOARD_SOUND_MUTATE),
		LoginRequired,
		Validator('param', GuildIdSoundIdParam),
		OpenAPI({
			operationId: 'delete_guild_soundboard_sound',
			summary: 'Delete a guild soundboard sound',
			description: 'Removes a sound from the guild soundboard library.',
			responseSchema: null,
			statusCode: 204,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: ['Guilds'],
		}),
		async (ctx) => {
			const userId = ctx.get('user').id;
			const {guild_id, sound_id} = ctx.req.valid('param');
			const guildId = createGuildID(guild_id);
			const soundId = createSoundboardSoundID(sound_id);
			await ctx.get('guildSoundboardService').delete(userId, guildId, soundId);
			return ctx.body(null, 204);
		},
	);
}
