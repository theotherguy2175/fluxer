// SPDX-License-Identifier: AGPL-3.0-or-later

import {GenericErrorModal} from '@app/features/app/components/alerts/GenericErrorModal';
// Shares the soundboard tab's stylesheet on purpose: same limits card, same
// hints, same save row — the two tabs should read as siblings.
import styles from '@app/features/guild/components/modals/guild_tabs/GuildSoundboardTab.module.css';
import * as PollCommands from '@app/features/messaging/commands/PollCommands';
import Permission from '@app/features/permissions/state/Permission';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {failureValidationErrors} from '@app/features/platform/utils/ResponseInspection';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import {Input} from '@app/features/ui/components/form/FormInput';
import {Switch} from '@app/features/ui/components/form/FormSwitch';
import {Spinner} from '@app/features/ui/components/Spinner';
import {Permissions} from '@fluxer/constants/src/ChannelConstants';
import {POLL_MIN_ANSWERS, POLL_MIN_DURATION_HOURS} from '@fluxer/constants/src/PollConstants';
import type {GuildPollSettingsResponse} from '@fluxer/schema/src/domains/message/PollSchemas';
import {msg} from '@lingui/core/macro';
import {Trans, useLingui} from '@lingui/react/macro';
import {WarningCircleIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useEffect, useMemo, useState} from 'react';

const logger = new Logger('GuildPollsTab');

const POLLS_DISABLED_DESCRIPTOR = msg({
	message: 'Polls are turned off for this instance. Ask an instance admin to enable them.',
	comment: 'Notice at the top of the community polls tab when the instance-wide polls toggle is off.',
});
const INSTANCE_LIMIT_LABEL_DESCRIPTOR = msg({
	message: 'Instance limit: {max}',
	comment: 'Small hint beside a community poll limit field showing the ceiling set by the instance. {max} is a number.',
});
const FAILED_TO_SAVE_DESCRIPTOR = msg({
	message: 'Could not save poll settings',
	comment: 'Title of the error dialog shown when saving community poll settings fails.',
});
const OUT_OF_RANGE_DESCRIPTOR = msg({
	message: 'Enter a whole number between {min} and {max}.',
	comment: 'Validation error under a numeric poll setting. {min} and {max} are whole numbers.',
});

interface Draft {
	enabled: boolean;
	maxAnswers: string;
	maxQuestionLength: string;
	maxAnswerLength: string;
	maxDurationHours: string;
	defaultDurationHours: string;
	allowMultiselect: boolean;
}

function draftFrom(settings: GuildPollSettingsResponse): Draft {
	return {
		enabled: settings.enabled,
		maxAnswers: String(settings.max_answers),
		maxQuestionLength: String(settings.max_question_length),
		maxAnswerLength: String(settings.max_answer_length),
		maxDurationHours: String(settings.max_duration_hours),
		defaultDurationHours: String(settings.default_duration_hours),
		allowMultiselect: settings.allow_multiselect,
	};
}

function parseInRange(value: string, min: number, max: number): number | null {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || String(parsed) !== value.trim() || parsed < min || parsed > max) return null;
	return parsed;
}

const GuildPollsTab: React.FC<{guildId: string}> = observer(function GuildPollsTab({guildId}) {
	const {i18n} = useLingui();
	const canManageGuild = Permission.can(Permissions.MANAGE_GUILD, {guildId});
	const [settings, setSettings] = useState<GuildPollSettingsResponse | null>(null);
	const [draft, setDraft] = useState<Draft | null>(null);
	const [status, setStatus] = useState<'pending' | 'success' | 'error'>('pending');
	const [saving, setSaving] = useState(false);

	const load = useCallback(async () => {
		setStatus('pending');
		try {
			const response = await PollCommands.getSettings(guildId);
			setSettings(response);
			setDraft(draftFrom(response));
			setStatus('success');
		} catch (error) {
			logger.error(`Failed to load poll settings for guild ${guildId}`, error);
			setStatus('error');
		}
	}, [guildId]);

	useEffect(() => {
		void load();
	}, [load]);

	const parsed = useMemo(() => {
		if (!draft || !settings) return null;
		const maxDuration = parseInRange(
			draft.maxDurationHours,
			POLL_MIN_DURATION_HOURS,
			settings.max_duration_hours_ceiling,
		);
		return {
			maxAnswers: parseInRange(draft.maxAnswers, POLL_MIN_ANSWERS, settings.max_answers_ceiling),
			maxQuestionLength: parseInRange(draft.maxQuestionLength, 1, settings.max_question_length_ceiling),
			maxAnswerLength: parseInRange(draft.maxAnswerLength, 1, settings.max_answer_length_ceiling),
			maxDurationHours: maxDuration,
			defaultDurationHours: parseInRange(
				draft.defaultDurationHours,
				POLL_MIN_DURATION_HOURS,
				maxDuration ?? settings.max_duration_hours_ceiling,
			),
		};
	}, [draft, settings]);

	const valid = parsed !== null && Object.values(parsed).every((value) => value !== null);
	const dirty = settings !== null && draft !== null && JSON.stringify(draft) !== JSON.stringify(draftFrom(settings));

	const handleSave = useCallback(async () => {
		if (!draft || !parsed || !valid || saving) return;
		setSaving(true);
		try {
			const response = await PollCommands.updateSettings(guildId, {
				enabled: draft.enabled,
				max_answers: parsed.maxAnswers ?? undefined,
				max_question_length: parsed.maxQuestionLength ?? undefined,
				max_answer_length: parsed.maxAnswerLength ?? undefined,
				max_duration_hours: parsed.maxDurationHours ?? undefined,
				default_duration_hours: parsed.defaultDurationHours ?? undefined,
				allow_multiselect: draft.allowMultiselect,
			});
			setSettings(response);
			setDraft(draftFrom(response));
		} catch (error) {
			logger.error(`Failed to save poll settings for guild ${guildId}`, error);
			const details = failureValidationErrors(error)
				?.map((entry) => entry.message)
				.join(' ');
			ModalCommands.push(
				modal(() => (
					<GenericErrorModal
						title={i18n._(FAILED_TO_SAVE_DESCRIPTOR)}
						message={details && details.length > 0 ? details : error instanceof Error ? error.message : ''}
						data-flx="guild.guild-tabs.guild-polls-tab.save-error-modal"
					/>
				)),
			);
		} finally {
			setSaving(false);
		}
	}, [draft, parsed, valid, saving, guildId, i18n]);

	if (status === 'pending' || !draft || !settings || !parsed) {
		return (
			<div className={styles.container} data-flx="guild.guild-tabs.guild-polls-tab.container">
				{status === 'error' ? (
					<div className={styles.notice} data-flx="guild.guild-tabs.guild-polls-tab.error-notice">
						<p className={styles.noticeText}>
							<Trans>Poll settings could not be loaded.</Trans>
						</p>
						<Button type="button" small onClick={() => void load()} data-flx="guild.guild-tabs.guild-polls-tab.retry">
							<Trans>Retry</Trans>
						</Button>
					</div>
				) : (
					<div className={styles.spinnerContainer} data-flx="guild.guild-tabs.guild-polls-tab.spinner-container">
						<Spinner data-flx="guild.guild-tabs.guild-polls-tab.spinner" />
					</div>
				)}
			</div>
		);
	}

	const rangeError = (value: number | null, min: number, max: number): string | undefined =>
		value === null ? i18n._(OUT_OF_RANGE_DESCRIPTOR, {min, max}) : undefined;
	const update = (patch: Partial<Draft>) => setDraft((current) => (current ? {...current, ...patch} : current));
	const disabledByInstance = !settings.instance_enabled;
	const readOnly = !canManageGuild || disabledByInstance;

	return (
		<div className={styles.container} data-flx="guild.guild-tabs.guild-polls-tab.container">
			{disabledByInstance && (
				<div className={styles.notice} data-flx="guild.guild-tabs.guild-polls-tab.disabled-notice">
					<p className={styles.noticeText} data-flx="guild.guild-tabs.guild-polls-tab.disabled-notice-text">
						<WarningCircleIcon size={32} weight="fill" data-flx="guild.guild-tabs.guild-polls-tab.warning-icon" />
						{i18n._(POLLS_DISABLED_DESCRIPTOR)}
					</p>
				</div>
			)}
			<div className={styles.limitsSection} data-flx="guild.guild-tabs.guild-polls-tab.limits-section">
				<div className={styles.limitsHeader} data-flx="guild.guild-tabs.guild-polls-tab.limits-header">
					<h3 className={styles.limitsTitle} data-flx="guild.guild-tabs.guild-polls-tab.limits-title">
						<Trans>Polls</Trans>
					</h3>
					<p className={styles.limitsHint} data-flx="guild.guild-tabs.guild-polls-tab.limits-hint">
						<Trans>
							Choose whether members can create polls here and how big they can be. Each value is capped by the instance
							limit shown beside it. Requires Manage Community.
						</Trans>
					</p>
				</div>
				<Switch
					value={draft.enabled}
					onChange={(value) => update({enabled: value})}
					disabled={readOnly}
					label={<Trans>Allow polls in this community</Trans>}
					description={<Trans>Members with the Send Polls permission can post polls in text channels.</Trans>}
					data-flx="guild.guild-tabs.guild-polls-tab.enabled-switch"
				/>
				<div className={styles.limitsGrid} data-flx="guild.guild-tabs.guild-polls-tab.limits-grid">
					<Input
						type="number"
						label={<Trans>Max answers per poll</Trans>}
						labelRight={
							<span className={styles.limitHint}>
								{i18n._(INSTANCE_LIMIT_LABEL_DESCRIPTOR, {max: String(settings.max_answers_ceiling)})}
							</span>
						}
						value={draft.maxAnswers}
						min={POLL_MIN_ANSWERS}
						max={settings.max_answers_ceiling}
						step={1}
						disabled={readOnly}
						error={rangeError(parsed.maxAnswers, POLL_MIN_ANSWERS, settings.max_answers_ceiling)}
						onChange={(event) => update({maxAnswers: event.currentTarget.value})}
						data-flx="guild.guild-tabs.guild-polls-tab.max-answers-input"
					/>
					<Input
						type="number"
						label={<Trans>Max duration (hours)</Trans>}
						labelRight={
							<span className={styles.limitHint}>
								{i18n._(INSTANCE_LIMIT_LABEL_DESCRIPTOR, {max: String(settings.max_duration_hours_ceiling)})}
							</span>
						}
						value={draft.maxDurationHours}
						min={POLL_MIN_DURATION_HOURS}
						max={settings.max_duration_hours_ceiling}
						step={1}
						disabled={readOnly}
						error={rangeError(parsed.maxDurationHours, POLL_MIN_DURATION_HOURS, settings.max_duration_hours_ceiling)}
						onChange={(event) => update({maxDurationHours: event.currentTarget.value})}
						data-flx="guild.guild-tabs.guild-polls-tab.max-duration-input"
					/>
					<Input
						type="number"
						label={<Trans>Max question length</Trans>}
						labelRight={
							<span className={styles.limitHint}>
								{i18n._(INSTANCE_LIMIT_LABEL_DESCRIPTOR, {max: String(settings.max_question_length_ceiling)})}
							</span>
						}
						value={draft.maxQuestionLength}
						min={1}
						max={settings.max_question_length_ceiling}
						step={1}
						disabled={readOnly}
						error={rangeError(parsed.maxQuestionLength, 1, settings.max_question_length_ceiling)}
						onChange={(event) => update({maxQuestionLength: event.currentTarget.value})}
						data-flx="guild.guild-tabs.guild-polls-tab.max-question-length-input"
					/>
					<Input
						type="number"
						label={<Trans>Max answer length</Trans>}
						labelRight={
							<span className={styles.limitHint}>
								{i18n._(INSTANCE_LIMIT_LABEL_DESCRIPTOR, {max: String(settings.max_answer_length_ceiling)})}
							</span>
						}
						value={draft.maxAnswerLength}
						min={1}
						max={settings.max_answer_length_ceiling}
						step={1}
						disabled={readOnly}
						error={rangeError(parsed.maxAnswerLength, 1, settings.max_answer_length_ceiling)}
						onChange={(event) => update({maxAnswerLength: event.currentTarget.value})}
						data-flx="guild.guild-tabs.guild-polls-tab.max-answer-length-input"
					/>
					<Input
						type="number"
						label={<Trans>Default duration (hours)</Trans>}
						labelRight={
							<span className={styles.limitHint}>
								{i18n._(INSTANCE_LIMIT_LABEL_DESCRIPTOR, {
									max: String(parsed.maxDurationHours ?? settings.max_duration_hours_ceiling),
								})}
							</span>
						}
						value={draft.defaultDurationHours}
						min={POLL_MIN_DURATION_HOURS}
						max={parsed.maxDurationHours ?? settings.max_duration_hours_ceiling}
						step={1}
						disabled={readOnly}
						error={rangeError(
							parsed.defaultDurationHours,
							POLL_MIN_DURATION_HOURS,
							parsed.maxDurationHours ?? settings.max_duration_hours_ceiling,
						)}
						onChange={(event) => update({defaultDurationHours: event.currentTarget.value})}
						data-flx="guild.guild-tabs.guild-polls-tab.default-duration-input"
					/>
				</div>
				<Switch
					value={draft.allowMultiselect}
					onChange={(value) => update({allowMultiselect: value})}
					disabled={readOnly}
					label={<Trans>Allow polls with multiple answers</Trans>}
					description={<Trans>When off, every poll posted here is single-choice.</Trans>}
					data-flx="guild.guild-tabs.guild-polls-tab.multiselect-switch"
				/>
				{canManageGuild && (
					<div className={styles.limitsActions} data-flx="guild.guild-tabs.guild-polls-tab.limits-actions">
						<Button
							type="button"
							small
							disabled={!dirty || !valid || disabledByInstance}
							submitting={saving}
							onClick={() => void handleSave()}
							data-flx="guild.guild-tabs.guild-polls-tab.save-button"
						>
							<Trans>Save changes</Trans>
						</Button>
					</div>
				)}
			</div>
		</div>
	);
});

export default GuildPollsTab;
