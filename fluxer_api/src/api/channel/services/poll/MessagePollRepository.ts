// SPDX-License-Identifier: AGPL-3.0-or-later

import type {GuildID, MessageID, UserID} from '@app/api/BrandedTypes';
import {deleteOneOrMany, fetchMany, fetchOne, upsertOne} from '@app/api/database/CassandraQueryExecution';
import type {
	GuildPollSettingsRow,
	MessagePollByExpiryRow,
	MessagePollRow,
	MessagePollVoteRow,
} from '@app/api/database/types/PollTypes';
import {MessagePoll} from '@app/api/models/MessagePoll';
import {GuildPollSettings, MessagePolls, MessagePollsByExpiry, MessagePollVotes} from '@app/api/Tables';

const FETCH_POLL_CQL = MessagePolls.selectCql({
	where: MessagePolls.where.eq('message_id'),
	limit: 1,
});
const LIST_VOTES_CQL = MessagePollVotes.selectCql({
	where: MessagePollVotes.where.eq('message_id'),
});
const LIST_ANSWER_VOTES_CQL = MessagePollVotes.selectCql({
	where: [MessagePollVotes.where.eq('message_id'), MessagePollVotes.where.eq('answer_id')],
});
const createListAnswerVotersQuery = (limit: number, hasAfter: boolean) =>
	MessagePollVotes.selectCql({
		where: hasAfter
			? [
					MessagePollVotes.where.eq('message_id'),
					MessagePollVotes.where.eq('answer_id'),
					MessagePollVotes.where.gt('user_id', 'after_user_id'),
				]
			: [MessagePollVotes.where.eq('message_id'), MessagePollVotes.where.eq('answer_id')],
		limit,
	});
const FETCH_SETTINGS_CQL = GuildPollSettings.selectCql({
	where: GuildPollSettings.where.eq('guild_id'),
	limit: 1,
});
const createFetchExpiredByBucketQuery = (limit: number) =>
	MessagePollsByExpiry.selectCql({
		where: [
			MessagePollsByExpiry.where.eq('expiry_bucket'),
			MessagePollsByExpiry.where.lte('expires_at', 'current_time'),
		],
		limit,
	});

export function getPollExpiryBucket(expiresAt: Date): number {
	return Number(
		`${expiresAt.getUTCFullYear()}${String(expiresAt.getUTCMonth() + 1).padStart(2, '0')}${String(expiresAt.getUTCDate()).padStart(2, '0')}`,
	);
}

export class MessagePollRepository {
	async getPoll(messageId: MessageID): Promise<MessagePoll | null> {
		const row = await fetchOne<MessagePollRow>(FETCH_POLL_CQL, {message_id: messageId});
		return row ? new MessagePoll(row) : null;
	}

	async getPolls(messageIds: ReadonlyArray<MessageID>): Promise<Map<string, MessagePoll>> {
		const polls = await Promise.all(messageIds.map((messageId) => this.getPoll(messageId)));
		const byId = new Map<string, MessagePoll>();
		for (const poll of polls) {
			if (poll) byId.set(poll.messageId.toString(), poll);
		}
		return byId;
	}

	async createPoll(poll: MessagePoll): Promise<MessagePoll> {
		await upsertOne(MessagePolls.upsertAll(poll.toRow()));
		await upsertOne(
			MessagePollsByExpiry.upsertAll({
				expiry_bucket: getPollExpiryBucket(poll.expiresAt),
				expires_at: poll.expiresAt,
				message_id: poll.messageId,
				channel_id: poll.channelId,
			}),
		);
		return poll;
	}

	async savePoll(poll: MessagePoll): Promise<MessagePoll> {
		await upsertOne(MessagePolls.upsertAll(poll.toRow()));
		return poll;
	}

	async deleteExpiryIndex(poll: MessagePoll): Promise<void> {
		await deleteOneOrMany(
			MessagePollsByExpiry.deleteByPk({
				expiry_bucket: getPollExpiryBucket(poll.expiresAt),
				expires_at: poll.expiresAt,
				message_id: poll.messageId,
			}),
		);
	}

	async deletePoll(poll: MessagePoll): Promise<void> {
		await deleteOneOrMany(MessagePollVotes.deletePartition({message_id: poll.messageId}));
		await this.deleteExpiryIndex(poll);
		await deleteOneOrMany(MessagePolls.deleteByPk({message_id: poll.messageId}));
	}

	async fetchExpiredByBucket(bucket: number, currentTime: Date, limit = 200): Promise<Array<MessagePollByExpiryRow>> {
		return fetchMany<MessagePollByExpiryRow>(createFetchExpiredByBucketQuery(limit), {
			expiry_bucket: bucket,
			current_time: currentTime,
		});
	}

	async listVotes(messageId: MessageID): Promise<Array<MessagePollVoteRow>> {
		return fetchMany<MessagePollVoteRow>(LIST_VOTES_CQL, {message_id: messageId});
	}

	async listVotesForAnswer(messageId: MessageID, answerId: number): Promise<Array<MessagePollVoteRow>> {
		return fetchMany<MessagePollVoteRow>(LIST_ANSWER_VOTES_CQL, {message_id: messageId, answer_id: answerId});
	}

	async listVotersForAnswer(params: {
		messageId: MessageID;
		answerId: number;
		limit: number;
		after?: UserID;
	}): Promise<Array<MessagePollVoteRow>> {
		return fetchMany<MessagePollVoteRow>(createListAnswerVotersQuery(params.limit, params.after !== undefined), {
			message_id: params.messageId,
			answer_id: params.answerId,
			...(params.after !== undefined ? {after_user_id: params.after} : {}),
		});
	}

	async addVote(messageId: MessageID, answerId: number, userId: UserID, votedAt: Date): Promise<void> {
		await upsertOne(
			MessagePollVotes.upsertAll({message_id: messageId, answer_id: answerId, user_id: userId, voted_at: votedAt}),
		);
	}

	async removeVote(messageId: MessageID, answerId: number, userId: UserID): Promise<void> {
		await deleteOneOrMany(MessagePollVotes.deleteByPk({message_id: messageId, answer_id: answerId, user_id: userId}));
	}

	async getSettings(guildId: GuildID): Promise<GuildPollSettingsRow | null> {
		return fetchOne<GuildPollSettingsRow>(FETCH_SETTINGS_CQL, {guild_id: guildId});
	}

	async upsertSettings(settings: GuildPollSettingsRow): Promise<GuildPollSettingsRow> {
		await upsertOne(GuildPollSettings.upsertAll(settings));
		return settings;
	}
}
