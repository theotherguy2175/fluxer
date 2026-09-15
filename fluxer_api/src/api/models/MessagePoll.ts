// SPDX-License-Identifier: AGPL-3.0-or-later

import type {ChannelID, GuildID, MessageID, UserID} from '@app/api/BrandedTypes';
import type {MessagePollAnswerItem, MessagePollRow} from '@app/api/database/types/PollTypes';
import type {
	PollAnswerResponse,
	PollResponse,
	PollResultsResponse,
} from '@fluxer/schema/src/domains/message/PollSchemas';

export class MessagePoll {
	readonly messageId: MessageID;
	readonly channelId: ChannelID;
	readonly guildId: GuildID | null;
	readonly authorId: UserID;
	readonly questionText: string;
	readonly answers: ReadonlyArray<MessagePollAnswerItem>;
	readonly allowMultiselect: boolean;
	readonly layoutType: number;
	readonly expiresAt: Date;
	readonly finalizedAt: Date | null;
	readonly createdAt: Date;
	readonly version: number;

	constructor(row: MessagePollRow) {
		this.messageId = row.message_id;
		this.channelId = row.channel_id;
		this.guildId = row.guild_id ?? null;
		this.authorId = row.author_id;
		this.questionText = row.question_text;
		this.answers = row.answers ?? [];
		this.allowMultiselect = row.allow_multiselect ?? false;
		this.layoutType = row.layout_type;
		this.expiresAt = row.expires_at;
		this.finalizedAt = row.finalized_at ?? null;
		this.createdAt = row.created_at;
		this.version = row.version;
	}

	get isFinalized(): boolean {
		return this.finalizedAt !== null;
	}

	isExpiredAt(now: Date): boolean {
		return this.expiresAt.getTime() <= now.getTime();
	}

	isOpenAt(now: Date): boolean {
		return !this.isFinalized && !this.isExpiredAt(now);
	}

	hasAnswer(answerId: number): boolean {
		return this.answers.some((answer) => answer.answer_id === answerId);
	}

	withFinalizedAt(finalizedAt: Date): MessagePoll {
		return new MessagePoll({...this.toRow(), finalized_at: finalizedAt, version: this.version + 1});
	}

	toRow(): MessagePollRow {
		return {
			message_id: this.messageId,
			channel_id: this.channelId,
			guild_id: this.guildId,
			author_id: this.authorId,
			question_text: this.questionText,
			answers: [...this.answers],
			allow_multiselect: this.allowMultiselect,
			layout_type: this.layoutType,
			expires_at: this.expiresAt,
			finalized_at: this.finalizedAt,
			created_at: this.createdAt,
			version: this.version,
		};
	}

	toAnswerResponses(): Array<PollAnswerResponse> {
		return this.answers.map((answer) => ({
			answer_id: answer.answer_id,
			text: answer.text,
			emoji:
				answer.emoji_id || answer.emoji_name
					? {
							id: answer.emoji_id ? answer.emoji_id.toString() : null,
							name: answer.emoji_name ?? null,
							animated: answer.emoji_animated ?? false,
						}
					: null,
		}));
	}

	toResponse(results: PollResultsResponse): PollResponse {
		return {
			question: {text: this.questionText},
			answers: this.toAnswerResponses(),
			expires_at: this.expiresAt.toISOString(),
			allow_multiselect: this.allowMultiselect,
			layout_type: 1,
			results,
		};
	}
}
