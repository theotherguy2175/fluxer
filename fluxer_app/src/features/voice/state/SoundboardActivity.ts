// SPDX-License-Identifier: AGPL-3.0-or-later

import {makeAutoObservable} from 'mobx';

export interface SoundboardActivityEntry {
	emojiId: string | null;
	emojiName: string | null;
	emojiAnimated: boolean;
	nonce: number;
}

const DISPLAY_MS = 2600;

class SoundboardActivity {
	entries: Record<string, SoundboardActivityEntry> = {};
	private timers: Record<string, ReturnType<typeof setTimeout>> = {};
	private counter = 0;

	constructor() {
		makeAutoObservable<this, 'timers' | 'counter'>(
			this,
			{timers: false, counter: false, getForUser: false},
			{autoBind: true},
		);
	}

	notifyPlayed(
		userId: string,
		emoji: {emojiId: string | null; emojiName: string | null; emojiAnimated: boolean},
	): void {
		if (!userId) return;
		if (emoji.emojiId == null && !emoji.emojiName) return;
		this.counter += 1;
		this.entries = {
			...this.entries,
			[userId]: {
				emojiId: emoji.emojiId,
				emojiName: emoji.emojiName,
				emojiAnimated: emoji.emojiAnimated,
				nonce: this.counter,
			},
		};
		const existing = this.timers[userId];
		if (existing != null) {
			clearTimeout(existing);
		}
		this.timers[userId] = setTimeout(() => this.expire(userId), DISPLAY_MS);
	}

	getForUser(userId: string): SoundboardActivityEntry | null {
		return this.entries[userId] ?? null;
	}

	private expire(userId: string): void {
		delete this.timers[userId];
		const {[userId]: _removed, ...rest} = this.entries;
		this.entries = rest;
	}
}

export default new SoundboardActivity();
