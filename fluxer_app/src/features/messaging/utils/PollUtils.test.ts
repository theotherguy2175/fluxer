// SPDX-License-Identifier: AGPL-3.0-or-later

import {applyPollVote, mergePollUpdate} from '@app/features/messaging/utils/PollUtils';
import type {PollResponse} from '@fluxer/schema/src/domains/message/PollSchemas';
import {describe, expect, it} from 'vitest';

function makePoll(overrides: Partial<PollResponse> = {}): PollResponse {
	return {
		question: {text: 'Snack?'},
		answers: [
			{answer_id: 1, text: 'Chips', emoji: null},
			{answer_id: 2, text: 'Fruit', emoji: null},
		],
		expires_at: '2026-09-16T12:00:00.000Z',
		allow_multiselect: false,
		layout_type: 1,
		results: {
			is_finalized: false,
			answer_counts: [
				{id: 1, count: 2, me_voted: true},
				{id: 2, count: 5, me_voted: false},
			],
			total_voters: 7,
		},
		...overrides,
	};
}

describe('applyPollVote', () => {
	it('counts a vote and marks it as mine when the voter is the current user', () => {
		expect(applyPollVote(makePoll(), 2, true, true).results.answer_counts).toEqual([
			{id: 1, count: 2, me_voted: true},
			{id: 2, count: 6, me_voted: true},
		]);
	});

	it("counts someone else's vote without touching me_voted", () => {
		expect(applyPollVote(makePoll(), 2, true, false).results.answer_counts[1]).toEqual({
			id: 2,
			count: 6,
			me_voted: false,
		});
	});

	it('returns the same poll when the viewer already holds that vote', () => {
		const poll = makePoll();
		expect(applyPollVote(poll, 1, true, true)).toBe(poll);
	});

	it('never lets a count go negative', () => {
		let poll = makePoll();
		for (let i = 0; i < 3; i++) poll = applyPollVote(poll, 1, false, false);
		expect(poll.results.answer_counts[0]).toEqual({id: 1, count: 0, me_voted: true});
	});

	it('adds a row for an answer the server has not reported yet', () => {
		expect(applyPollVote(makePoll(), 3, true, true).results.answer_counts[2]).toEqual({
			id: 3,
			count: 1,
			me_voted: true,
		});
	});
});

describe('mergePollUpdate', () => {
	it('keeps my own votes when a broadcast update carries none', () => {
		const incoming = makePoll({
			results: {
				is_finalized: true,
				answer_counts: [
					{id: 1, count: 3, me_voted: false},
					{id: 2, count: 5, me_voted: false},
				],
				total_voters: 8,
			},
		});
		const merged = mergePollUpdate(makePoll(), incoming);
		expect(merged?.results.is_finalized).toBe(true);
		expect(merged?.results.answer_counts).toEqual([
			{id: 1, count: 3, me_voted: true},
			{id: 2, count: 5, me_voted: false},
		]);
	});

	it('takes the incoming poll as-is when nothing was held locally', () => {
		const incoming = makePoll();
		expect(mergePollUpdate(null, incoming)).toBe(incoming);
	});

	it('drops the poll when the update clears it', () => {
		expect(mergePollUpdate(makePoll(), null)).toBeNull();
	});
});
