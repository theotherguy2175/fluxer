// SPDX-License-Identifier: AGPL-3.0-or-later

import {ChannelIdParam} from '@fluxer/schema/src/domains/common/CommonParamSchemas';
import {SoundboardSoundPlayRequest} from '@fluxer/schema/src/domains/guild/GuildSoundboardSchemas';
import {createChannelID, createSoundboardSoundID} from '../../BrandedTypes';
import {LoginRequired} from '../../middleware/AuthMiddleware';
import {OpenAPI} from '../../middleware/ResponseTypeMiddleware';
import type {HonoApp} from '../../types/HonoEnv';
import {Validator} from '../../Validator';

export function GuildSoundboardPlayController(app: HonoApp) {
	app.post(
		'/voice/channels/:channel_id/soundboard-sound',
		LoginRequired,
		Validator('param', ChannelIdParam),
		Validator('json', SoundboardSoundPlayRequest),
		OpenAPI({
			operationId: 'play_soundboard_sound',
			summary: 'Play a soundboard sound in a voice channel',
			description:
				'Requests that the API fan out a SOUNDBOARD_SOUND_PLAY gateway event to every user currently connected to the voice channel, including the sender. The other clients then fetch the audio from CDN and play it locally; no LiveKit track is published.',
			requestSchema: SoundboardSoundPlayRequest,
			responseSchema: null,
			statusCode: 204,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: ['Voice'],
		}),
		async (ctx) => {
			const userId = ctx.get('user').id;
			const channelId = createChannelID(ctx.req.valid('param').channel_id);
			const soundId = createSoundboardSoundID(ctx.req.valid('json').sound_id);
			await ctx.get('guildSoundboardPlayService').play({userId, channelId, soundId});
			return ctx.body(null, 204);
		},
	);
}
