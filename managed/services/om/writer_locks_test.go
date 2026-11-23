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
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/reform.v1"

	"github.com/percona/pmm/managed/models"
)

func managedMember(t *testing.T, db *reform.DB, clusterID, serviceID string) string {
	t.Helper()
	nodeID := uuid.New().String()
	_, err := db.Exec(
		"INSERT INTO nodes (node_id, node_type, node_name, distro, node_model, az, address, created_at, updated_at) "+
			"VALUES ($1, 'generic', $2, '', '', '', '', now(), now())",
		nodeID, "node-"+serviceID)
	require.NoError(t, err)
	_, err = db.Exec(
		"INSERT INTO services (service_id, service_type, service_name, node_id, environment, cluster, replication_set, external_group, created_at, updated_at) "+
			"VALUES ($1, 'mongodb', $2, $3, '', '', '', '', now(), now())",
		serviceID, "svc-"+serviceID, nodeID)
	require.NoError(t, err)
	replicaSet := &models.OmReplicaSet{
		ID: uuid.New().String(), ClusterID: clusterID, Name: "rs-" + serviceID, Role: models.OmReplicaSetRolePlain,
	}
	require.NoError(t, db.Insert(replicaSet))
	rsMemberID := int32(1)
	member := &models.OmClusterMember{
		ID: uuid.New().String(), ClusterID: clusterID, ReplicaSetRef: &replicaSet.ID, Process: models.OmMemberMongod,
		Host: "host-" + serviceID, RSMemberID: &rsMemberID, State: models.OmMemberAccepted,
		NodeID: &nodeID, ServiceID: &serviceID, AddedByOperation: lockOperation(t, db.Querier, clusterID),
	}
	require.NoError(t, db.Insert(member))
	return member.ID
}

func lockModes(t *testing.T, db *reform.DB, operationID string) map[string]string {
	t.Helper()
	rows, err := db.Query(
		"SELECT resource_kind, mode FROM om_locks WHERE operation_id = $1 ORDER BY resource_kind", operationID)
	require.NoError(t, err)
	defer rows.Close() //nolint:errcheck
	modes := make(map[string]string)
	for rows.Next() {
		var kind, mode string
		require.NoError(t, rows.Scan(&kind, &mode))
		modes[kind] = mode
	}
	require.NoError(t, rows.Err())
	return modes
}

func TestAcquireWriterHoldManagedMember(t *testing.T) {
	db := lockTestDB(t)
	clusterID := lockCluster(t, db.Querier)
	serviceID := uuid.New().String()
	managedMember(t, db, clusterID, serviceID)
	jobID := "backup-job-managed"

	acquired, conflict, err := AcquireWriterHold(t.Context(), db, jobID, []string{serviceID}, time.Now().Add(time.Minute))
	require.NoError(t, err)
	assert.Nil(t, conflict)
	assert.True(t, acquired)

	holdOp := externalOpID(jobID)
	assert.Equal(t, 2, heldLocks(t, db, holdOp))
	modes := lockModes(t, db, holdOp)
	assert.Equal(t, string(models.OmLockExclusive), modes["cluster"])
	assert.Equal(t, string(models.OmLockExclusive), modes["member"])

	t.Run("release drops the writer's locks", func(t *testing.T) {
		require.NoError(t, ReleaseExternalHold(db.Querier, jobID))
		assert.Equal(t, 0, heldLocks(t, db, holdOp))
	})
}

func TestAcquireWriterHoldUnmanagedTakesNoLock(t *testing.T) {
	db := lockTestDB(t)
	lockCluster(t, db.Querier)
	jobID := "backup-job-standalone"

	acquired, conflict, err := AcquireWriterHold(t.Context(), db, jobID, []string{uuid.New().String()}, time.Now().Add(time.Minute))
	require.NoError(t, err)
	assert.Nil(t, conflict)
	assert.False(t, acquired, "a backup of a service that is not a managed member takes no lock")
	assert.Equal(t, 0, heldLocks(t, db, externalOpID(jobID)))
}

func TestAcquireWriterHoldFanOutLocksEveryMember(t *testing.T) {
	db := lockTestDB(t)
	clusterID := lockCluster(t, db.Querier)
	serviceA := uuid.New().String()
	serviceB := uuid.New().String()
	managedMember(t, db, clusterID, serviceA)
	managedMember(t, db, clusterID, serviceB)
	jobID := "restore-job-fanout"

	acquired, conflict, err := AcquireWriterHold(t.Context(), db, jobID, []string{serviceA, serviceB}, time.Now().Add(time.Minute))
	require.NoError(t, err)
	assert.Nil(t, conflict)
	assert.True(t, acquired)
	assert.Equal(t, 3, heldLocks(t, db, externalOpID(jobID)), "the cluster plus both affected members")
}

func TestAcquireWriterHoldConflictNamesHolder(t *testing.T) {
	db := lockTestDB(t)
	clusterID := lockCluster(t, db.Querier)
	serviceID := uuid.New().String()
	memberID := managedMember(t, db, clusterID, serviceID)
	driverOp := lockOperation(t, db.Querier, clusterID)
	require.NoError(t, acquireLocks(db.Querier, driverOp,
		[]LockResource{{Kind: "member", ID: memberID, Mode: models.OmLockExclusive}}))
	jobID := "backup-job-conflict"

	acquired, conflict, err := AcquireWriterHold(t.Context(), db, jobID, []string{serviceID}, time.Now().Add(time.Minute))
	require.NoError(t, err)
	assert.False(t, acquired)
	require.NotNil(t, conflict)
	assert.Equal(t, driverOp, conflict.HolderOperationID)
	assert.Equal(t, 0, heldLocks(t, db, externalOpID(jobID)), "a refused acquire rolls back whole")
}

func TestAcquireWriterHoldIdempotent(t *testing.T) {
	db := lockTestDB(t)
	clusterID := lockCluster(t, db.Querier)
	serviceID := uuid.New().String()
	managedMember(t, db, clusterID, serviceID)
	jobID := "backup-job-retry"
	deadline := time.Now().Add(time.Minute)

	first, _, err := AcquireWriterHold(t.Context(), db, jobID, []string{serviceID}, deadline)
	require.NoError(t, err)
	require.True(t, first)

	again, conflict, err := AcquireWriterHold(t.Context(), db, jobID, []string{serviceID}, deadline)
	require.NoError(t, err)
	assert.Nil(t, conflict)
	assert.True(t, again)
	assert.Equal(t, 2, heldLocks(t, db, externalOpID(jobID)), "a retry reuses the same hold")
}

func TestStopYieldsToPBMStubNeverBlocks(t *testing.T) {
	blocked, err := stopYieldsToPBM(t.Context(), noPBMActivity{}, uuid.New().String())
	require.NoError(t, err)
	assert.False(t, blocked, "the interim probe reports no PBM activity until E0-T4's fact lands")
}
