// SPDX-License-Identifier: AGPL-3.0-or-later

import {SystemMessage} from '@app/features/channel/components/SystemMessage';
import {SystemMessageUsername} from '@app/features/channel/components/SystemMessageUsername';
import {useSystemMessageData} from '@app/features/messaging/hooks/useSystemMessageData';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import {goToMessage} from '@app/features/messaging/utils/MessageNavigator';
import styles from '@app/features/theme/styles/Message.module.css';
import {plural} from '@lingui/core/macro';
import {Trans} from '@lingui/react/macro';
import {ChartBarIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useMemo} from 'react';

interface PollResultMessageProps {
	message: Message;
}

// Posted by the server when a poll ends. The message itself has no body;
// everything shown here comes from the referenced poll message, which the
// server resolves into referenced_message when it can.
export const PollResultMessage = observer(({message}: PollResultMessageProps) => {
	const {author, channel, guild} = useSystemMessageData(message);
	const poll = message.referencedMessage?.poll ?? null;

	const jumpToPoll = useCallback(() => {
		if (message.messageReference?.message_id) {
			goToMessage(message.channelId, message.messageReference.message_id, {
				returnToMessageId: message.id,
				returnChannelId: message.channelId,
			});
		}
	}, [message.channelId, message.id, message.messageReference?.message_id]);

	const outcome = useMemo(() => {
		if (!poll) return null;
		const counts = poll.results.answer_counts;
		const total = counts.reduce((sum, entry) => sum + entry.count, 0);
		if (total === 0) return {total, winners: [] as Array<string>, percent: 0};
		const max = Math.max(...counts.map((entry) => entry.count));
		const winners = counts
			.filter((entry) => entry.count === max)
			.map((entry) => poll.answers.find((answer) => answer.answer_id === entry.id)?.text ?? '')
			.filter((text) => text.length > 0);
		return {total, winners, percent: Math.round((max / total) * 100)};
	}, [poll]);

	if (!channel) return null;

	const pollLink = (
		<button
			key={`poll-${message.id}`}
			type="button"
			className={styles.systemMessageLink}
			onClick={jumpToPoll}
			data-flx="channel.poll-result-message.jump-to-poll"
		>
			{poll ? poll.question.text : <Trans>a poll</Trans>}
		</button>
	);
	const username = (
		<SystemMessageUsername
			key={author.id}
			author={author}
			guild={guild}
			message={message}
			data-flx="channel.poll-result-message.system-message-username"
		/>
	);

	let messageContent: React.ReactNode;
	if (!outcome || outcome.total === 0) {
		messageContent = (
			<Trans>
				{username}’s poll {pollLink} has ended. Nobody voted.
			</Trans>
		);
	} else if (outcome.winners.length === 1) {
		const votes = plural({count: outcome.total}, {one: '# vote', other: '# votes'});
		messageContent = (
			<Trans>
				{username}’s poll {pollLink} has ended. <strong>{outcome.winners[0]}</strong> won with {outcome.percent}% of{' '}
				{votes}.
			</Trans>
		);
	} else {
		const votes = plural({count: outcome.total}, {one: '# vote', other: '# votes'});
		messageContent = (
			<Trans>
				{username}’s poll {pollLink} has ended in a tie between <strong>{outcome.winners.join(', ')}</strong> ({votes}
				).
			</Trans>
		);
	}

	return (
		<SystemMessage
			icon={ChartBarIcon}
			iconWeight="fill"
			message={message}
			messageContent={messageContent}
			data-flx="channel.poll-result-message.system-message"
		/>
	);
});
