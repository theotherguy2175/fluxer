// SPDX-License-Identifier: AGPL-3.0-or-later

import {createGuildID} from '@app/api/BrandedTypes';
import {LoginRequired} from '@app/api/middleware/AuthMiddleware';
import {RateLimitMiddleware} from '@app/api/middleware/RateLimitMiddleware';
import {OpenAPI} from '@app/api/middleware/ResponseTypeMiddleware';
import {RateLimitConfigs} from '@app/api/RateLimitConfig';
import type {HonoApp} from '@app/api/types/HonoEnv';
import {Validator} from '@app/api/Validator';
import {GuildIdParam} from '@fluxer/schema/src/domains/common/CommonParamSchemas';
import {
	GuildPollSettingsResponse,
	GuildPollSettingsUpdateRequest,
} from '@fluxer/schema/src/domains/message/PollSchemas';

export function GuildPollSettingsController(app: HonoApp) {
	app.get(
		'/guilds/:guild_id/poll-settings',
		RateLimitMiddleware(RateLimitConfigs.GUILD_POLL_SETTINGS_GET),
		LoginRequired,
		Validator('param', GuildIdParam),
		OpenAPI({
			operationId: 'get_guild_poll_settings',
			summary: 'Get guild poll settings',
			description:
				'Returns the effective poll limits for the guild (community settings capped by the instance limits) plus the instance ceilings. Any member can read this; the composer uses it to size the poll form.',
			responseSchema: GuildPollSettingsResponse,
			statusCode: 200,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: ['Guilds'],
		}),
		async (ctx) => {
			const guildId = createGuildID(ctx.req.valid('param').guild_id);
			return ctx.json(await ctx.get('channelService').polls.getSettings(guildId), 200);
		},
	);
	app.patch(
		'/guilds/:guild_id/poll-settings',
		RateLimitMiddleware(RateLimitConfigs.GUILD_POLL_SETTINGS_UPDATE),
		LoginRequired,
		Validator('param', GuildIdParam),
		Validator('json', GuildPollSettingsUpdateRequest),
		OpenAPI({
			operationId: 'update_guild_poll_settings',
			summary: 'Update guild poll settings',
			description:
				'Sets whether polls are allowed and the maximum answers, text lengths and duration for the guild. Values may not exceed the instance limits. Requires the Manage Guild permission.',
			requestSchema: GuildPollSettingsUpdateRequest,
			responseSchema: GuildPollSettingsResponse,
			statusCode: 200,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: ['Guilds'],
		}),
		async (ctx) => {
			const guildId = createGuildID(ctx.req.valid('param').guild_id);
			const response = await ctx.get('channelService').polls.updateSettings({
				guildId,
				userId: ctx.get('user').id,
				data: ctx.req.valid('json'),
			});
			return ctx.json(response, 200);
		},
	);
}
