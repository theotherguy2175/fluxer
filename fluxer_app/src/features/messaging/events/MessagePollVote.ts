// SPDX-License-Identifier: AGPL-3.0-or-later

import type {GatewayHandlerContext} from '@app/features/gateway/events/EventRouter';
import GuildMembers from '@app/features/member/state/GuildMembers';
import Messages from '@app/features/messaging/state/MessagingMessages';
import type {GuildMemberData} from '@fluxer/schema/src/domains/guild/GuildMemberSchemas';

interface MessagePollVotePayload {
	user_id: string;
	channel_id: string;
	message_id: string;
	answer_id: number;
	guild_id?: string;
	member?: GuildMemberData;
}

export function handleMessagePollVoteAdd(data: MessagePollVotePayload, _context: GatewayHandlerContext): void {
	if (data.guild_id && data.member) {
		GuildMembers.hydrateIfMissing(data.guild_id, data.member);
	}
	Messages.handlePollVote({
		type: 'MESSAGE_POLL_VOTE_ADD',
		channelId: data.channel_id,
		messageId: data.message_id,
		userId: data.user_id,
		answerId: data.answer_id,
	});
}

export function handleMessagePollVoteRemove(data: MessagePollVotePayload, _context: GatewayHandlerContext): void {
	Messages.handlePollVote({
		type: 'MESSAGE_POLL_VOTE_REMOVE',
		channelId: data.channel_id,
		messageId: data.message_id,
		userId: data.user_id,
		answerId: data.answer_id,
	});
}
