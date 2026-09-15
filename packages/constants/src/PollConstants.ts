// SPDX-License-Identifier: AGPL-3.0-or-later

// Instance defaults (what a fresh instance allows) and hard ceilings (what an
// admin may raise the instance limit to). Communities can only tighten the
// effective instance value, never exceed it — see GuildPollService.
export const POLL_DEFAULT_MAX_ANSWERS = 10;
export const POLL_MAX_ANSWERS_CEILING = 25;
export const POLL_MIN_ANSWERS = 2;

export const POLL_DEFAULT_MAX_QUESTION_LENGTH = 300;
export const POLL_MAX_QUESTION_LENGTH_CEILING = 1000;

export const POLL_DEFAULT_MAX_ANSWER_LENGTH = 55;
export const POLL_MAX_ANSWER_LENGTH_CEILING = 200;

export const POLL_MIN_DURATION_HOURS = 1;
export const POLL_DEFAULT_DURATION_HOURS = 24;
export const POLL_DEFAULT_MAX_DURATION_HOURS = 32 * 24;
export const POLL_MAX_DURATION_HOURS_CEILING = 365 * 24;

export const POLL_EMOJI_MAX_LENGTH = 32;

// Discord-compatible layout enum; only DEFAULT exists today.
export const PollLayoutTypes = {
	DEFAULT: 1,
} as const;
export type PollLayoutType = (typeof PollLayoutTypes)[keyof typeof PollLayoutTypes];

// Duration presets offered by the composer, filtered to the effective maximum.
export const POLL_DURATION_PRESETS_HOURS: ReadonlyArray<number> = Object.freeze([1, 4, 8, 24, 72, 168, 336]);
