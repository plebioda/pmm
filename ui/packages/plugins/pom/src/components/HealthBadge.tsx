/**
 * Copyright (C) 2026 Percona LLC
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { Chip } from '@percona/percona-ui';
import {
  HEALTH_COLOR,
  HEALTH_LABEL,
  RUN_STATUS_COLOR,
  RUN_STATUS_LABEL,
} from '../constants';
import type { PomHealthStatus, PomRunStatus } from '../types';

/**
 * Cluster health as a chip.
 *
 * `unknown` is outlined rather than filled so it reads as a distinct state — the
 * fleet has not been observed — instead of a fourth severity on the same scale.
 */
export function HealthBadge({ status }: { status: PomHealthStatus }) {
  return (
    <Chip
      size="small"
      label={HEALTH_LABEL[status] ?? status}
      color={HEALTH_COLOR[status] ?? 'default'}
      variant={status === 'unknown' ? 'outlined' : 'filled'}
    />
  );
}

/** Discovery-run status as a chip. */
export function RunStatusBadge({ status }: { status: PomRunStatus }) {
  return (
    <Chip
      size="small"
      label={RUN_STATUS_LABEL[status] ?? status}
      color={RUN_STATUS_COLOR[status] ?? 'default'}
      variant={status === 'running' ? 'outlined' : 'filled'}
    />
  );
}
