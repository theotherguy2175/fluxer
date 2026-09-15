// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	SOUNDBOARD_EMOJI_MAX_LENGTH,
	SOUNDBOARD_MAX_BYTES,
	SOUNDBOARD_MAX_DURATION_CEILING_MS,
	SOUNDBOARD_MAX_SOUNDS_CEILING,
	SOUNDBOARD_MAX_VOLUME,
	SOUNDBOARD_MIN_DURATION_MS,
	SOUNDBOARD_NAME_MAX_LENGTH,
	SOUNDBOARD_SOUND_EXTENSIONS,
} from '@fluxer/constants/src/SoundboardConstants';
import {UserPartialResponse} from '@fluxer/schema/src/domains/user/UserResponseSchemas';
import {isValidSingleUnicodeEmoji} from '@fluxer/schema/src/primitives/EmojiValidators';
import {createBase64StringType} from '@fluxer/schema/src/primitives/FileValidators';
import {createStringType, SnowflakeStringType, SnowflakeType} from '@fluxer/schema/src/primitives/SchemaPrimitives';
import {z} from 'zod';

const SOUNDBOARD_SOUND_BASE64_MAX_CHARS = Math.ceil((SOUNDBOARD_MAX_BYTES * 4) / 3) + 32;

function toNonEmptyStringTuple<TValue extends string>(values: ReadonlyArray<TValue>): [TValue, ...Array<TValue>] {
	const [first, ...rest] = values;
	if (first === undefined) {
		throw new Error('Expected at least one enum value');
	}
	return [first, ...rest];
}

const SoundboardSoundExtensionValues = toNonEmptyStringTuple(SOUNDBOARD_SOUND_EXTENSIONS);

const EmojiIdField = SnowflakeType.nullish().describe('ID of a custom emoji from this community');
const EmojiNameField = createStringType(1, SOUNDBOARD_EMOJI_MAX_LENGTH)
	.nullish()
	.describe('Unicode emoji character (ignored when emoji_id is provided)');
const VolumeField = z
	.number()
	.min(0)
	.max(SOUNDBOARD_MAX_VOLUME)
	.optional()
	.describe('Playback volume as a multiplier, 0 to 2 (default 1; above 1 boosts the sound)');

function hasValidEmoji(value: {emoji_id?: unknown; emoji_name?: unknown}): boolean {
	if (value.emoji_id != null) return true;
	return typeof value.emoji_name === 'string' && isValidSingleUnicodeEmoji(value.emoji_name);
}

export const GuildSoundboardSoundUploadRequest = z
	.object({
		name: createStringType(1, SOUNDBOARD_NAME_MAX_LENGTH).describe('Display label for the sound'),
		emoji_id: EmojiIdField,
		emoji_name: EmojiNameField,
		volume: VolumeField,
		audio: createBase64StringType(1, SOUNDBOARD_SOUND_BASE64_MAX_CHARS).describe('Base64-encoded audio bytes'),
	})
	.refine(hasValidEmoji, {
		message: 'A sound must have a custom emoji id or a valid Unicode emoji',
		path: ['emoji_name'],
	});

export type GuildSoundboardSoundUploadRequest = z.infer<typeof GuildSoundboardSoundUploadRequest>;

export const GuildSoundboardSoundUpdateRequest = z
	.object({
		name: createStringType(1, SOUNDBOARD_NAME_MAX_LENGTH).optional(),
		emoji_id: EmojiIdField,
		emoji_name: EmojiNameField,
		volume: VolumeField,
	})
	.refine((value) => (value.emoji_id === undefined && value.emoji_name === undefined ? true : hasValidEmoji(value)), {
		message: 'A sound must have a custom emoji id or a valid Unicode emoji',
		path: ['emoji_name'],
	});

export type GuildSoundboardSoundUpdateRequest = z.infer<typeof GuildSoundboardSoundUpdateRequest>;

export const GuildSoundboardSoundResponse = z.object({
	id: SnowflakeStringType,
	name: z.string(),
	emoji_id: SnowflakeStringType.nullable(),
	emoji_name: z.string().nullable(),
	emoji_animated: z.boolean(),
	volume: z.number().min(0).max(SOUNDBOARD_MAX_VOLUME),
	hash: z.string(),
	extension: z.enum(SoundboardSoundExtensionValues),
	content_type: z.string(),
	duration_ms: z.number().int().min(0).max(SOUNDBOARD_MAX_DURATION_CEILING_MS),
	size_bytes: z.number().int().min(0).max(SOUNDBOARD_MAX_BYTES),
	creator_id: SnowflakeStringType,
	user: z
		.lazy(() => UserPartialResponse)
		.nullable()
		.describe('The user who uploaded this sound, when resolved'),
	url: z.string().url(),
	created_at: z.string().datetime(),
});

export type GuildSoundboardSoundResponse = z.infer<typeof GuildSoundboardSoundResponse>;

export const GuildSoundboardSoundListResponse = z.object({
	sounds: z.array(GuildSoundboardSoundResponse),
	max_duration_ms: z.number().int(),
	max_sounds: z.number().int(),
	max_duration_ms_ceiling: z.number().int(),
	max_sounds_ceiling: z.number().int(),
	restart_on_repeat: z.boolean(),
});

export type GuildSoundboardSoundListResponse = z.infer<typeof GuildSoundboardSoundListResponse>;

export const GuildSoundboardSettingsResponse = z.object({
	max_duration_ms: z.number().int(),
	max_sounds: z.number().int(),
	restart_on_repeat: z.boolean(),
});

export type GuildSoundboardSettingsResponse = z.infer<typeof GuildSoundboardSettingsResponse>;

export const GuildSoundboardSettingsUpdateRequest = z.object({
	max_duration_ms: z.number().int().min(SOUNDBOARD_MIN_DURATION_MS).max(SOUNDBOARD_MAX_DURATION_CEILING_MS),
	max_sounds: z.number().int().min(1).max(SOUNDBOARD_MAX_SOUNDS_CEILING),
	restart_on_repeat: z.boolean(),
});

export type GuildSoundboardSettingsUpdateRequest = z.infer<typeof GuildSoundboardSettingsUpdateRequest>;

export const SoundboardSoundPlayRequest = z.object({
	sound_id: SnowflakeType,
});

export type SoundboardSoundPlayRequest = z.infer<typeof SoundboardSoundPlayRequest>;
