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
	"context"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	omv1 "github.com/percona/pmm/api/om/v1"
)

// AcquireWriterHold takes the Operations locks a non-Operations PBM writer needs on a managed
// cluster's members, so a managed-cluster backup can serialize against Operations over the API.
func (s *Service) AcquireWriterHold(ctx context.Context, req *omv1.AcquireWriterHoldRequest) (*omv1.AcquireWriterHoldResponse, error) {
	acquired, conflict, err := AcquireWriterHold(ctx, s.db, req.GetJobId(), req.GetServiceIds(), req.GetDeadline().AsTime())
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}
	resp := &omv1.AcquireWriterHoldResponse{Acquired: acquired}
	if conflict != nil {
		resp.Conflict = &omv1.WriterHoldConflict{
			HolderOperationId: conflict.HolderOperationID,
			HolderMode:        conflict.HolderMode,
			RequestedMode:     conflict.RequestedMode,
		}
	}
	return resp, nil
}

// HeartbeatWriterHold extends a writer hold's lease so the reaper does not reclaim a live writer's locks.
func (s *Service) HeartbeatWriterHold(_ context.Context, req *omv1.HeartbeatWriterHoldRequest) (*omv1.HeartbeatWriterHoldResponse, error) {
	err := HeartbeatExternalHold(s.db.Querier, req.GetJobId(), req.GetDeadline().AsTime())
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}
	return &omv1.HeartbeatWriterHoldResponse{}, nil
}

// ReleaseWriterHold drops a writer hold's locks on the backup job's terminal result; it is a no-op once released.
func (s *Service) ReleaseWriterHold(_ context.Context, req *omv1.ReleaseWriterHoldRequest) (*omv1.ReleaseWriterHoldResponse, error) { //nolint:unparam
	err := ReleaseExternalHold(s.db.Querier, req.GetJobId())
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}
	return &omv1.ReleaseWriterHoldResponse{}, nil
}
