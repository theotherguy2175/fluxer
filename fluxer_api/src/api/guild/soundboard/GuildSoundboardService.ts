// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from 'node:crypto';
import {resolveEntranceSoundDurationMs} from '@app/api/user/entrance_sound/EntranceSoundDurationProbe';
import {AuditLogActionType} from '@fluxer/constants/src/AuditLogActionType';
import {Permissions} from '@fluxer/constants/src/ChannelConstants';
import {
	SOUNDBOARD_DEFAULT_MAX_DURATION_MS,
	SOUNDBOARD_DEFAULT_MAX_SOUNDS,
	SOUNDBOARD_MAX_BYTES,
	SOUNDBOARD_MIN_DURATION_MS,
	SOUNDBOARD_NAME_MAX_LENGTH,
	SOUNDBOARD_SOUND_EXT_TO_MIME,
	SOUNDBOARD_SOUND_PATH_PREFIX,
	type SoundboardSoundExtension,
	soundboardSoundExtensionFromFormat,
	soundboardSoundExtensionFromMime,
} from '@fluxer/constants/src/SoundboardConstants';
import {ValidationErrorCodes} from '@fluxer/constants/src/ValidationErrorCodes';
import {FeatureTemporarilyDisabledError} from '@fluxer/errors/src/domains/core/FeatureTemporarilyDisabledError';
import {InputValidationError} from '@fluxer/errors/src/domains/core/InputValidationError';
import type {UserPartialResponse} from '@fluxer/schema/src/domains/user/UserResponseSchemas';
import {isValidSingleUnicodeEmoji} from '@fluxer/schema/src/primitives/EmojiValidators';
import {generateSnowflake} from '@fluxer/snowflake/src/Snowflake';
import {
	createEmojiID,
	createSoundboardSoundID,
	type EmojiID,
	type GuildID,
	type SoundboardSoundID,
	type UserID,
} from '../../BrandedTypes';
import {Config} from '../../Config';
import type {GuildSoundboardSettingsRow} from '../../database/types/GuildTypes';
import type {IGatewayService} from '../../infrastructure/IGatewayService';
import type {IMediaService} from '../../infrastructure/IMediaService';
import type {IStorageService} from '../../infrastructure/IStorageService';
import type {UserCacheService} from '../../infrastructure/UserCacheService';
import {Logger} from '../../Logger';
import type {LimitConfigService} from '../../limits/LimitConfigService';
import {resolveLimitSafe} from '../../limits/LimitConfigUtils';
import {createLimitMatchContext} from '../../limits/LimitMatchContextBuilder';
import type {RequestCache} from '../../middleware/RequestCacheMiddleware';
import {GuildSoundboardSound} from '../../models/GuildSoundboardSound';
import {getCachedUserPartialResponses} from '../../user/UserCacheHelpers';
import {serializeSoundboardSoundForAudit} from '../../utils/AuditSerializationUtils';
import {requirePermission} from '../../utils/PermissionUtils';
import type {GuildAuditLogService} from '../GuildAuditLogService';
import type {GuildRepository} from '../repositories/GuildRepository';
import type {GuildSoundboardRepository} from './GuildSoundboardRepository';

interface EmojiInput {
	emojiId?: string | null;
	emojiName?: string | null;
}

interface ResolvedEmoji {
	emojiId: EmojiID | null;
	emojiName: string | null;
	emojiAnimated: boolean;
}

interface UploadSoundboardSoundParams extends EmojiInput {
	userId: UserID;
	guildId: GuildID;
	name: string;
	volume?: number;
	base64Audio: string;
}

interface UpdateSoundboardSoundParams {
	userId: UserID;
	guildId: GuildID;
	soundId: SoundboardSoundID;
	name?: string;
	emoji?: EmojiInput;
	volume?: number;
}

function clampVolume(value: number | undefined, fallback: number): number {
	if (value == null || !Number.isFinite(value)) return fallback;
	return Math.min(1, Math.max(0, value));
}

export interface SoundboardSoundEntry {
	sound: GuildSoundboardSound;
	url: string;
	user: UserPartialResponse | null;
}

interface EffectiveSoundboardLimits {
	maxDurationMs: number;
	maxSounds: number;
	maxDurationMsCeiling: number;
	maxSoundsCeiling: number;
	restartOnRepeat: boolean;
}

const SOUNDBOARD_DEFAULT_RESTART_ON_REPEAT = false;

export class GuildSoundboardService {
	constructor(
		private readonly repository: GuildSoundboardRepository,
		private readonly storageService: IStorageService,
		private readonly mediaService: IMediaService,
		private readonly gatewayService: IGatewayService,
		private readonly guildRepository: GuildRepository,
		private readonly userCacheService: UserCacheService,
		private readonly limitConfigService: LimitConfigService,
		private readonly auditLogService: GuildAuditLogService,
	) {}

	private async recordAuditLog(params: {
		guildId: GuildID;
		userId: UserID;
		action: AuditLogActionType;
		soundId: SoundboardSoundID;
		changes: ReturnType<GuildAuditLogService['computeChanges']>;
	}): Promise<void> {
		try {
			await this.auditLogService
				.createBuilder(params.guildId, params.userId)
				.withAction(params.action, params.soundId.toString())
				.withReason(null)
				.withChanges(params.changes)
				.commit();
		} catch (error) {
			Logger.error(
				{error, guildId: params.guildId.toString(), soundId: params.soundId.toString(), action: params.action},
				'Failed to record soundboard audit log',
			);
		}
	}

	private instanceLimits(): {maxSounds: number; maxDurationMs: number; enabled: boolean} {
		const snapshot = this.limitConfigService.getConfigSnapshot();
		const ctx = createLimitMatchContext({user: null});
		return {
			maxSounds: resolveLimitSafe(
				snapshot,
				ctx,
				'max_soundboard_sounds_per_guild',
				SOUNDBOARD_DEFAULT_MAX_SOUNDS,
				'guild',
			),
			maxDurationMs: resolveLimitSafe(
				snapshot,
				ctx,
				'max_soundboard_sound_duration_ms',
				SOUNDBOARD_DEFAULT_MAX_DURATION_MS,
				'guild',
			),
			enabled: resolveLimitSafe(snapshot, ctx, 'feature_guild_soundboard', 1, 'guild') !== 0,
		};
	}

	assertEnabled(): void {
		if (!this.instanceLimits().enabled) {
			throw new FeatureTemporarilyDisabledError();
		}
	}

	cdnUrlFor(sound: GuildSoundboardSound): string {
		return `${Config.endpoints.media}/${SOUNDBOARD_SOUND_PATH_PREFIX}/${sound.guildId}/${sound.hash}.${sound.extension}`;
	}

	private s3KeyFor(guildId: GuildID, hash: string, extension: SoundboardSoundExtension): string {
		return `${SOUNDBOARD_SOUND_PATH_PREFIX}/${guildId}/${hash}.${extension}`;
	}

	async getEffectiveLimits(guildId: GuildID): Promise<EffectiveSoundboardLimits> {
		const [settings, instance] = await Promise.all([
			this.repository.getSettings(guildId),
			Promise.resolve(this.instanceLimits()),
		]);
		return {
			maxDurationMs: Math.min(settings?.max_duration_ms ?? instance.maxDurationMs, instance.maxDurationMs),
			maxSounds: Math.min(settings?.max_sounds ?? instance.maxSounds, instance.maxSounds),
			maxDurationMsCeiling: instance.maxDurationMs,
			maxSoundsCeiling: instance.maxSounds,
			restartOnRepeat: settings?.restart_on_repeat ?? SOUNDBOARD_DEFAULT_RESTART_ON_REPEAT,
		};
	}

	async listLibrary(
		userId: UserID,
		guildId: GuildID,
		requestCache: RequestCache,
	): Promise<{sounds: Array<SoundboardSoundEntry>; limits: EffectiveSoundboardLimits}> {
		await this.gatewayService.getGuildData({guildId, userId});
		const [sounds, limits] = await Promise.all([this.repository.listSounds(guildId), this.getEffectiveLimits(guildId)]);
		const userIds = [...new Set(sounds.map((sound) => sound.creatorId))];
		const users = await getCachedUserPartialResponses({
			userIds,
			userCacheService: this.userCacheService,
			requestCache,
		});
		return {
			sounds: sounds.map((sound) => ({
				sound,
				url: this.cdnUrlFor(sound),
				user: users.get(sound.creatorId) ?? null,
			})),
			limits,
		};
	}

	async updateSettings(
		userId: UserID,
		guildId: GuildID,
		params: {maxDurationMs: number; maxSounds: number; restartOnRepeat: boolean},
	): Promise<EffectiveSoundboardLimits> {
		this.assertEnabled();
		await requirePermission(this.gatewayService, {guildId, userId, permission: Permissions.MANAGE_GUILD});
		const instance = this.instanceLimits();
		const requestedDurationMs = Math.max(SOUNDBOARD_MIN_DURATION_MS, params.maxDurationMs);
		const requestedSounds = Math.max(1, params.maxSounds);
		if (requestedDurationMs > instance.maxDurationMs) {
			throw InputValidationError.fromCode(
				'max_duration_ms',
				ValidationErrorCodes.SOUNDBOARD_SETTING_EXCEEDS_INSTANCE_LIMIT,
				{max: `${instance.maxDurationMs / 1000}s`},
			);
		}
		if (requestedSounds > instance.maxSounds) {
			throw InputValidationError.fromCode(
				'max_sounds',
				ValidationErrorCodes.SOUNDBOARD_SETTING_EXCEEDS_INSTANCE_LIMIT,
				{max: instance.maxSounds},
			);
		}
		const installedCount = (await this.repository.listSounds(guildId)).length;
		if (requestedSounds < installedCount) {
			throw InputValidationError.fromCode('max_sounds', ValidationErrorCodes.SOUNDBOARD_MAX_SOUNDS_BELOW_INSTALLED, {
				installed: installedCount,
				max: requestedSounds,
			});
		}
		const existing = await this.repository.getSettings(guildId);
		const row: GuildSoundboardSettingsRow = {
			guild_id: guildId,
			max_duration_ms: requestedDurationMs,
			max_sounds: requestedSounds,
			restart_on_repeat: params.restartOnRepeat,
			version: (existing?.version ?? 0) + 1,
		};
		await this.repository.upsertSettings(row);
		return this.getEffectiveLimits(guildId);
	}

	async getSoundWithUrl(guildId: GuildID, soundId: SoundboardSoundID): Promise<SoundboardSoundEntry | null> {
		const sound = await this.repository.getSound(guildId, soundId);
		if (!sound) return null;
		return {sound, url: this.cdnUrlFor(sound), user: null};
	}

	private async resolveCreator(
		sound: GuildSoundboardSound,
		requestCache: RequestCache,
	): Promise<UserPartialResponse | null> {
		const users = await getCachedUserPartialResponses({
			userIds: [sound.creatorId],
			userCacheService: this.userCacheService,
			requestCache,
		});
		return users.get(sound.creatorId) ?? null;
	}

	async upload(params: UploadSoundboardSoundParams, requestCache: RequestCache): Promise<SoundboardSoundEntry> {
		const {userId, guildId, base64Audio} = params;
		this.assertEnabled();
		await requirePermission(this.gatewayService, {guildId, userId, permission: Permissions.CREATE_EXPRESSIONS});
		const name = this.normalizeName(params.name);
		const emoji = await this.resolveEmoji(guildId, params);
		const [existing, limits] = await Promise.all([
			this.repository.listSounds(guildId),
			this.getEffectiveLimits(guildId),
		]);
		if (existing.length >= limits.maxSounds) {
			throw InputValidationError.fromCode('audio', ValidationErrorCodes.SOUNDBOARD_SOUND_QUOTA_REACHED, {
				max: limits.maxSounds,
			});
		}
		const trimmed = base64Audio.includes(',') ? (base64Audio.split(',')[1] ?? '') : base64Audio;
		let bytes: Buffer;
		try {
			bytes = Buffer.from(trimmed, 'base64');
		} catch {
			throw InputValidationError.fromCode('audio', ValidationErrorCodes.INVALID_BASE64_FORMAT);
		}
		if (bytes.length === 0) {
			throw InputValidationError.fromCode('audio', ValidationErrorCodes.INVALID_BASE64_FORMAT);
		}
		if (bytes.length > SOUNDBOARD_MAX_BYTES) {
			throw InputValidationError.fromCode('audio', ValidationErrorCodes.SOUNDBOARD_SOUND_SIZE_EXCEEDS_LIMIT, {
				max_bytes: SOUNDBOARD_MAX_BYTES,
			});
		}
		const metadata = await this.mediaService.getMetadata({
			type: 'base64',
			base64: trimmed,
			version: 2,
			nsfw: 'allow',
		});
		if (!metadata) {
			throw InputValidationError.fromCode('audio', ValidationErrorCodes.SOUNDBOARD_SOUND_INVALID_FORMAT);
		}
		const extension =
			soundboardSoundExtensionFromFormat(metadata.format) ?? soundboardSoundExtensionFromMime(metadata.content_type);
		if (!extension) {
			throw InputValidationError.fromCode('audio', ValidationErrorCodes.SOUNDBOARD_SOUND_INVALID_FORMAT, {
				format: metadata.format ?? metadata.content_type ?? 'unknown',
			});
		}
		const metadataDurationSeconds = typeof metadata.duration === 'number' ? metadata.duration : null;
		const durationMs = await resolveEntranceSoundDurationMs({
			bytes,
			extension,
			metadataDurationSeconds,
		});
		if (durationMs == null) {
			throw InputValidationError.fromCode('audio', ValidationErrorCodes.SOUNDBOARD_SOUND_INVALID_FORMAT);
		}
		if (durationMs > limits.maxDurationMs) {
			throw InputValidationError.fromCode('audio', ValidationErrorCodes.SOUNDBOARD_SOUND_DURATION_EXCEEDS_LIMIT, {
				max_ms: limits.maxDurationMs,
			});
		}
		if (durationMs < SOUNDBOARD_MIN_DURATION_MS) {
			throw InputValidationError.fromCode('audio', ValidationErrorCodes.SOUNDBOARD_SOUND_DURATION_EXCEEDS_LIMIT, {
				min_ms: SOUNDBOARD_MIN_DURATION_MS,
			});
		}
		const hash = crypto.createHash('md5').update(bytes).digest('hex').slice(0, 16);
		const contentType = SOUNDBOARD_SOUND_EXT_TO_MIME[extension];
		const s3Key = this.s3KeyFor(guildId, hash, extension);
		try {
			await this.storageService.uploadObject({
				bucket: Config.s3.buckets.cdn,
				key: s3Key,
				body: new Uint8Array(bytes),
				contentType,
			});
		} catch (error) {
			Logger.error({error, guildId: guildId.toString(), s3Key}, 'Failed to upload soundboard sound to S3');
			throw InputValidationError.fromCode('audio', ValidationErrorCodes.FAILED_TO_UPLOAD_IMAGE);
		}
		const sound = new GuildSoundboardSound({
			guild_id: guildId,
			sound_id: createSoundboardSoundID(generateSnowflake()),
			name,
			emoji_id: emoji.emojiId,
			emoji_name: emoji.emojiName,
			emoji_animated: emoji.emojiAnimated,
			volume: clampVolume(params.volume, 1),
			creator_id: userId,
			hash,
			extension,
			content_type: contentType,
			duration_ms: durationMs,
			size_bytes: bytes.length,
			created_at: new Date(),
			version: 1,
		});
		try {
			await this.repository.upsertSound(sound);
		} catch (error) {
			Logger.error({error, guildId: guildId.toString(), s3Key}, 'Failed to persist soundboard sound; rolling back S3');
			await this.storageService.deleteObject(Config.s3.buckets.cdn, s3Key).catch(() => {});
			throw error;
		}
		await this.recordAuditLog({
			guildId,
			userId,
			action: AuditLogActionType.SOUNDBOARD_SOUND_CREATE,
			soundId: sound.soundId,
			changes: this.auditLogService.computeChanges(null, serializeSoundboardSoundForAudit(sound)),
		});
		const entry = {sound, url: this.cdnUrlFor(sound), user: await this.resolveCreator(sound, requestCache)};
		await this.dispatchSoundboardSoundsUpdate(guildId);
		return entry;
	}

	async update(params: UpdateSoundboardSoundParams, requestCache: RequestCache): Promise<SoundboardSoundEntry> {
		const {userId, guildId, soundId} = params;
		const existing = await this.repository.getSound(guildId, soundId);
		if (!existing) {
			throw InputValidationError.fromCode('sound_id', ValidationErrorCodes.SOUNDBOARD_SOUND_NOT_FOUND);
		}
		await this.checkModifyPermission({userId, guildId, creatorId: existing.creatorId});
		const name = params.name !== undefined ? this.normalizeName(params.name) : existing.name;
		const emoji =
			params.emoji !== undefined
				? await this.resolveEmoji(guildId, params.emoji)
				: {emojiId: existing.emojiId, emojiName: existing.emojiName, emojiAnimated: existing.emojiAnimated};
		const next = new GuildSoundboardSound({
			...existing.toRow(),
			name,
			emoji_id: emoji.emojiId,
			emoji_name: emoji.emojiName,
			emoji_animated: emoji.emojiAnimated,
			volume: params.volume !== undefined ? clampVolume(params.volume, existing.volume) : existing.volume,
			version: existing.version + 1,
		});
		await this.repository.upsertSound(next);
		await this.recordAuditLog({
			guildId,
			userId,
			action: AuditLogActionType.SOUNDBOARD_SOUND_UPDATE,
			soundId,
			changes: this.auditLogService.computeChanges(
				serializeSoundboardSoundForAudit(existing),
				serializeSoundboardSoundForAudit(next),
			),
		});
		const entry = {sound: next, url: this.cdnUrlFor(next), user: await this.resolveCreator(next, requestCache)};
		await this.dispatchSoundboardSoundsUpdate(guildId);
		return entry;
	}

	async delete(userId: UserID, guildId: GuildID, soundId: SoundboardSoundID): Promise<void> {
		const existing = await this.repository.getSound(guildId, soundId);
		if (!existing) return;
		await this.checkModifyPermission({userId, guildId, creatorId: existing.creatorId});
		await this.repository.deleteSound(guildId, soundId);
		const s3Key = this.s3KeyFor(guildId, existing.hash, existing.extension as SoundboardSoundExtension);
		await this.storageService.deleteObject(Config.s3.buckets.cdn, s3Key).catch((error) => {
			Logger.error({error, guildId: guildId.toString(), s3Key}, 'Failed to delete soundboard sound from S3');
		});
		await this.recordAuditLog({
			guildId,
			userId,
			action: AuditLogActionType.SOUNDBOARD_SOUND_DELETE,
			soundId,
			changes: this.auditLogService.computeChanges(serializeSoundboardSoundForAudit(existing), null),
		});
		await this.dispatchSoundboardSoundsUpdate(guildId);
	}

	private async checkModifyPermission(params: {userId: UserID; guildId: GuildID; creatorId: UserID}): Promise<void> {
		const {userId, guildId, creatorId} = params;
		if (userId === creatorId) {
			await requirePermission(this.gatewayService, {guildId, userId, permission: Permissions.CREATE_EXPRESSIONS});
			return;
		}
		await requirePermission(this.gatewayService, {guildId, userId, permission: Permissions.MANAGE_EXPRESSIONS});
	}

	private async dispatchSoundboardSoundsUpdate(guildId: GuildID): Promise<void> {
		const sounds = await this.repository.listSounds(guildId);
		await this.gatewayService.dispatchGuild({
			guildId,
			event: 'SOUNDBOARD_SOUNDS_UPDATE',
			data: {sounds: sounds.map((sound) => serializeSoundboardSound(sound, this.cdnUrlFor(sound)))},
		});
	}

	private normalizeName(rawName: string): string {
		const trimmed = rawName.trim();
		if (trimmed.length === 0 || trimmed.length > SOUNDBOARD_NAME_MAX_LENGTH) {
			throw InputValidationError.fromCode('name', ValidationErrorCodes.SOUNDBOARD_SOUND_NAME_LENGTH_INVALID, {
				max: SOUNDBOARD_NAME_MAX_LENGTH,
			});
		}
		return trimmed;
	}

	private async resolveEmoji(guildId: GuildID, input: EmojiInput): Promise<ResolvedEmoji> {
		if (input.emojiId != null) {
			const emojiId = createEmojiID(BigInt(input.emojiId));
			const emoji = await this.guildRepository.getEmojiById(emojiId);
			if (!emoji || emoji.guildId !== guildId) {
				throw InputValidationError.fromCode('emoji_id', ValidationErrorCodes.CUSTOM_EMOJI_NOT_FOUND);
			}
			return {emojiId, emojiName: emoji.name, emojiAnimated: emoji.isAnimated};
		}
		const name = input.emojiName?.trim() ?? '';
		if (!isValidSingleUnicodeEmoji(name)) {
			throw InputValidationError.fromCode('emoji_name', ValidationErrorCodes.SOUNDBOARD_SOUND_INVALID_EMOJI);
		}
		return {emojiId: null, emojiName: name, emojiAnimated: false};
	}
}

export function serializeSoundboardSound(
	sound: GuildSoundboardSound,
	url: string,
	user: UserPartialResponse | null = null,
) {
	return {
		id: sound.soundId.toString(),
		name: sound.name,
		emoji_id: sound.emojiId?.toString() ?? null,
		emoji_name: sound.emojiName,
		emoji_animated: sound.emojiAnimated,
		volume: sound.volume,
		hash: sound.hash,
		extension: sound.extension,
		content_type: sound.contentType,
		duration_ms: sound.durationMs,
		size_bytes: sound.sizeBytes,
		creator_id: sound.creatorId.toString(),
		user,
		url,
		created_at: sound.createdAt.toISOString(),
	};
}
