// SPDX-License-Identifier: AGPL-3.0-or-later

import {Endpoints} from '@app/features/app/constants/Endpoints';
import RuntimeConfig from '@app/features/app/state/RuntimeConfig';
import GatewayConnection from '@app/features/gateway/transport/GatewayConnection';
import Guilds from '@app/features/guild/state/Guilds';
import Messages from '@app/features/messaging/state/MessagingMessages';
import {http} from '@app/features/platform/transport/RestTransport';
import {Logger} from '@app/features/platform/utils/AppLogger';
import Users from '@app/features/user/state/Users';
import {
	POLL_DEFAULT_DURATION_HOURS,
	POLL_DEFAULT_MAX_ANSWER_LENGTH,
	POLL_DEFAULT_MAX_ANSWERS,
	POLL_DEFAULT_MAX_DURATION_HOURS,
	POLL_DEFAULT_MAX_QUESTION_LENGTH,
} from '@fluxer/constants/src/PollConstants';
import {resolveLimit} from '@fluxer/limits/src/LimitResolver';
import type {
	GuildPollSettingsResponse,
	GuildPollSettingsUpdateRequest,
	PollAnswerVotersResponse,
	PollResponse,
} from '@fluxer/schema/src/domains/message/PollSchemas';
import type {UserPartialResponse} from '@fluxer/schema/src/domains/user/UserResponseSchemas';

const logger = new Logger('PollCommands');

function sessionQuery(): {session_id: string | null} {
	return {session_id: GatewayConnection.sessionId ?? null};
}

/** Instance-level toggle, resolved from the limit snapshot the client already holds. */
export function isPollFeatureEnabled(guildId?: string | null): boolean {
	const guild = guildId ? Guilds.getGuild(guildId) : null;
	const resolved = resolveLimit(
		RuntimeConfig.limits,
		{traits: new Set(), guildFeatures: new Set(guild?.features ?? [])},
		'feature_message_polls',
		{evaluationContext: 'guild'},
	);
	return !Number.isFinite(resolved) || resolved !== 0;
}

/** Instance limits as the client sees them; the server re-checks against community settings. */
export function instancePollLimits(guildId?: string | null): GuildPollSettingsResponse {
	const guild = guildId ? Guilds.getGuild(guildId) : null;
	const ctx = {traits: new Set<string>(), guildFeatures: new Set(guild?.features ?? [])};
	const read = (key: Parameters<typeof resolveLimit>[2], fallback: number): number => {
		const value = resolveLimit(RuntimeConfig.limits, ctx, key, {evaluationContext: 'guild'});
		return Number.isFinite(value) ? value : fallback;
	};
	const maxAnswers = read('max_poll_answers', POLL_DEFAULT_MAX_ANSWERS);
	const maxQuestionLength = read('max_poll_question_length', POLL_DEFAULT_MAX_QUESTION_LENGTH);
	const maxAnswerLength = read('max_poll_answer_length', POLL_DEFAULT_MAX_ANSWER_LENGTH);
	const maxDurationHours = read('max_poll_duration_hours', POLL_DEFAULT_MAX_DURATION_HOURS);
	const enabled = isPollFeatureEnabled(guildId);
	return {
		enabled,
		instance_enabled: enabled,
		max_answers: maxAnswers,
		max_question_length: maxQuestionLength,
		max_answer_length: maxAnswerLength,
		max_duration_hours: maxDurationHours,
		default_duration_hours: Math.min(POLL_DEFAULT_DURATION_HOURS, maxDurationHours),
		allow_multiselect: true,
		max_answers_ceiling: maxAnswers,
		max_question_length_ceiling: maxQuestionLength,
		max_answer_length_ceiling: maxAnswerLength,
		max_duration_hours_ceiling: maxDurationHours,
	};
}

export async function getSettings(guildId: string): Promise<GuildPollSettingsResponse> {
	const response = await http.get<GuildPollSettingsResponse>(Endpoints.GUILD_POLL_SETTINGS(guildId));
	return response.body;
}

export async function updateSettings(
	guildId: string,
	data: GuildPollSettingsUpdateRequest,
): Promise<GuildPollSettingsResponse> {
	const response = await http.patch<GuildPollSettingsResponse>(Endpoints.GUILD_POLL_SETTINGS(guildId), {body: data});
	return response.body;
}

/** Effective limits for composing a poll in a channel: guild settings when there is a guild, else instance limits. */
export async function getEffectiveLimits(guildId?: string | null): Promise<GuildPollSettingsResponse> {
	if (!guildId) return instancePollLimits(null);
	try {
		return await getSettings(guildId);
	} catch (error) {
		logger.warn(`Falling back to instance poll limits for guild ${guildId}:`, error);
		return instancePollLimits(guildId);
	}
}

export async function vote(
	channelId: string,
	messageId: string,
	answerId: number,
	multiselect: boolean,
): Promise<void> {
	const currentUserId = Users.getCurrentUser()?.id;
	// Optimistic: single-choice polls drop the previous vote locally too; the
	// gateway confirms with VOTE_REMOVE/VOTE_ADD, which are idempotent on top.
	if (currentUserId) {
		if (!multiselect) {
			const message = Messages.getMessage(channelId, messageId);
			for (const entry of message?.poll?.results.answer_counts ?? []) {
				if (entry.me_voted && entry.id !== answerId) {
					Messages.handlePollVote({
						type: 'MESSAGE_POLL_VOTE_REMOVE',
						channelId,
						messageId,
						userId: currentUserId,
						answerId: entry.id,
					});
				}
			}
		}
		Messages.handlePollVote({type: 'MESSAGE_POLL_VOTE_ADD', channelId, messageId, userId: currentUserId, answerId});
	}
	try {
		await http.put(Endpoints.CHANNEL_POLL_ANSWER_VOTE(channelId, messageId, answerId), {query: sessionQuery()});
	} catch (error) {
		if (currentUserId) {
			Messages.handlePollVote({
				type: 'MESSAGE_POLL_VOTE_REMOVE',
				channelId,
				messageId,
				userId: currentUserId,
				answerId,
			});
		}
		throw error;
	}
}

export async function unvote(channelId: string, messageId: string, answerId: number): Promise<void> {
	const currentUserId = Users.getCurrentUser()?.id;
	if (currentUserId) {
		Messages.handlePollVote({type: 'MESSAGE_POLL_VOTE_REMOVE', channelId, messageId, userId: currentUserId, answerId});
	}
	try {
		await http.delete(Endpoints.CHANNEL_POLL_ANSWER_VOTE(channelId, messageId, answerId), {query: sessionQuery()});
	} catch (error) {
		if (currentUserId) {
			Messages.handlePollVote({type: 'MESSAGE_POLL_VOTE_ADD', channelId, messageId, userId: currentUserId, answerId});
		}
		throw error;
	}
}

export async function fetchVoters(
	channelId: string,
	messageId: string,
	answerId: number,
	options: {after?: string; limit?: number} = {},
): Promise<Array<UserPartialResponse>> {
	const query: Record<string, string | number> = {};
	if (options.after) query['after'] = options.after;
	if (options.limit) query['limit'] = options.limit;
	const response = await http.get<PollAnswerVotersResponse>(
		Endpoints.CHANNEL_POLL_ANSWER_VOTERS(channelId, messageId, answerId),
		{query},
	);
	return response.body.users;
}

export async function expire(channelId: string, messageId: string): Promise<PollResponse> {
	const response = await http.post<PollResponse>(Endpoints.CHANNEL_POLL_EXPIRE(channelId, messageId));
	Messages.handlePollUpdate({channelId, messageId, poll: response.body});
	return response.body;
}
