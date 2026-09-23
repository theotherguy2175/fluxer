// SPDX-License-Identifier: AGPL-3.0-or-later

import {Permissions} from '@fluxer/constants/src/ChannelConstants';
import {
	SOUNDBOARD_DEFAULT_MAX_PLAYS_PER_SECOND,
	SOUNDBOARD_MAX_PLAYS_PER_SECOND_CEILING,
} from '@fluxer/constants/src/SoundboardConstants';
import {ValidationErrorCodes} from '@fluxer/constants/src/ValidationErrorCodes';
import {UnknownChannelError} from '@fluxer/errors/src/domains/channel/UnknownChannelError';
import {InputValidationError} from '@fluxer/errors/src/domains/core/InputValidationError';
import {RateLimitError} from '@fluxer/errors/src/domains/core/RateLimitError';
import type {IRateLimitService} from '@pkgs/rate_limit/src/IRateLimitService';
import {type ChannelID, createUserID, type SoundboardSoundID, type UserID} from '../../BrandedTypes';
import type {IChannelRepository} from '../../channel/IChannelRepository';
import type {IGatewayService} from '../../infrastructure/IGatewayService';
import {Logger} from '../../Logger';
import type {LimitConfigService} from '../../limits/LimitConfigService';
import {resolveLimitSafe} from '../../limits/LimitConfigUtils';
import {createLimitMatchContext} from '../../limits/LimitMatchContextBuilder';
import {requirePermission} from '../../utils/PermissionUtils';
import type {GuildSoundboardService} from './GuildSoundboardService';

interface PlaySoundboardSoundParams {
	userId: UserID;
	channelId: ChannelID;
	soundId: SoundboardSoundID;
}

export class GuildSoundboardPlayService {
	constructor(
		private readonly soundboardService: GuildSoundboardService,
		private readonly gatewayService: IGatewayService,
		private readonly channelRepository: IChannelRepository,
		private readonly limitConfigService: LimitConfigService,
		private readonly rateLimitService: IRateLimitService,
	) {}

	/**
	 * Per-member, per-channel burst limit, read from the instance limit
	 * max_soundboard_plays_per_second so an admin can tune it. Replaces the
	 * static route rate limit, which could not be configured.
	 */
	private async assertWithinPlayRate(userId: UserID, channelId: ChannelID): Promise<void> {
		const perSecond = resolveLimitSafe(
			this.limitConfigService.getConfigSnapshot(),
			createLimitMatchContext({user: null}),
			'max_soundboard_plays_per_second',
			SOUNDBOARD_DEFAULT_MAX_PLAYS_PER_SECOND,
			'guild',
		);
		const maxAttempts = Math.max(1, Math.min(perSecond, SOUNDBOARD_MAX_PLAYS_PER_SECOND_CEILING));
		const result = await this.rateLimitService.checkLimit({
			identifier: `soundboard:play:${userId}:${channelId}`,
			maxAttempts,
			windowMs: 1000,
		});
		if (!result.allowed) {
			throw new RateLimitError({
				retryAfter: Math.max(1, Math.ceil(result.retryAfter ?? 1)),
				retryAfterDecimal: result.retryAfterDecimal,
				limit: result.limit,
				resetTime: result.resetTime,
				resetAfterDecimal: result.resetAfterDecimal,
				scope: 'user',
			});
		}
	}

	async play(params: PlaySoundboardSoundParams): Promise<void> {
		const {userId, channelId, soundId} = params;
		this.soundboardService.assertEnabled();
		await this.assertWithinPlayRate(userId, channelId);
		const channel = await this.channelRepository.findUnique(channelId);
		if (!channel?.guildId) {
			throw new UnknownChannelError();
		}
		const guildId = channel.guildId;
		const {voiceStates} = await this.gatewayService.getVoiceStatesForChannel({
			guildId,
			channelId,
		});
		const senderIdString = userId.toString();
		const senderInChannel = voiceStates.some((state) => state.userId === senderIdString);
		if (!senderInChannel) {
			throw InputValidationError.fromCode('channel_id', ValidationErrorCodes.USER_NOT_IN_CHANNEL);
		}
		await requirePermission(this.gatewayService, {
			guildId,
			userId,
			channelId,
			permission: Permissions.USE_SOUNDBOARD,
		});
		const [library, limits] = await Promise.all([
			this.soundboardService.getSoundWithUrl(guildId, soundId),
			this.soundboardService.getEffectiveLimits(guildId),
		]);
		if (!library) {
			throw InputValidationError.fromCode('sound_id', ValidationErrorCodes.SOUNDBOARD_SOUND_NOT_FOUND);
		}
		const eventData = {
			user_id: userId.toString(),
			channel_id: channelId.toString(),
			guild_id: guildId.toString(),
			sound_id: soundId.toString(),
			hash: library.sound.hash,
			url: library.url,
			duration_ms: library.sound.durationMs,
			content_type: library.sound.contentType,
			volume: library.sound.volume,
			emoji_id: library.sound.emojiId?.toString() ?? null,
			emoji_name: library.sound.emojiName,
			emoji_animated: library.sound.emojiAnimated,
			restart_on_repeat: limits.restartOnRepeat,
		};
		const deliveredTo = new Set<string>();
		for (const state of voiceStates) {
			if (deliveredTo.has(state.userId)) continue;
			deliveredTo.add(state.userId);
			try {
				await this.gatewayService.dispatchPresence({
					userId: createUserID(BigInt(state.userId)),
					event: 'SOUNDBOARD_SOUND_PLAY',
					data: eventData,
				});
			} catch (error) {
				Logger.warn(
					{error, recipient: state.userId, channelId: channelId.toString()},
					'Failed to dispatch SOUNDBOARD_SOUND_PLAY',
				);
			}
		}
	}
}
