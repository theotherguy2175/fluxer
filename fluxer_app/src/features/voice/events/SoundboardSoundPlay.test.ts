// SPDX-License-Identifier: AGPL-3.0-or-later

import type {GatewayHandlerContext} from '@app/features/gateway/events/EventRouter';
import MediaEngine from '@app/features/voice/engine/MediaEngineFacade';
import SoundboardPlaybackEngine from '@app/features/voice/engine/SoundboardPlaybackEngine';
import SoundboardActivity from '@app/features/voice/state/SoundboardActivity';
import {subscribeToSoundboardPlays} from '@app/features/voice/utils/SoundboardPlayFeed';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {handleSoundboardSoundPlay} from './SoundboardSoundPlay';

vi.mock('@app/features/voice/engine/SoundboardPlaybackEngine', () => ({
	default: {play: vi.fn(() => Promise.resolve())},
}));

vi.mock('@app/features/voice/engine/MediaEngineFacade', () => ({
	default: {connected: true, channelId: 'channel-1'},
}));

vi.mock('@app/features/voice/state/SoundboardActivity', () => ({
	default: {notifyPlayed: vi.fn()},
}));

vi.mock('@app/features/user/state/Users', () => ({
	default: {currentUserId: 'me'},
}));

const payload = {
	user_id: 'user-1',
	channel_id: 'channel-1',
	guild_id: 'guild-1',
	sound_id: 'sound-1',
	hash: 'hash-1',
	url: 'https://example.invalid/soundboard.mp3',
	duration_ms: 900,
	content_type: 'audio/mpeg',
	volume: 0.5,
	emoji_id: null,
	emoji_name: '🔔',
	emoji_animated: false,
};

const context = {} as GatewayHandlerContext;

describe('handleSoundboardSoundPlay', () => {
	beforeEach(() => {
		vi.mocked(SoundboardPlaybackEngine.play).mockClear();
		vi.mocked(SoundboardActivity.notifyPlayed).mockClear();
		vi.mocked(MediaEngine).connected = true;
		vi.mocked(MediaEngine).channelId = 'channel-1';
	});

	it('plays the sound and records the activity for the matching channel', () => {
		handleSoundboardSoundPlay(payload, context);
		expect(SoundboardPlaybackEngine.play).toHaveBeenCalledWith({
			hash: 'hash-1',
			url: 'https://example.invalid/soundboard.mp3',
			volume: 0.5,
			restartOnRepeat: false,
		});
		expect(SoundboardActivity.notifyPlayed).toHaveBeenCalledWith('user-1', {
			emojiId: null,
			emojiName: '🔔',
			emojiAnimated: false,
		});
	});

	it("announces other members' plays on the play feed, but not our own", () => {
		const listener = vi.fn();
		const unsubscribe = subscribeToSoundboardPlays(listener);
		try {
			handleSoundboardSoundPlay(payload, context);
			expect(listener).toHaveBeenCalledWith('sound-1', 'remote');
			listener.mockClear();
			handleSoundboardSoundPlay({...payload, user_id: 'me'}, context);
			expect(listener).not.toHaveBeenCalled();
		} finally {
			unsubscribe();
		}
	});

	it('forwards restart_on_repeat to the playback engine', () => {
		handleSoundboardSoundPlay({...payload, restart_on_repeat: true}, context);
		expect(SoundboardPlaybackEngine.play).toHaveBeenCalledWith(expect.objectContaining({restartOnRepeat: true}));
	});

	it('ignores the event when not connected to voice', () => {
		vi.mocked(MediaEngine).connected = false;
		handleSoundboardSoundPlay(payload, context);
		expect(SoundboardPlaybackEngine.play).not.toHaveBeenCalled();
		expect(SoundboardActivity.notifyPlayed).not.toHaveBeenCalled();
	});

	it('ignores the event for a different channel', () => {
		vi.mocked(MediaEngine).channelId = 'channel-2';
		handleSoundboardSoundPlay(payload, context);
		expect(SoundboardPlaybackEngine.play).not.toHaveBeenCalled();
		expect(SoundboardActivity.notifyPlayed).not.toHaveBeenCalled();
	});
});
