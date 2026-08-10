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

import { Route, Routes } from 'react-router-dom';
import { TopologyPage } from './TopologyPage';
import { RunsPage } from './RunsPage';

/**
 * POM app router. The shell mounts this at ``sep/pom/*``; the topology table is the
 * index route and the discovery history lives at ``runs``.
 *
 * There is no per-cluster route: the snapshot is one document and the table renders
 * all of it, so a detail page would only re-show rows the reader already has.
 */
export function PomApp() {
  return (
    <Routes>
      <Route index element={<TopologyPage />} />
      <Route path="runs" element={<RunsPage />} />
    </Routes>
  );
}
