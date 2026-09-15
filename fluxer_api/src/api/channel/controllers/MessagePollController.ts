// SPDX-License-Identifier: AGPL-3.0-or-later

import {createChannelID, createMessageID, createUserID} from '@app/api/BrandedTypes';
import {LoginRequired} from '@app/api/middleware/AuthMiddleware';
import {RateLimitMiddleware} from '@app/api/middleware/RateLimitMiddleware';
import {OpenAPI} from '@app/api/middleware/ResponseTypeMiddleware';
import {RateLimitConfigs} from '@app/api/RateLimitConfig';
import type {HonoApp} from '@app/api/types/HonoEnv';
import {Validator} from '@app/api/Validator';
import {
	ChannelIdMessageIdAnswerIdParam,
	ChannelIdMessageIdParam,
	SessionIdQuerySchema,
} from '@fluxer/schema/src/domains/common/CommonParamSchemas';
import {
	PollAnswerVotersQuery,
	PollAnswerVotersResponse,
	PollResponse,
} from '@fluxer/schema/src/domains/message/PollSchemas';

export function MessagePollController(app: HonoApp) {
	app.put(
		'/channels/:channel_id/polls/:message_id/answers/:answer_id/@me',
		RateLimitMiddleware(RateLimitConfigs.CHANNEL_POLL_VOTE),
		LoginRequired,
		Validator('param', ChannelIdMessageIdAnswerIdParam),
		Validator('query', SessionIdQuerySchema),
		OpenAPI({
			operationId: 'add_poll_vote',
			summary: 'Vote for a poll answer',
			description:
				'Casts the current user’s vote for an answer. On single-choice polls this replaces any previous vote. Fails once the poll has ended. Returns 204 No Content.',
			responseSchema: null,
			statusCode: 204,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: 'Channels',
		}),
		async (ctx) => {
			const {channel_id, message_id, answer_id} = ctx.req.valid('param');
			await ctx.get('channelService').polls.vote({
				userId: ctx.get('user').id,
				channelId: createChannelID(channel_id),
				messageId: createMessageID(message_id),
				answerId: answer_id,
				sessionId: ctx.req.valid('query').session_id,
				requestCache: ctx.get('requestCache'),
			});
			return ctx.body(null, 204);
		},
	);
	app.delete(
		'/channels/:channel_id/polls/:message_id/answers/:answer_id/@me',
		RateLimitMiddleware(RateLimitConfigs.CHANNEL_POLL_VOTE),
		LoginRequired,
		Validator('param', ChannelIdMessageIdAnswerIdParam),
		Validator('query', SessionIdQuerySchema),
		OpenAPI({
			operationId: 'remove_poll_vote',
			summary: 'Withdraw a poll vote',
			description: 'Removes the current user’s vote for an answer while the poll is open. Returns 204 No Content.',
			responseSchema: null,
			statusCode: 204,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: 'Channels',
		}),
		async (ctx) => {
			const {channel_id, message_id, answer_id} = ctx.req.valid('param');
			await ctx.get('channelService').polls.unvote({
				userId: ctx.get('user').id,
				channelId: createChannelID(channel_id),
				messageId: createMessageID(message_id),
				answerId: answer_id,
				sessionId: ctx.req.valid('query').session_id,
				requestCache: ctx.get('requestCache'),
			});
			return ctx.body(null, 204);
		},
	);
	app.get(
		'/channels/:channel_id/polls/:message_id/answers/:answer_id',
		RateLimitMiddleware(RateLimitConfigs.CHANNEL_POLL_VOTERS),
		LoginRequired,
		Validator('param', ChannelIdMessageIdAnswerIdParam),
		Validator('query', PollAnswerVotersQuery),
		OpenAPI({
			operationId: 'get_poll_answer_voters',
			summary: 'List voters for a poll answer',
			description: 'Returns the users who voted for an answer, oldest snowflake first, paged with `after`.',
			responseSchema: PollAnswerVotersResponse,
			statusCode: 200,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: 'Channels',
		}),
		async (ctx) => {
			const {channel_id, message_id, answer_id} = ctx.req.valid('param');
			const {after, limit} = ctx.req.valid('query');
			const response = await ctx.get('channelService').polls.listVoters({
				userId: ctx.get('user').id,
				channelId: createChannelID(channel_id),
				messageId: createMessageID(message_id),
				answerId: answer_id,
				limit,
				after: after !== undefined ? createUserID(after) : undefined,
				requestCache: ctx.get('requestCache'),
			});
			return ctx.json(response, 200);
		},
	);
	app.post(
		'/channels/:channel_id/polls/:message_id/expire',
		RateLimitMiddleware(RateLimitConfigs.CHANNEL_POLL_EXPIRE),
		LoginRequired,
		Validator('param', ChannelIdMessageIdParam),
		OpenAPI({
			operationId: 'expire_poll',
			summary: 'End a poll early',
			description:
				'Ends the poll immediately, locking votes and posting the result message. Allowed for the poll author, or anyone with Manage Messages in the channel. Returns the finalized poll.',
			responseSchema: PollResponse,
			statusCode: 200,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: 'Channels',
		}),
		async (ctx) => {
			const {channel_id, message_id} = ctx.req.valid('param');
			const poll = await ctx.get('channelService').polls.expire({
				userId: ctx.get('user').id,
				channelId: createChannelID(channel_id),
				messageId: createMessageID(message_id),
				requestCache: ctx.get('requestCache'),
				auditLogReason: ctx.get('auditLogReason') ?? null,
			});
			return ctx.json(poll, 200);
		},
	);
}
