// SPDX-License-Identifier: AGPL-3.0-or-later

import type {GatewayHandlerContext} from '@app/features/gateway/events/EventRouter';
import {Logger} from '@app/features/platform/utils/AppLogger';
import Users from '@app/features/user/state/Users';
import MediaEngine from '@app/features/voice/engine/MediaEngineFacade';
import SoundboardPlaybackEngine from '@app/features/voice/engine/SoundboardPlaybackEngine';
import SoundboardActivity from '@app/features/voice/state/SoundboardActivity';
import {emitSoundboardPlay} from '@app/features/voice/utils/SoundboardPlayFeed';

const logger = new Logger('SoundboardSoundPlay');

interface SoundboardSoundPlayPayload {
	user_id: string;
	channel_id: string;
	guild_id: string | null;
	sound_id: string;
	hash: string;
	url: string;
	duration_ms: number;
	content_type: string;
	volume?: number;
	emoji_id?: string | null;
	emoji_name?: string | null;
	emoji_animated?: boolean;
	restart_on_repeat?: boolean;
}

export function handleSoundboardSoundPlay(data: SoundboardSoundPlayPayload, _context: GatewayHandlerContext): void {
	if (!MediaEngine.connected) return;
	if (MediaEngine.channelId !== data.channel_id) {
		logger.debug('Ignoring soundboard sound for a channel we are not in', {
			eventChannelId: data.channel_id,
			localChannelId: MediaEngine.channelId,
		});
		return;
	}
	void SoundboardPlaybackEngine.play({
		hash: data.hash,
		url: data.url,
		volume: data.volume,
		restartOnRepeat: data.restart_on_repeat ?? false,
	});
	SoundboardActivity.notifyPlayed(data.user_id, {
		emojiId: data.emoji_id ?? null,
		emojiName: data.emoji_name ?? null,
		emojiAnimated: data.emoji_animated ?? false,
	});
	// Our own plays already flashed the tile on click/hotkey; this is for everyone else's.
	if (data.user_id !== Users.currentUserId) {
		emitSoundboardPlay(data.sound_id, 'remote');
	}
}
