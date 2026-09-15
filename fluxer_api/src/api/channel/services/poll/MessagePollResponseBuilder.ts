// SPDX-License-Identifier: AGPL-3.0-or-later

import {createMessageID, type UserID} from '@app/api/BrandedTypes';
import {MessagePollRepository} from '@app/api/channel/services/poll/MessagePollRepository';
import type {MessagePoll} from '@app/api/models/MessagePoll';
import {MessageFlags} from '@fluxer/constants/src/ChannelConstants';
import type {PollResponse, PollResultsResponse} from '@fluxer/schema/src/domains/message/PollSchemas';

const repository = new MessagePollRepository();

export async function buildPollResults(poll: MessagePoll, viewerUserId: UserID | null): Promise<PollResultsResponse> {
	const votes = await repository.listVotes(poll.messageId);
	const counts = new Map<number, number>();
	const mine = new Set<number>();
	const voters = new Set<string>();
	for (const vote of votes) {
		counts.set(vote.answer_id, (counts.get(vote.answer_id) ?? 0) + 1);
		voters.add(vote.user_id.toString());
		if (viewerUserId !== null && vote.user_id === viewerUserId) mine.add(vote.answer_id);
	}
	return {
		is_finalized: poll.isFinalized || poll.isExpiredAt(new Date()),
		answer_counts: poll.answers.map((answer) => ({
			id: answer.answer_id,
			count: counts.get(answer.answer_id) ?? 0,
			me_voted: mine.has(answer.answer_id),
		})),
		total_voters: voters.size,
	};
}

export async function buildPollResponse(poll: MessagePoll, viewerUserId: UserID | null): Promise<PollResponse> {
	return poll.toResponse(await buildPollResults(poll, viewerUserId));
}

/**
 * Attach `poll` to every message response carrying HAS_POLL. Message
 * responses are produced by the messages service, which knows nothing
 * about polls; this is the single enrichment point for lists, single
 * fetches and gateway broadcasts.
 */
export async function attachPollsToResponses<T extends {id: string; flags?: number | null; poll?: PollResponse | null}>(
	responses: Array<T>,
	viewerUserId: UserID | null,
): Promise<Array<T>> {
	const withPoll = responses.filter((response) => ((response.flags ?? 0) & MessageFlags.HAS_POLL) !== 0);
	if (withPoll.length === 0) return responses;
	const polls = await repository.getPolls(withPoll.map((response) => createMessageID(BigInt(response.id))));
	await Promise.all(
		withPoll.map(async (response) => {
			const poll = polls.get(response.id);
			response.poll = poll ? await buildPollResponse(poll, viewerUserId) : null;
		}),
	);
	return responses;
}
