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

import { Tooltip } from '@mui/material';
import { formatTimestamp } from '@pmm-extensions/framework';
import { formatAge } from '../format';

/** A compact `3m ago`, with the full local time and its zone on hover after `label`. */
export const Age = ({
  value,
  label,
}: {
  value: string | null | undefined;
  label?: string;
}) => {
  const when = formatTimestamp(value)?.title;
  const age = <span>{formatAge(value)}</span>;
  return when ? (
    <Tooltip title={label ? `${label} ${when}` : when} describeChild>
      {age}
    </Tooltip>
  ) : (
    age
  );
};
