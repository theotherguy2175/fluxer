// SPDX-License-Identifier: AGPL-3.0-or-later

import {buildCustomEmojiURL} from '@app/features/expressions/utils/CustomEmojiImageUrl';
import {getEmojiURL} from '@app/features/expressions/utils/EmojiUtils';
import type React from 'react';

interface SoundboardEmojiProps {
	emojiId: string | null;
	emojiName: string | null;
	emojiAnimated?: boolean;
	size?: number;
	className?: string;
}

export const SoundboardEmoji: React.FC<SoundboardEmojiProps> = ({
	emojiId,
	emojiName,
	emojiAnimated = false,
	size = 20,
	className,
}) => {
	const url = emojiId
		? buildCustomEmojiURL({id: emojiId, animated: emojiAnimated})
		: emojiName
			? getEmojiURL(emojiName)
			: null;
	if (!url) return null;
	return (
		<img
			src={url}
			alt={emojiName ?? ''}
			width={size}
			height={size}
			loading="lazy"
			className={className}
			style={{objectFit: 'contain', flex: 'none'}}
			data-flx="expressions.soundboard-emoji.img"
		/>
	);
};
