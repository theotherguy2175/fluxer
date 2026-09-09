// SPDX-License-Identifier: AGPL-3.0-or-later

import {Spinner} from '@app/features/ui/components/Spinner';
import {computePeaks} from '@app/features/voice/components/AudioWaveform';
import styles from '@app/features/voice/components/SoundWaveform.module.css';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {PauseIcon, PlayIcon} from '@phosphor-icons/react';
import type React from 'react';
import {useMemo} from 'react';

const BAR_COUNT = 56;

const PLAY_DESCRIPTOR = msg({
	message: 'Play preview',
	comment: 'Accessible label for a soundboard preview play button.',
});
const PAUSE_DESCRIPTOR = msg({
	message: 'Pause preview',
	comment: 'Accessible label for a soundboard preview pause button.',
});

interface SoundWaveformProps {
	buffer: AudioBuffer | null;
	loading?: boolean;
	isPlaying: boolean;
	playheadFraction: number | null;
	onToggle: () => void;
}

export const SoundWaveform: React.FC<SoundWaveformProps> = ({
	buffer,
	loading = false,
	isPlaying,
	playheadFraction,
	onToggle,
}) => {
	const {i18n} = useLingui();
	const bars = useMemo(() => {
		if (!buffer) return null;
		const peaks = computePeaks(buffer, BAR_COUNT);
		let max = 0.0001;
		for (let i = 0; i < peaks.maxs.length; i++) {
			const amp = Math.max(Math.abs(peaks.maxs[i] ?? 0), Math.abs(peaks.mins[i] ?? 0));
			if (amp > max) max = amp;
		}
		return peaks.maxs.map((_, i) => {
			const amp = Math.max(Math.abs(peaks.maxs[i] ?? 0), Math.abs(peaks.mins[i] ?? 0));
			return Math.max(0.06, Math.min(1, amp / max));
		});
	}, [buffer]);

	return (
		<div className={styles.container} data-flx="voice.sound-waveform.container">
			<button
				type="button"
				className={styles.playButton}
				onClick={onToggle}
				disabled={!buffer}
				aria-label={i18n._(isPlaying ? PAUSE_DESCRIPTOR : PLAY_DESCRIPTOR)}
				data-flx="voice.sound-waveform.play-button"
			>
				{isPlaying ? (
					<PauseIcon size={16} weight="fill" data-flx="voice.sound-waveform.pause-icon" />
				) : (
					<PlayIcon size={16} weight="fill" data-flx="voice.sound-waveform.play-icon" />
				)}
			</button>
			<div className={styles.bars} data-flx="voice.sound-waveform.bars">
				{loading || !bars ? (
					<div className={styles.spinnerWrap} data-flx="voice.sound-waveform.spinner-wrap">
						<Spinner data-flx="voice.sound-waveform.spinner" />
					</div>
				) : (
					bars.map((height, i) => {
						const progressed = playheadFraction != null && i / bars.length <= playheadFraction;
						return (
							<span
								key={i}
								className={progressed ? `${styles.bar} ${styles.barProgressed}` : styles.bar}
								style={{height: `${Math.round(height * 100)}%`}}
								data-flx="voice.sound-waveform.bar"
							/>
						);
					})
				)}
			</div>
		</div>
	);
};
