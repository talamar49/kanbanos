import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithPreferences } from '../test/render';
import { Onboarding } from './Onboarding';

function callbacks() {
  return {
    onOpenRecent: vi.fn().mockResolvedValue(undefined),
    onRemoveRecent: vi.fn().mockResolvedValue(undefined),
    onCreateLocal: vi.fn().mockResolvedValue(undefined),
    onConnectRemote: vi.fn().mockResolvedValue(undefined),
    onChooseLocal: vi.fn().mockResolvedValue(undefined),
  };
}

describe('workspace onboarding', () => {
  it('opens and removes recent workspaces and can choose an existing local repository', async () => {
    const user = userEvent.setup();
    const handlers = callbacks();
    renderWithPreferences(
      <Onboarding
        recentWorkspaces={[{ repositoryPath: '/work/launch', displayName: 'Launch', remoteUrl: 'https://example.com/launch.git' }]}
        {...handlers}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Launch/ }));
    expect(handlers.onOpenRecent).toHaveBeenCalledWith('/work/launch');

    await user.click(screen.getByRole('button', { name: 'Remove Launch from recent workspaces' }));
    expect(handlers.onRemoveRecent).toHaveBeenCalledWith('/work/launch');

    await user.click(screen.getByRole('button', { name: /Open workspace folder/ }));
    expect(handlers.onChooseLocal).toHaveBeenCalledTimes(1);
  });

  it('validates and creates a trimmed local workspace', async () => {
    const user = userEvent.setup();
    const handlers = callbacks();
    renderWithPreferences(<Onboarding recentWorkspaces={[]} {...handlers} />);

    await user.click(screen.getByRole('button', { name: 'Create a new workspace' }));
    await user.click(screen.getByRole('button', { name: 'Choose location' }));
    expect(screen.getByText('Give your workspace a name to continue.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Workspace name'), '  Product launch  ');
    await user.click(screen.getByRole('button', { name: 'Choose location' }));

    await waitFor(() => expect(handlers.onCreateLocal).toHaveBeenCalledWith('Product launch'));
  });

  it('connects public and private remotes with the expected credentials', async () => {
    const user = userEvent.setup();
    const publicHandlers = callbacks();
    const { unmount } = renderWithPreferences(<Onboarding recentWorkspaces={[]} {...publicHandlers} />);

    await user.click(screen.getByRole('button', { name: /Clone remote workspace/ }));
    await user.type(screen.getByLabelText('Git repository URL'), ' https://example.com/team/work.git ');
    await user.click(screen.getByRole('button', { name: /Clone workspace/ }));
    await waitFor(() => expect(publicHandlers.onConnectRemote).toHaveBeenCalledWith('https://example.com/team/work.git', undefined));

    unmount();
    const privateHandlers = callbacks();
    renderWithPreferences(<Onboarding recentWorkspaces={[]} {...privateHandlers} />);
    await user.click(screen.getByRole('button', { name: /Clone remote workspace/ }));
    await user.type(screen.getByLabelText('Git repository URL'), 'https://example.com/private.git');
    await user.click(screen.getByRole('checkbox', { name: /Private HTTPS repository/ }));
    await user.click(screen.getByRole('button', { name: /Clone workspace/ }));
    expect(screen.getByText('Enter a personal access token or password to continue.')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('oauth2'), 'alice');
    await user.type(screen.getByPlaceholderText('Token with repository access'), 'secret-token');
    await user.click(screen.getByRole('button', { name: /Clone workspace/ }));

    await waitFor(() => expect(privateHandlers.onConnectRemote).toHaveBeenCalledWith(
      'https://example.com/private.git',
      { username: 'alice', token: 'secret-token' },
    ));
  });

  it('shows callback errors without leaving onboarding', async () => {
    const user = userEvent.setup();
    const handlers = callbacks();
    handlers.onChooseLocal.mockRejectedValueOnce(new Error('Folder unavailable'));
    renderWithPreferences(<Onboarding recentWorkspaces={[]} {...handlers} />);

    await user.click(screen.getByRole('button', { name: /Open workspace folder/ }));

    expect(await screen.findByText('Folder unavailable')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Start your first workspace' })).toBeInTheDocument();
  });
});
