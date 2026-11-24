import { useState, useEffect, useCallback } from 'react';
import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  TextField,
  Button,
  IconButton,
  Chip,
  Box,
  Typography,
  Tooltip,
  CircularProgress,
  Alert,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Add as AddIcon,
  Edit as EditIcon,
  NetworkCheck as TestIcon,
} from '@mui/icons-material';
import type { HostKeyRefusal, ServerProfile, ServerProfileFormData, TestConnectionResult } from '../../types';
import { useServerProfiles } from '../../hooks/useServerProfiles';
import { factsSummary, hostKeyRefusalFromTest } from '../../lib/terminal/host-key';
import { ServerProfileForm } from './ServerProfileForm';
import { HostKeyDialog } from './HostKeyDialog';
import { HostKeyStatus } from './HostKeyStatus';

/** The host-key prompt a test connection opened (#60). */
interface TestPrompt {
  refusal: HostKeyRefusal;
  hostname: string;
  result: TestConnectionResult;
}

interface ServerProfileListProps {
  onTestResult?: (result: TestConnectionResult) => void;
  onDeleteSuccess?: () => void;
  onError?: (message: string) => void;
}

const AUTH_METHOD_LABELS: Record<string, string> = {
  password: 'Password',
  key: 'SSH Key',
  agent: 'SSH Agent',
};

export function ServerProfileList({
  onTestResult,
  onDeleteSuccess,
  onError,
}: ServerProfileListProps) {
  const {
    profiles,
    total,
    isLoading,
    error,
    fetchProfiles,
    createProfile,
    updateProfile,
    deleteProfile,
    testConnection,
  } = useServerProfiles();

  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [formOpen, setFormOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ServerProfile | null>(
    null,
  );
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testPrompt, setTestPrompt] = useState<TestPrompt | null>(null);

  const reload = useCallback(
    () =>
      fetchProfiles({
        page: currentPage + 1,
        pageSize: rowsPerPage,
        search: search || undefined,
      }),
    [currentPage, rowsPerPage, search, fetchProfiles],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setCurrentPage(0);
  };

  const handleChangePage = (_: unknown, newPage: number) => {
    setCurrentPage(newPage);
  };

  const handleChangeRowsPerPage = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setCurrentPage(0);
  };

  const handleCreate = () => {
    setEditingProfile(null);
    setFormOpen(true);
  };

  const handleEdit = (profile: ServerProfile) => {
    setEditingProfile(profile);
    setFormOpen(true);
  };

  const handleSave = async (data: ServerProfileFormData) => {
    if (editingProfile) {
      await updateProfile(editingProfile.id, data);
    } else {
      await createProfile(data);
    }
  };

  const handleDelete = async (id: string) => {
    if (
      window.confirm(
        'Are you sure you want to delete this server profile?',
      )
    ) {
      try {
        await deleteProfile(id);
        onDeleteSuccess?.();
      } catch (err) {
        onError?.(
          err instanceof Error ? err.message : 'Failed to delete profile',
        );
      }
    }
  };

  const runTest = async (profile: Pick<ServerProfile, 'id' | 'hostname'>) => {
    setTestingId(profile.id);
    try {
      const result = await testConnection(profile.id);
      // An unknown or changed host key (#60): ask the user, then test again.
      const refusal = hostKeyRefusalFromTest(result, profile.id);
      if (refusal) {
        setTestPrompt({ refusal, hostname: profile.hostname, result });
        return;
      }
      onTestResult?.(result);
      // A successful test probes the server's facts: show them.
      if (result.success) void reload();
    } finally {
      setTestingId(null);
    }
  };

  const handleTest = (profile: ServerProfile) => runTest(profile);

  const handleTestTrusted = (trusted: ServerProfile) => {
    setTestPrompt(null);
    void runTest(trusted);
  };

  const handleTestCancelled = () => {
    if (testPrompt) onTestResult?.(testPrompt.result);
    setTestPrompt(null);
  };

  return (
    <Paper sx={{ width: '100%', overflow: 'hidden' }}>
      <Box sx={{ p: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
        <TextField
          label="Search servers"
          variant="outlined"
          size="small"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          sx={{ flexGrow: 1 }}
        />
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={handleCreate}
        >
          Add Server
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mx: 2, mb: 2 }}>
          {error}
        </Alert>
      )}

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      ) : profiles.length === 0 ? (
        <Box sx={{ p: 4, textAlign: 'center' }}>
          <Typography sx={{
            color: "text.secondary"
          }}>
            {search
              ? 'No servers found matching your search'
              : 'No server profiles yet. Click "Add Server" to create one.'}
          </Typography>
        </Box>
      ) : (
        <>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Host</TableCell>
                  <TableCell>Username</TableCell>
                  <TableCell>Auth Method</TableCell>
                  <TableCell>Host key</TableCell>
                  <TableCell>Tags</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {profiles.map((profile) => (
                  <TableRow key={profile.id} hover>
                    <TableCell>
                      <Chip
                        label={profile.name}
                        size="small"
                        color={profile.color === 'default' || !profile.color ? 'primary' : profile.color}
                        variant="filled"
                      />
                    </TableCell>
                    <TableCell>
                      {profile.hostname}:{profile.port}
                      {factsSummary(profile.facts).length > 0 && (
                        <Typography
                          variant="caption"
                          component="div"
                          data-testid="server-facts-summary"
                          sx={{ color: 'text.secondary' }}
                        >
                          {factsSummary(profile.facts).join(' · ')}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>{profile.username}</TableCell>
                    <TableCell>
                      {AUTH_METHOD_LABELS[profile.authMethod] ||
                        profile.authMethod}
                    </TableCell>
                    <TableCell>
                      <HostKeyStatus profile={profile} />
                    </TableCell>
                    <TableCell>
                      {profile.tags.length > 0 ? (
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                          {profile.tags.map((tag) => (
                            <Chip key={tag} label={tag} size="small" />
                          ))}
                        </Box>
                      ) : (
                        <Typography variant="body2" sx={{
                          color: "text.secondary"
                        }}>
                          -
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Edit">
                        <IconButton
                          size="small"
                          onClick={() => handleEdit(profile)}
                        >
                          <EditIcon />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Test Connection">
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => void handleTest(profile)}
                            disabled={testingId === profile.id}
                          >
                            {testingId === profile.id ? (
                              <CircularProgress size={20} />
                            ) : (
                              <TestIcon />
                            )}
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          onClick={() => handleDelete(profile.id)}
                          color="error"
                        >
                          <DeleteIcon />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            component="div"
            count={total}
            page={currentPage}
            onPageChange={handleChangePage}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={handleChangeRowsPerPage}
            rowsPerPageOptions={[5, 10, 25, 50]}
          />
        </>
      )}

      <ServerProfileForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSave={handleSave}
        profile={editingProfile}
        onProfileChanged={() => void reload()}
      />

      <HostKeyDialog
        refusal={testPrompt?.refusal ?? null}
        hostname={testPrompt?.hostname}
        trustLabel="Trust and test"
        onTrusted={handleTestTrusted}
        onCancel={handleTestCancelled}
      />
    </Paper>
  );
}
