// SPDX-License-Identifier: AGPL-3.0-or-later

import {Permissions} from '@fluxer/constants/src/ChannelConstants';
import {ValidationErrorCodes} from '@fluxer/constants/src/ValidationErrorCodes';
import {UnknownChannelError} from '@fluxer/errors/src/domains/channel/UnknownChannelError';
import {InputValidationError} from '@fluxer/errors/src/domains/core/InputValidationError';
import {type ChannelID, createUserID, type SoundboardSoundID, type UserID} from '../../BrandedTypes';
import type {IChannelRepository} from '../../channel/IChannelRepository';
import type {IGatewayService} from '../../infrastructure/IGatewayService';
import {Logger} from '../../Logger';
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
	) {}

	async play(params: PlaySoundboardSoundParams): Promise<void> {
		const {userId, channelId, soundId} = params;
		this.soundboardService.assertEnabled();
		const channel = await this.channelRepository.findUnique(channelId);
		if (!channel || !channel.guildId) {
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
