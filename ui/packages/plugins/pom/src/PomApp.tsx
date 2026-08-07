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
import { ClustersOverviewPage } from './ClustersOverviewPage';
import { ClusterDetailPage } from './ClusterDetailPage';
import { RunsPage } from './RunsPage';

/**
 * POM app router. The shell mounts this at ``sep/pom/*``; the clusters overview
 * is the index route, a cluster opens at ``clusters/:clusterId``, and the
 * discovery history lives at ``runs``.
 */
export function PomApp() {
  return (
    <Routes>
      <Route index element={<ClustersOverviewPage />} />
      <Route path="clusters/:clusterId" element={<ClusterDetailPage />} />
      <Route path="runs" element={<RunsPage />} />
    </Routes>
  );
}
