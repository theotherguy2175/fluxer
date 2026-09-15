// SPDX-License-Identifier: AGPL-3.0-or-later

import type {PollResponse} from '@fluxer/schema/src/domains/message/PollSchemas';

/**
 * Apply one vote event to a poll. `me` marks whether the voter is the
 * current user, which is the only case where me_voted changes. Returns the
 * same object when nothing would change so callers can skip re-rendering.
 */
export function applyPollVote(poll: PollResponse, answerId: number, add: boolean, me: boolean): PollResponse {
	const counts = poll.results.answer_counts;
	const existing = counts.find((entry) => entry.id === answerId);
	if (existing && me && existing.me_voted === add) return poll;
	const answerCounts = existing
		? counts.map((entry) =>
				entry.id === answerId
					? {...entry, count: Math.max(0, entry.count + (add ? 1 : -1)), me_voted: me ? add : entry.me_voted}
					: entry,
			)
		: [...counts, {id: answerId, count: add ? 1 : 0, me_voted: me && add}];
	return {...poll, results: {...poll.results, answer_counts: answerCounts}};
}

/**
 * Gateway broadcasts carry no per-viewer poll state (me_voted is false for
 * everyone), so an incoming poll keeps the viewer's own votes from the copy
 * already held. Counts and totals always come from the server.
 */
export function mergePollUpdate(current: PollResponse | null, incoming: PollResponse | null): PollResponse | null {
	if (!incoming || !current) return incoming;
	const mine = new Set(current.results.answer_counts.filter((entry) => entry.me_voted).map((entry) => entry.id));
	if (mine.size === 0) return incoming;
	return {
		...incoming,
		results: {
			...incoming.results,
			answer_counts: incoming.results.answer_counts.map((entry) =>
				entry.me_voted || !mine.has(entry.id) ? entry : {...entry, me_voted: true},
			),
		},
	};
}
