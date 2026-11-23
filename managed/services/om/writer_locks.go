// Copyright (C) 2023 Percona LLC
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

package om

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"gopkg.in/reform.v1"

	"github.com/percona/pmm/managed/models"
)

// writerHoldKind labels a PBM-writing backup's external hold in om_operations.kind.
const writerHoldKind = "backup"

// managedMemberLocks returns the exclusive cluster and member locks for the services that are live
// members of a managed cluster, and that cluster's id, or no resources when none are managed.
func managedMemberLocks(q *reform.Querier, serviceIDs []string) (string, []LockResource, error) {
	clusterID := ""
	resources := make([]LockResource, 0, len(serviceIDs)+1)
	lockedCluster := make(map[string]bool)
	for _, serviceID := range serviceIDs {
		var memberID, memberCluster string
		err := q.QueryRow(
			"SELECT id, cluster_id FROM om_cluster_members WHERE service_id = $1 AND removed_at IS NULL",
			serviceID).Scan(&memberID, &memberCluster)
		if errors.Is(err, reform.ErrNoRows) {
			continue
		}
		if err != nil {
			return "", nil, fmt.Errorf("failed to resolve managed member for service '%s': %w", serviceID, err)
		}
		if !lockedCluster[memberCluster] {
			lockedCluster[memberCluster] = true
			clusterID = memberCluster
			resources = append(resources, LockResource{Kind: "cluster", ID: memberCluster, Mode: models.OmLockExclusive})
		}
		resources = append(resources, LockResource{Kind: "member", ID: memberID, Mode: models.OmLockExclusive})
	}
	slices.SortFunc(resources, func(a, b LockResource) int {
		if c := cmp.Compare(a.Kind, b.Kind); c != 0 {
			return c
		}
		return cmp.Compare(a.ID, b.ID)
	})
	return clusterID, resources, nil
}

// AcquireWriterHold commits the cluster and member locks a PBM-writing backup needs on a managed
// cluster through E0-T2's job-keyed external hold, taking none when unmanaged and naming the holder on a conflict.
func AcquireWriterHold(ctx context.Context, db *reform.DB, jobID string, serviceIDs []string, deadline time.Time) (bool, *LockConflict, error) {
	acquired := false
	txErr := db.InTransactionContext(ctx, nil, func(tx *reform.TX) error {
		clusterID, resources, err := managedMemberLocks(tx.Querier, serviceIDs)
		if err != nil {
			return err
		}
		if len(resources) == 0 {
			return nil
		}
		_, err = AcquireExternalHold(tx.Querier, jobID, writerHoldKind, clusterID, resources, deadline)
		if err != nil {
			return err
		}
		acquired = true
		return nil
	})
	if txErr != nil {
		conflict, ok := parseLockConflict(txErr)
		if ok {
			return false, &conflict, nil
		}
		return false, nil, txErr
	}
	return acquired, nil, nil
}

// PBMActivityProbe reports whether a PBM operation running on a member blocks an Operations stop
// step, implemented by E0-T4's pbm-status fact re-read fresh on the host before the stop.
type PBMActivityProbe interface {
	PBMBusy(ctx context.Context, memberID string) (bool, error)
}

// noPBMActivity is the interim probe until E0-T4's pbm-status fact lands: it reports no member busy,
// so a stop step is never blocked, matching today's behaviour.
type noPBMActivity struct{}

// PBMBusy reports no member busy.
func (noPBMActivity) PBMBusy(context.Context, string) (bool, error) {
	return false, nil
}

// stopYieldsToPBM reports whether an Operations stop step must yield to a running PBM backup,
// restore or resync on the member; the stop-step guard calls it with E0-T4's probe.
func stopYieldsToPBM(ctx context.Context, probe PBMActivityProbe, memberID string) (bool, error) {
	busy, err := probe.PBMBusy(ctx, memberID)
	if err != nil {
		return false, fmt.Errorf("failed to read PBM activity for member '%s': %w", memberID, err)
	}
	return busy, nil
}
