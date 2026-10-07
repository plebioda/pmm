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

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OmApiError } from '../src/api';
import { NodesPage } from '../src/NodesPage';
import type { OmInventoryHost } from '../src/types';

const {
  useOmInventoryHosts,
  useRefreshInventory,
  useIsEstateRefreshing,
  useForgetHost,
  useOmBootstrapRuns,
  useActiveInventoryRun,
} = vi.hoisted(() => ({
  useOmInventoryHosts: vi.fn(),
  useRefreshInventory: vi.fn(),
  useIsEstateRefreshing: vi.fn(),
  useForgetHost: vi.fn(),
  useOmBootstrapRuns: vi.fn(),
  useActiveInventoryRun: vi.fn(),
}));

vi.mock('../src/inventoryHooks', () => ({
  useOmInventoryHosts,
  useRefreshInventory,
  useIsEstateRefreshing,
  useForgetHost,
  useOmBootstrapRuns,
  useActiveInventoryRun,
}));

const host = (overrides: Partial<OmInventoryHost> = {}): OmInventoryHost => ({
  node_id: 'node-1',
  name: 'node00',
  address: '10.0.0.1',
  services: [],
  unregistered_mongods: [],
  automation_eligible: true,
  automation_blocked_reasons: [],
  pmm_agent_connected: true,
  executor: { registered: true, reachable: true, driver_healthy: true },
  observed: {},
  freshness: {
    consecutive_failures: 0,
    last_success_at: '2026-10-06T09:00:00Z',
  },
  ...overrides,
});

const forgetOne = vi.fn();

const renderPage = (hosts: OmInventoryHost[] = [host()]) => {
  useOmInventoryHosts.mockReturnValue({
    data: hosts,
    isPending: false,
    isError: false,
  });
  return render(
    <MemoryRouter>
      <NodesPage />
    </MemoryRouter>
  );
};

const rowFor = (name: string) =>
  screen
    .getAllByRole('row')
    .find((row) => within(row).queryByText(name)) as HTMLElement;

describe('NodesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRefreshInventory.mockReturnValue({
      refreshAll: vi.fn(),
      refreshHosts: vi.fn(),
      isPending: false,
      isError: false,
    });
    useIsEstateRefreshing.mockReturnValue(false);
    useActiveInventoryRun.mockReturnValue({ run: undefined, updatedAt: 0 });
    useForgetHost.mockReturnValue({ mutateAsync: forgetOne, isPending: false });
    useOmBootstrapRuns.mockReturnValue({ data: [] });
    forgetOne.mockResolvedValue(undefined);
  });

  // The row's daily actions stay on the row. Forget does not, because three text
  // buttons did not fit the width the page gets - see the overflow menu's own
  // comment. These two assertions are a pair: the first says what is reachable in
  // one click, the second that the destructive one is not.
  it('keeps Scan and Install MongoDB on the row', () => {
    renderPage();

    const row = rowFor('node00');
    expect(
      within(row).getByRole('button', { name: 'Scan' })
    ).toBeInTheDocument();
    expect(
      within(row).getByRole('button', { name: 'Install MongoDB' })
    ).toBeInTheDocument();
  });

  it('does not offer Forget until the row menu is opened', () => {
    renderPage();

    expect(screen.queryByText('Forget')).toBeNull();
    fireEvent.click(
      within(rowFor('node00')).getByRole('button', { name: /More actions/ })
    );

    expect(screen.getByText('Forget')).toBeInTheDocument();
  });

  // The whole point of the menu move was that Forget stayed reachable, not that it
  // went away. This walks the path a user now takes: menu, item, confirm dialog,
  // confirm - and asserts the mutation is actually called with the node.
  it('reaches the confirm dialog from the menu, and forgets on confirm', async () => {
    renderPage();

    fireEvent.click(
      within(rowFor('node00')).getByRole('button', { name: /More actions/ })
    );
    fireEvent.click(screen.getByText('Forget'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Forget node00?');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Forget' }));

    await waitFor(() => expect(forgetOne).toHaveBeenCalledWith('node-1'));
  });

  it('closes the dialog without forgetting when cancelled', async () => {
    renderPage();

    fireEvent.click(
      within(rowFor('node00')).getByRole('button', { name: /More actions/ })
    );
    fireEvent.click(screen.getByText('Forget'));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Cancel',
      })
    );

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(forgetOne).not.toHaveBeenCalled();
  });

  // A node Operations cannot act on must not offer the action that would fail.
  it('disables Install MongoDB on a node that is not eligible', () => {
    renderPage([
      host({
        automation_eligible: false,
        automation_blocked_reasons: [
          'PMM-Client is not installed or not connected',
        ],
      }),
    ]);

    expect(
      within(rowFor('node00')).getByRole('button', { name: 'Install MongoDB' })
    ).toBeDisabled();
  });

  // Scanning is estate-wide, so a sweep in flight has to disable the per-row trigger
  // too - otherwise a reader queues a second scan of a node already being scanned.
  it('disables the row Scan while a sweep is running', () => {
    useIsEstateRefreshing.mockReturnValue(true);
    renderPage();

    expect(
      within(rowFor('node00')).getByRole('button', { name: 'Scan' })
    ).toBeDisabled();
  });

  describe('a node whose scans are failing', () => {
    const TRACEBACK =
      'scan failed: Step \'run-script\' failed (exit code 1).\nTraceback (most recent call last):\n  File "probe.py", line 3\nSyntaxError: invalid syntax';
    const twoHoursAgo = () =>
      new Date(Date.now() - 2 * 3600 * 1000).toISOString();

    // The shape PMM Extensions answers with for a node that has never had a good scan:
    // no success time at all, which is exactly what used to hide its error.
    const failingHost = (
      freshness: Partial<OmInventoryHost['freshness']> = {}
    ) =>
      host({
        automation_eligible: false,
        automation_blocked_reasons: [
          "no scan has reported this node's operating system yet",
        ],
        freshness: {
          last_success_at: null,
          failing_since: twoHoursAgo(),
          consecutive_failures: 4,
          last_error: TRACEBACK,
          last_error_code: 'scan_crashed',
          last_run_id: 'run-42',
          ...freshness,
        },
      });

    const expand = (name: string) =>
      fireEvent.click(
        within(rowFor(name)).getByRole('button', { name: /expand/i })
      );

    it('states the failure on the row even though it never succeeded', () => {
      renderPage([failingHost()]);

      const row = rowFor('node00');
      // `failing_since` is two hours before the fixture was built, and a slow run can
      // render a second or more later - so "2h" may read "2h 1s". Exact text here
      // made the test pass or fail with the machine's load.
      expect(row).toHaveTextContent(
        /Failing for 2h( \d+s)?, 4 failed scans in a row: Scan crashed/
      );
      expect(row).toHaveTextContent('Never collected.');
    });

    // The install gate's sentence is a symptom of the failing scan, not its cause.
    it('says why it needs attention without hovering, naming the scan failure', () => {
      renderPage([failingHost()]);

      const row = rowFor('node00');
      expect(within(row).getByText('Needs attention')).toBeInTheDocument();
      expect(row).toHaveTextContent('Scans failing: Scan crashed');
      expect(row).not.toHaveTextContent('no scan has reported');
    });

    it('shows the whole error, its kind, the hint and the run in the expanded row', () => {
      renderPage([failingHost()]);
      expand('node00');

      const panel = within(screen.getByTestId('scan-failure'));
      // Whole and with its line breaks: a traceback folded onto one line is unreadable.
      expect(panel.getByTestId('scan-error').textContent).toBe(TRACEBACK);
      expect(
        panel.getByText('Scans failing: Scan crashed')
      ).toBeInTheDocument();
      expect(
        panel.getByText(/The scan crashed on the node\./)
      ).toBeInTheDocument();
      expect(panel.getByText(/4 failed scans in a row\./)).toBeInTheDocument();
      expect(
        panel.getByRole('link', { name: 'Open the scan that failed' })
      ).toHaveAttribute('href', '/automations?tab=scans&expand=run-42');
    });

    it('draws no run link when the server names no run', () => {
      renderPage([failingHost({ last_run_id: undefined })]);
      expand('node00');

      expect(screen.getByTestId('scan-error')).toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: 'Open the scan that failed' })
      ).toBeNull();
    });

    // Unrecognised and absent fold together: the raw error is the only honest answer.
    it.each([
      ['an unrecognised code', 'something_new'],
      ['no code at all', undefined],
    ])('shows the raw error and no hint for %s', (_label, code) => {
      renderPage([
        failingHost({
          last_error_code: code,
          last_error: 'probe exploded\nsecond line',
        }),
      ]);

      expect(rowFor('node00')).toHaveTextContent(
        /Failing for 2h( \d+s)?, 4 failed scans in a row: probe exploded/
      );
      expand('node00');
      expect(screen.getByTestId('scan-error').textContent).toBe(
        'probe exploded\nsecond line'
      );
      expect(
        within(screen.getByTestId('scan-failure')).getByText(
          'Scans failing: Scan failed'
        )
      ).toBeInTheDocument();
      // No sentence from the hint table for any kind.
      expect(
        screen.queryByText(
          /Check that|retried on the next scan|Install python3/
        )
      ).toBeNull();
    });

    it('shows none of it for a healthy node', () => {
      renderPage([host()]);
      const row = rowFor('node00');
      expect(row).not.toHaveTextContent('Failing');
      expect(row).not.toHaveTextContent('Needs attention');

      expand('node00');
      expect(screen.queryByTestId('scan-error')).toBeNull();
      expect(screen.queryByText(/Scans failing/)).toBeNull();
      expect(
        screen.queryByRole('link', { name: 'Open the scan that failed' })
      ).toBeNull();
    });
  });

  describe('feedback on the page itself', () => {
    const conflict = new OmApiError(
      409,
      'A scan is already running on node00. The nodes update when it finishes.'
    );

    it('says a scan is already running, and links to that scan', () => {
      useRefreshInventory.mockReturnValue({
        refreshAll: vi.fn(),
        refreshHosts: vi.fn(),
        isPending: false,
        isError: true,
        error: conflict,
        submittedAt: 10,
        reset: vi.fn(),
      });
      useActiveInventoryRun.mockReturnValue({
        run: { run_id: 'run-7', status: 'RUN_STATUS_RUNNING' },
        updatedAt: 20,
      });

      renderPage();

      expect(screen.getByText(conflict.message)).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Open the running scan' })
      ).toHaveAttribute('href', expect.stringContaining('expand=run-7'));
    });

    it('takes the notice down once that scan is over', () => {
      const reset = vi.fn();
      useRefreshInventory.mockReturnValue({
        refreshAll: vi.fn(),
        refreshHosts: vi.fn(),
        isPending: false,
        isError: true,
        error: conflict,
        submittedAt: 10,
        reset,
      });
      useActiveInventoryRun.mockReturnValue({ run: undefined, updatedAt: 20 });

      renderPage();

      expect(reset).toHaveBeenCalled();
    });

    it('says a scan could not start when the request failed outright', () => {
      useRefreshInventory.mockReturnValue({
        refreshAll: vi.fn(),
        refreshHosts: vi.fn(),
        isPending: false,
        isError: true,
        error: new OmApiError(502, 'PMM Extensions did not answer'),
        submittedAt: 10,
        reset: vi.fn(),
      });

      renderPage();

      expect(
        screen.getByText(
          'Could not start a scan: PMM Extensions did not answer'
        )
      ).toBeInTheDocument();
    });

    it('filters to the failing nodes from their count, and back', () => {
      renderPage([
        host(),
        host({
          node_id: 'node-2',
          name: 'node01',
          freshness: {
            consecutive_failures: 2,
            failing_since: new Date().toISOString(),
            last_error: 'boom',
          },
        }),
      ]);

      fireEvent.click(screen.getByText('1 failing'));
      expect(rowFor('node01')).toBeTruthy();
      expect(screen.queryByText('node00')).toBeNull();

      fireEvent.click(screen.getByText('1 failing'));
      expect(rowFor('node00')).toBeTruthy();
    });

    it('says it reports readiness, not database health, and where health is', () => {
      renderPage();

      expect(
        screen.getByText(/not how its databases are doing/)
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Clusters' })
      ).toBeInTheDocument();
    });

    it('makes Scan all the heavier action', () => {
      renderPage();

      expect(screen.getByRole('button', { name: 'Scan all' })).toHaveClass(
        'MuiButton-contained'
      );
    });
  });
});
