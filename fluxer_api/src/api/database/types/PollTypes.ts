// SPDX-License-Identifier: AGPL-3.0-or-later

import type {ChannelID, EmojiID, GuildID, MessageID, UserID} from '@app/api/BrandedTypes';

type Nullish<T> = T | null;

// One answer as stored inside the poll row. answer_id is 1-based position,
// stable for the life of the poll (polls are immutable after send).
export interface MessagePollAnswerItem {
	answer_id: number;
	text: string;
	emoji_id: Nullish<EmojiID>;
	emoji_name: Nullish<string>;
	emoji_animated: Nullish<boolean>;
}

export interface MessagePollRow {
	message_id: MessageID;
	channel_id: ChannelID;
	guild_id: Nullish<GuildID>;
	author_id: UserID;
	question_text: string;
	answers: Array<MessagePollAnswerItem>;
	allow_multiselect: boolean;
	allow_vote_change: Nullish<boolean>;
	layout_type: number;
	expires_at: Date;
	finalized_at: Nullish<Date>;
	created_at: Date;
	version: number;
}

export const MESSAGE_POLL_COLUMNS = [
	'message_id',
	'channel_id',
	'guild_id',
	'author_id',
	'question_text',
	'answers',
	'allow_multiselect',
	'allow_vote_change',
	'layout_type',
	'expires_at',
	'finalized_at',
	'created_at',
	'version',
] as const satisfies ReadonlyArray<keyof MessagePollRow>;

export interface MessagePollVoteRow {
	message_id: MessageID;
	answer_id: number;
	user_id: UserID;
	voted_at: Date;
}

export const MESSAGE_POLL_VOTE_COLUMNS = [
	'message_id',
	'answer_id',
	'user_id',
	'voted_at',
] as const satisfies ReadonlyArray<keyof MessagePollVoteRow>;

// Index for the worker: which polls expire on a given UTC day. Removed on
// finalize. Mirrors attachment_decay_by_expiry.
export interface MessagePollByExpiryRow {
	expiry_bucket: number;
	expires_at: Date;
	message_id: MessageID;
	channel_id: ChannelID;
}

export const MESSAGE_POLL_BY_EXPIRY_COLUMNS = [
	'expiry_bucket',
	'expires_at',
	'message_id',
	'channel_id',
] as const satisfies ReadonlyArray<keyof MessagePollByExpiryRow>;

export interface GuildPollSettingsRow {
	guild_id: GuildID;
	enabled: Nullish<boolean>;
	max_answers: Nullish<number>;
	max_question_length: Nullish<number>;
	max_answer_length: Nullish<number>;
	max_duration_hours: Nullish<number>;
	default_duration_hours: Nullish<number>;
	allow_multiselect: Nullish<boolean>;
	version: number;
}

export const GUILD_POLL_SETTINGS_COLUMNS = [
	'guild_id',
	'enabled',
	'max_answers',
	'max_question_length',
	'max_answer_length',
	'max_duration_hours',
	'default_duration_hours',
	'allow_multiselect',
	'version',
] as const satisfies ReadonlyArray<keyof GuildPollSettingsRow>;
