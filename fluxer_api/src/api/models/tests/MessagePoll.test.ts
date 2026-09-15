// SPDX-License-Identifier: AGPL-3.0-or-later

import {createChannelID, createMessageID, createUserID} from '@app/api/BrandedTypes';
import {MessagePoll} from '@app/api/models/MessagePoll';
import {describe, expect, it} from 'vitest';

function makePoll(overrides: Partial<ConstructorParameters<typeof MessagePoll>[0]> = {}): MessagePoll {
	return new MessagePoll({
		message_id: createMessageID(1n),
		channel_id: createChannelID(2n),
		guild_id: null,
		author_id: createUserID(3n),
		question_text: 'Lunch?',
		answers: [
			{answer_id: 1, text: 'Pizza', emoji_id: null, emoji_name: '🍕', emoji_animated: false},
			{answer_id: 2, text: 'Sushi', emoji_id: null, emoji_name: null, emoji_animated: null},
		],
		allow_multiselect: false,
		layout_type: 1,
		expires_at: new Date('2026-09-16T12:00:00Z'),
		finalized_at: null,
		created_at: new Date('2026-09-15T12:00:00Z'),
		version: 1,
		...overrides,
	});
}

describe('MessagePoll', () => {
	it('is open before expiry and closed at or after it', () => {
		const poll = makePoll();
		expect(poll.isOpenAt(new Date('2026-09-16T11:59:59Z'))).toBe(true);
		expect(poll.isOpenAt(new Date('2026-09-16T12:00:00Z'))).toBe(false);
		expect(poll.isExpiredAt(new Date('2026-09-16T12:00:00Z'))).toBe(true);
	});

	it('is closed once finalized regardless of the clock', () => {
		const poll = makePoll().withFinalizedAt(new Date('2026-09-15T13:00:00Z'));
		expect(poll.isFinalized).toBe(true);
		expect(poll.isOpenAt(new Date('2026-09-15T14:00:00Z'))).toBe(false);
		expect(poll.version).toBe(2);
	});

	it('knows its answers by id', () => {
		const poll = makePoll();
		expect(poll.hasAnswer(2)).toBe(true);
		expect(poll.hasAnswer(3)).toBe(false);
	});

	it('serialises answers with emoji only when one is set', () => {
		const [pizza, sushi] = makePoll().toAnswerResponses();
		expect(pizza).toEqual({answer_id: 1, text: 'Pizza', emoji: {id: null, name: '🍕', animated: false}});
		expect(sushi).toEqual({answer_id: 2, text: 'Sushi', emoji: null});
	});

	it('round-trips through toRow', () => {
		const poll = makePoll();
		expect(new MessagePoll(poll.toRow()).toRow()).toEqual(poll.toRow());
	});

	it('builds a response around the supplied results', () => {
		const response = makePoll().toResponse({
			is_finalized: false,
			answer_counts: [
				{id: 1, count: 3, me_voted: true},
				{id: 2, count: 1, me_voted: false},
			],
			total_voters: 4,
		});
		expect(response.question.text).toBe('Lunch?');
		expect(response.expires_at).toBe('2026-09-16T12:00:00.000Z');
		expect(response.allow_multiselect).toBe(false);
		expect(response.results.total_voters).toBe(4);
	});
});
