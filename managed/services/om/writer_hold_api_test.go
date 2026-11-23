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
	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gopkg.in/reform.v1"

	omv1 "github.com/percona/pmm/api/om/v1"
	"github.com/percona/pmm/managed/models"
)

func writerHoldService(t *testing.T, db *reform.DB) *Service {
	t.Helper()
	return &Service{db: db, l: logrus.WithField("test", t.Name())}
}

func futureDeadline() *timestamppb.Timestamp {
	return timestamppb.New(time.Now().Add(time.Minute))
}

func TestAcquireWriterHoldHandlerManaged(t *testing.T) {
	db := lockTestDB(t)
	svc := writerHoldService(t, db)
	clusterID := lockCluster(t, db.Querier)
	serviceID := uuid.New().String()
	managedMember(t, db, clusterID, serviceID)
	jobID := "api-job-managed"

	resp, err := svc.AcquireWriterHold(t.Context(), &omv1.AcquireWriterHoldRequest{
		JobId: jobID, ServiceIds: []string{serviceID}, Deadline: futureDeadline(),
	})
	require.NoError(t, err)
	assert.True(t, resp.Acquired)
	assert.Nil(t, resp.Conflict)
	assert.Equal(t, 2, heldLocks(t, db, externalOpID(jobID)))
}

func TestAcquireWriterHoldHandlerUnmanaged(t *testing.T) {
	db := lockTestDB(t)
	svc := writerHoldService(t, db)
	lockCluster(t, db.Querier)
	jobID := "api-job-standalone"

	resp, err := svc.AcquireWriterHold(t.Context(), &omv1.AcquireWriterHoldRequest{
		JobId: jobID, ServiceIds: []string{uuid.New().String()}, Deadline: futureDeadline(),
	})
	require.NoError(t, err)
	assert.False(t, resp.Acquired)
	assert.Nil(t, resp.Conflict)
	assert.Equal(t, 0, heldLocks(t, db, externalOpID(jobID)))
}

func TestAcquireWriterHoldHandlerConflictNamesHolder(t *testing.T) {
	db := lockTestDB(t)
	svc := writerHoldService(t, db)
	clusterID := lockCluster(t, db.Querier)
	serviceID := uuid.New().String()
	memberID := managedMember(t, db, clusterID, serviceID)
	driverOp := lockOperation(t, db.Querier, clusterID)
	require.NoError(t, acquireLocks(db.Querier, driverOp,
		[]LockResource{{Kind: "member", ID: memberID, Mode: models.OmLockExclusive}}))
	jobID := "api-job-conflict"

	resp, err := svc.AcquireWriterHold(t.Context(), &omv1.AcquireWriterHoldRequest{
		JobId: jobID, ServiceIds: []string{serviceID}, Deadline: futureDeadline(),
	})
	require.NoError(t, err)
	assert.False(t, resp.Acquired)
	require.NotNil(t, resp.Conflict)
	assert.Equal(t, driverOp, resp.Conflict.HolderOperationId)
	assert.Equal(t, string(models.OmLockExclusive), resp.Conflict.HolderMode)
	assert.Equal(t, 0, heldLocks(t, db, externalOpID(jobID)))
}

func TestWriterHoldHandlerHeartbeatAndRelease(t *testing.T) {
	db := lockTestDB(t)
	svc := writerHoldService(t, db)
	clusterID := lockCluster(t, db.Querier)
	serviceID := uuid.New().String()
	managedMember(t, db, clusterID, serviceID)
	jobID := "api-job-lifecycle"

	_, err := svc.AcquireWriterHold(t.Context(), &omv1.AcquireWriterHoldRequest{
		JobId: jobID, ServiceIds: []string{serviceID}, Deadline: futureDeadline(),
	})
	require.NoError(t, err)

	_, err = svc.HeartbeatWriterHold(t.Context(), &omv1.HeartbeatWriterHoldRequest{
		JobId: jobID, Deadline: timestamppb.New(time.Now().Add(2 * time.Minute)),
	})
	require.NoError(t, err)
	assert.Equal(t, 2, heldLocks(t, db, externalOpID(jobID)), "a heartbeat keeps the locks")

	_, err = svc.ReleaseWriterHold(t.Context(), &omv1.ReleaseWriterHoldRequest{JobId: jobID})
	require.NoError(t, err)
	assert.Equal(t, 0, heldLocks(t, db, externalOpID(jobID)))

	_, err = svc.ReleaseWriterHold(t.Context(), &omv1.ReleaseWriterHoldRequest{JobId: jobID})
	require.NoError(t, err, "release is a no-op once released")
}
