// SPDX-License-Identifier: AGPL-3.0-or-later

import {Logger} from '@app/api/Logger';
import {getWorkerDependencies} from '@app/api/worker/WorkerContext';
import type {WorkerTaskHandler} from '@pkgs/worker/src/contracts/WorkerTask';

// Finalizes polls whose timer has run out: locks votes, broadcasts the
// updated message and posts the POLL_RESULT message. Reads also finalize
// lazily, so this only has to catch polls nobody looked at.
export async function processExpiredPolls(now = new Date()): Promise<void> {
	const {channelService} = getWorkerDependencies();
	const result = await channelService.polls.finalizeExpired(now);
	if (result.finalized > 0 || result.skipped > 0) {
		Logger.info(result, 'Finalized expired polls');
	}
}

const expirePolls: WorkerTaskHandler = async () => {
	await processExpiredPolls();
};

export default expirePolls;
